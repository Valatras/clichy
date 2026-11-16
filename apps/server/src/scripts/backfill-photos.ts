import { db } from "../services";
import { DERIVATIVE_VARIANTS, FileSystemStorage } from "../storage";
import { IMAGE_PROCESSING_VERSION } from "../image-processing";

const storage = new FileSystemStorage();
const PAGE_SIZE = 100;

async function backfillPhotos() {
  let lastPhoto: { userId: string; id: string } | undefined;
  let queued = 0;
  let failed = 0;
  let skipped = 0;

  try {
    while (true) {
      const photos = await db.photo.findMany({
        where: lastPhoto
          ? {
              OR: [
                { userId: { gt: lastPhoto.userId } },
                { userId: lastPhoto.userId, id: { gt: lastPhoto.id } },
              ],
            }
          : undefined,
        orderBy: [{ userId: "asc" }, { id: "asc" }],
        take: PAGE_SIZE,
        select: {
          id: true,
          userId: true,
          processingStatus: true,
          processingVersion: true,
          deletingAt: true,
        },
      });

      if (photos.length === 0) {
        break;
      }

      for (const photo of photos) {
        lastPhoto = { userId: photo.userId, id: photo.id };

        if (photo.deletingAt || photo.processingStatus === "PROCESSING") {
          skipped += 1;
          continue;
        }

        let needsProcessing =
          photo.processingStatus !== "COMPLETED" ||
          photo.processingVersion !== IMAGE_PROCESSING_VERSION;

        if (!needsProcessing) {
          for (const variant of Object.keys(DERIVATIVE_VARIANTS) as Array<
            keyof typeof DERIVATIVE_VARIANTS
          >) {
            if (
              !(await storage.exists(
                storage.derivativeKey(photo.id, variant),
              ))
            ) {
              needsProcessing = true;
              break;
            }
          }
        }

        if (!needsProcessing) {
          skipped += 1;
          continue;
        }

        try {
          const created = await db.$transaction(async (transaction) => {
            const claimed = await transaction.photo.updateMany({
              where: {
                userId: photo.userId,
                id: photo.id,
                deletingAt: null,
                processingStatus: { not: "PROCESSING" },
              },
              data: {
                processingStatus: "PENDING",
                processingError: null,
                processingStartedAt: null,
                processedAt: null,
              },
            });
            if (claimed.count === 0) return false;
            const pendingEvent =
              await transaction.photoProcessingOutbox.findFirst({
                where: {
                  userId: photo.userId,
                  photoId: photo.id,
                  publishedAt: null,
                },
                select: { id: true },
              });
            if (!pendingEvent) {
              await transaction.photoProcessingOutbox.create({
                data: { userId: photo.userId, photoId: photo.id },
              });
            }
            return true;
          });
          if (created) {
            queued += 1;
            console.info(`Queued photo ${photo.id}`);
          } else {
            skipped += 1;
          }
        } catch (error) {
          failed += 1;
          console.error(
            `Failed to process photo ${photo.id}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }

    console.info(
      `Backfill finished: ${queued} queued, ${skipped} skipped, ${failed} failed`,
    );

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
  }
}

backfillPhotos().catch((error: unknown) => {
  console.error("Photo backfill failed:", error);
  process.exitCode = 1;
});
