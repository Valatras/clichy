import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import sharp from "sharp";

import { FileSystemStorage } from "../../server/src/storage";
import { processPhotoJob } from "./photo-processing.worker";

type WorkerDb = Parameters<typeof processPhotoJob>[0];

async function createImage(): Promise<Buffer> {
  return sharp({
    create: {
      width: 16,
      height: 12,
      channels: 3,
      background: { r: 30, g: 90, b: 140 },
    },
  })
    .png()
    .toBuffer();
}

async function createHarness(
  t: { after: (fn: () => Promise<void>) => void },
  initialStatus: string = "PENDING",
  deletingAt: Date | null = null,
  image?: Buffer,
) {
  const root = await mkdtemp(path.join(tmpdir(), "clichy-worker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new FileSystemStorage(root);
  const storageKey = await storage.save(
    "user-a",
    image ?? (await createImage()),
    ".png",
  );
  let status = initialStatus;
  let photoExists = true;
  const errors: string[] = [];

  const db = {
    photo: {
      findUnique: async () =>
        photoExists
          ? {
              id: "photo-a",
              storageKey,
              processingStatus: status,
              deletingAt,
            }
          : null,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.processingStatus === "PROCESSING") {
          if (
            deletingAt ||
            (status !== "PENDING" && status !== "FAILED")
          ) {
            return { count: 0 };
          }
          status = "PROCESSING";
          return { count: 1 };
        }
        if (data.processingStatus === "COMPLETED") {
          if (status !== "PROCESSING" || deletingAt) return { count: 0 };
          status = "COMPLETED";
          return { count: 1 };
        }
        if (
          data.processingStatus === "PENDING" ||
          data.processingStatus === "FAILED"
        ) {
          status = String(data.processingStatus);
          errors.push(String(data.processingError));
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  } as unknown as WorkerDb;
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  return {
    db,
    storage,
    storageKey,
    status: () => status,
    errors,
    logger,
    setPhotoExists: (exists: boolean) => {
      photoExists = exists;
    },
  };
}

test("worker processes a photo and writes all derivatives", async (t) => {
  const harness = await createHarness(t);

  await processPhotoJob(
    harness.db,
    harness.storage,
    "photo-a",
    0,
    4,
    harness.logger,
    "photo-job-id",
  );

  assert.equal(harness.status(), "COMPLETED");
  for (const variant of ["thumbnail", "medium", "large"] as const) {
    assert.equal(
      await harness.storage.exists(
        harness.storage.derivativeKey("photo-a", variant),
      ),
      true,
    );
  }
  assert.equal(await harness.storage.exists(harness.storageKey), true);
});

test("worker safely skips deleted and already claimed photos", async (t) => {
  const deleting = await createHarness(t, "PENDING", new Date());
  await processPhotoJob(
    deleting.db,
    deleting.storage,
    "photo-a",
    0,
    4,
    deleting.logger,
  );
  assert.equal(deleting.status(), "PENDING");
  assert.equal(
    await deleting.storage.exists(
      deleting.storage.derivativeKey("photo-a", "thumbnail"),
    ),
    false,
  );

  const claimed = await createHarness(t, "PROCESSING");
  await processPhotoJob(
    claimed.db,
    claimed.storage,
    "photo-a",
    0,
    4,
    claimed.logger,
  );
  assert.equal(claimed.status(), "PROCESSING");
  assert.equal(
    await claimed.storage.exists(
      claimed.storage.derivativeKey("photo-a", "thumbnail"),
    ),
    false,
  );
});

test("worker safely acknowledges a job for a photo that no longer exists", async (t) => {
  const harness = await createHarness(t);
  harness.setPhotoExists(false);

  await processPhotoJob(
    harness.db,
    harness.storage,
    "deleted-photo",
    0,
    4,
    harness.logger,
  );
  assert.equal(
    await harness.storage.exists(
      harness.storage.derivativeKey("photo-a", "thumbnail"),
    ),
    false,
  );
});

test("missing originals and completed duplicate jobs do not reprocess a photo", async (t) => {
  const missingOriginal = await createHarness(t);
  const missingError = Object.assign(new Error("original missing"), {
    code: "ENOENT",
  });
  missingOriginal.storage.read = async () => {
    throw missingError;
  };
  await assert.rejects(
    processPhotoJob(
      missingOriginal.db,
      missingOriginal.storage,
      "photo-a",
      0,
      4,
      missingOriginal.logger,
    ),
    (error: unknown) =>
      error instanceof Error && error.name === "UnrecoverableError",
  );
  assert.equal(missingOriginal.status(), "FAILED");

  const completed = await createHarness(t, "COMPLETED");
  await processPhotoJob(
    completed.db,
    completed.storage,
    "photo-a",
    0,
    4,
    completed.logger,
  );
  assert.equal(completed.status(), "COMPLETED");
  assert.equal(
    await completed.storage.exists(
      completed.storage.derivativeKey("photo-a", "thumbnail"),
    ),
    false,
  );
});

test("transient storage failures are reset to PENDING for BullMQ retry", async (t) => {
  const harness = await createHarness(t);
  harness.storage.read = async () => {
    throw new Error("temporary storage failure");
  };

  await assert.rejects(
    processPhotoJob(
      harness.db,
      harness.storage,
      "photo-a",
      0,
      4,
      harness.logger,
    ),
    /temporary storage failure/,
  );
  assert.equal(harness.status(), "PENDING");
  assert.deepEqual(harness.errors, ["temporary storage failure"]);
});

test("invalid images fail permanently without being retried", async (t) => {
  const harness = await createHarness(t, "PENDING", null, Buffer.from("invalid"));

  await assert.rejects(
    processPhotoJob(
      harness.db,
      harness.storage,
      "photo-a",
      0,
      4,
      harness.logger,
    ),
    (error: unknown) =>
      error instanceof Error && error.name === "UnrecoverableError",
  );
  assert.equal(harness.status(), "FAILED");
});
