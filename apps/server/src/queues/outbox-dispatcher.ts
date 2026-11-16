import type { Database } from "@clichy/db";
import {
  PHOTO_PROCESSING_JOB,
  photoProcessingJobId,
} from "@clichy/jobs";

type OutboxDatabase = Pick<
  Database,
  "photo" | "photoProcessingOutbox" | "$transaction"
>;
type PhotoQueue = {
  add: (
    name: string,
    data: { userId: string; photoId: string },
    options?: { jobId: string },
  ) => Promise<unknown>;
  getJob: (jobId: string) => Promise<{
    getState: () => Promise<string>;
    remove: () => Promise<void>;
  } | undefined>;
};
type DispatcherLogger = {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
};

const OUTBOX_BATCH_SIZE = 50;
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const STALE_PENDING_MS = 10 * 60 * 1000;
const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function recoverStalePhotos(
  db: OutboxDatabase,
  logger: Pick<DispatcherLogger, "warn">,
  now = new Date(),
): Promise<number> {
  const processingCutoff = new Date(now.getTime() - STALE_PROCESSING_MS);
  const staleProcessingWhere = {
    processingStatus: "PROCESSING" as const,
    deletingAt: null,
    OR: [
      { processingStartedAt: { lt: processingCutoff } },
      { processingStartedAt: null, createdAt: { lt: processingCutoff } },
    ],
  };
  const abandoned = await db.photo.findMany({
    where: staleProcessingWhere,
    orderBy: { processingStartedAt: "asc" },
    take: OUTBOX_BATCH_SIZE,
    select: { id: true, userId: true },
  });

  let recovered = 0;
  for (const { id, userId } of abandoned) {
    const updated = await db.$transaction(async (transaction) => {
      const result = await transaction.photo.updateMany({
        where: {
          userId,
          id,
          ...staleProcessingWhere,
        },
        data: {
          processingStatus: "PENDING",
          processingStartedAt: null,
          processingError: "Recovered after a worker stopped during processing",
        },
      });
      if (result.count > 0) {
        await transaction.photoProcessingOutbox.create({
          data: { userId, photoId: id },
        });
      }
      return result.count;
    });
    if (updated > 0) {
      recovered += 1;
      logger.warn({ userId, photoId: id }, "Recovered stale photo processing");
    }
  }

  const pendingCutoff = new Date(now.getTime() - STALE_PENDING_MS);
  const retryBefore = new Date(now.getTime() - STALE_PENDING_MS);
  const pending = await db.photo.findMany({
    where: {
      processingStatus: "PENDING",
      createdAt: { lt: pendingCutoff },
      deletingAt: null,
      processingOutbox: { none: { createdAt: { gte: retryBefore } } },
    },
    orderBy: { createdAt: "asc" },
    take: OUTBOX_BATCH_SIZE,
    select: { id: true, userId: true },
  });
  for (const { id, userId } of pending) {
    await db.photoProcessingOutbox.create({ data: { userId, photoId: id } });
    recovered += 1;
    logger.warn({ userId, photoId: id }, "Created recovery event for pending photo");
  }

  return recovered;
}

export async function dispatchOutboxOnce(
  db: OutboxDatabase,
  queue: PhotoQueue,
  logger: Pick<DispatcherLogger, "info" | "error">,
): Promise<{ published: number; failed: number }> {
  const events = await db.photoProcessingOutbox.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: "asc" },
    take: OUTBOX_BATCH_SIZE,
    select: { id: true, userId: true, photoId: true, attempts: true },
  });
  let published = 0;
  let failed = 0;

  for (const event of events) {
    let userId: string | undefined = event.userId;
    try {
      if (!userId) {
        // During the production rolling deployment, the previous API version
        // may still create outbox rows without userId. Resolve and backfill
        // those rows before building a shard-routed job.
        const photo = await db.photo.findFirst({
          where: { id: event.photoId },
          select: { userId: true },
        });
        if (!photo) throw new Error("Outbox photo does not exist");
        userId = photo.userId;
        await db.photoProcessingOutbox.updateMany({
          where: { id: event.id },
          data: { userId },
        });
      }

      const jobId = photoProcessingJobId(userId, event.photoId);
      const previousJob = await queue.getJob(jobId);
      if (previousJob) {
        const state = await previousJob.getState();
        if (state === "completed" || state === "failed") {
          await previousJob.remove();
        }
      }
      await queue.add(
        PHOTO_PROCESSING_JOB,
        { userId, photoId: event.photoId },
        { jobId },
      );
      await db.photoProcessingOutbox.update({
        where: { userId_id: { userId, id: event.id } },
        data: {
          publishedAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });
      published += 1;
      logger.info({ userId, photoId: event.photoId, jobId }, "Photo job enqueued");
    } catch (error) {
      failed += 1;
      logger.error(
        { err: error, userId, photoId: event.photoId, attempts: event.attempts + 1 },
        "Unable to publish photo outbox event; it will be retried",
      );
      const data = {
        attempts: { increment: 1 },
        lastError: (
          error instanceof Error ? error.message : String(error)
        ).slice(0, 1000),
      };
      if (userId) {
        await db.photoProcessingOutbox.update({
          where: { userId_id: { userId, id: event.id } },
          data,
        });
      } else {
        await db.photoProcessingOutbox.updateMany({
          where: { id: event.id },
          data,
        });
      }
    }
  }

  return { published, failed };
}

export function startOutboxDispatcher(
  db: OutboxDatabase,
  queue: PhotoQueue,
  logger: DispatcherLogger,
  intervalMs = 2000,
): () => void {
  let stopped = false;
  let running = false;
  let lastOutboxCleanup = 0;
  const dispatch = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const now = Date.now();
      await recoverStalePhotos(db, logger, new Date(now));
      await dispatchOutboxOnce(db, queue, logger);
      if (now - lastOutboxCleanup >= 60 * 60 * 1000) {
        lastOutboxCleanup = now;
        await db.photoProcessingOutbox.deleteMany({
          where: {
            publishedAt: {
              lt: new Date(now - OUTBOX_RETENTION_MS),
            },
          },
        });
      }
    } catch (error) {
      logger.error({ err: error }, "Photo outbox dispatcher failed");
    } finally {
      running = false;
    }
  };
  void dispatch();
  const timer = setInterval(() => void dispatch(), intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
