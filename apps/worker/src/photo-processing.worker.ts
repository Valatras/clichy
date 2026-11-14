import { UnrecoverableError } from "bullmq";

import type { Database } from "@clichy/db";
import { photoProcessingJobId } from "@clichy/jobs";

import {
  ImageValidationError,
  processPhoto,
} from "../../server/src/image-processing";
import { FileSystemStorage } from "../../server/src/storage";

type WorkerDatabase = Pick<Database, "photo">;
type WorkerLogger = {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
};

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function processPhotoJob(
  db: WorkerDatabase,
  storage: FileSystemStorage,
  photoId: string,
  attemptsMade: number,
  maxAttempts: number,
  logger: WorkerLogger,
  actualJobId = photoProcessingJobId(photoId),
): Promise<void> {
  const startedAt = Date.now();
  const jobId = actualJobId;
  const photo = await db.photo.findUnique({
    where: { id: photoId },
    select: { id: true, processingStatus: true, deletingAt: true },
  });
  if (!photo || photo.deletingAt || photo.processingStatus === "COMPLETED") {
    logger.info({ photoId, jobId }, "Photo job skipped");
    return;
  }

  try {
    const outcome = await processPhoto(db, storage, photoId);
    if (outcome === "processed") {
      logger.info(
        { photoId, jobId, durationMs: Date.now() - startedAt },
        "Photo processing completed",
      );
    } else {
      logger.info({ photoId, jobId }, "Photo job skipped after claim check");
    }
  } catch (error) {
    const permanent = error instanceof ImageValidationError || isMissingFile(error);
    const exhausted = attemptsMade + 1 >= maxAttempts;
    const finalFailure = permanent || exhausted;
    const message = (error instanceof Error ? error.message : String(error)).slice(
      0,
      1000,
    );
    const status = finalFailure ? "FAILED" : "PENDING";
    await db.photo.updateMany({
      where: {
        id: photoId,
        processingStatus: "PROCESSING",
        deletingAt: null,
      },
      data: {
        processingStatus: status,
        processingError: message,
        processingStartedAt: null,
        processedAt: null,
      },
    });

    if (finalFailure) {
      logger.error(
        {
          err: error,
          photoId,
          jobId,
          attemptsMade: attemptsMade + 1,
          durationMs: Date.now() - startedAt,
        },
        "Photo processing failed permanently",
      );
      if (permanent) throw new UnrecoverableError(message);
      throw error;
    }

    logger.warn(
      {
        err: error,
        photoId,
        jobId,
        attemptsMade: attemptsMade + 1,
        durationMs: Date.now() - startedAt,
      },
      "Photo processing failed; BullMQ will retry",
    );
    throw error;
  }
}
