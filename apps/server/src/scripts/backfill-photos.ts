import { db } from "../services";
import { DERIVATIVE_VARIANTS, FileSystemStorage } from "../storage";
import {
  IMAGE_PROCESSING_VERSION,
  processPhoto,
} from "../image-processing";

const storage = new FileSystemStorage();
const PAGE_SIZE = 100;

async function backfillPhotos() {
  let lastId: string | undefined;
  let processed = 0;
  let failed = 0;
  let skipped = 0;

  try {
    while (true) {
      const photos = await db.photo.findMany({
        where: lastId ? { id: { gt: lastId } } : undefined,
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        select: {
          id: true,
          processingStatus: true,
          processingVersion: true,
        },
      });

      if (photos.length === 0) {
        break;
      }

      for (const photo of photos) {
        lastId = photo.id;

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
          await processPhoto(db, storage, photo.id);
          processed += 1;
          console.info(`Processed photo ${photo.id}`);
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
      `Backfill finished: ${processed} processed, ${skipped} skipped, ${failed} failed`,
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
