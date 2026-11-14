import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import sharp from "sharp";

import type { createPhotoRoutes as createPhotoRoutesType } from "./routes/photos";
import type { FileSystemStorage as FileSystemStorageType } from "./storage";

process.env.NODE_ENV = "test";
process.env.BETTER_AUTH_SECRET = "test-secret-with-more-than-thirty-two-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.PHOTO_STORAGE_PATH = tmpdir();

const [{ createPhotoRoutes }, { FileSystemStorage }] = await Promise.all([
  import("./routes/photos"),
  import("./storage"),
]);
type PhotoRouteDb = Parameters<typeof createPhotoRoutesType>[0]["db"];

function createDb(
  findFirst: (args: { where: Record<string, unknown> }) => Promise<unknown>,
  findMany: (args: { where: Record<string, unknown> }) => Promise<unknown>,
  deleteMany: (args: { where: Record<string, unknown> }) => Promise<unknown> =
    async () => ({ count: 0 }),
  photoMethods: Record<string, unknown> = {},
): PhotoRouteDb {
  return {
    photo: {
      findFirst,
      findMany,
      deleteMany,
      updateMany: async () => ({ count: 1 }),
      ...photoMethods,
    },
  } as unknown as PhotoRouteDb;
}

async function createApp(
  db: PhotoRouteDb,
  getSession: Parameters<typeof createPhotoRoutesType>[0]["getSession"],
  storage: FileSystemStorageType,
  createPhotoWithOutbox?: Parameters<
    typeof createPhotoRoutesType
  >[0]["createPhotoWithOutbox"],
) {
  const app = Fastify();
  app.register(fastifyMultipart);
  app.register(createPhotoRoutes({ db, getSession, storage, createPhotoWithOutbox }));
  await app.ready();
  return app;
}

function multipartImage(buffer: Buffer): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const boundary = "clichy-test-boundary";
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([prefix, buffer, suffix]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

test("metadata access requires authentication and hides photos owned by others", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-photo-routes-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));

  let lookups = 0;
  const db = createDb(async ({ where }) => {
    lookups += 1;
    assert.deepEqual(where, { id: "photo-private", userId: "user-a" });
    return null;
  }, async () => []);
  const storage = new FileSystemStorage(rootPath);

  const unauthenticatedApp = await createApp(db, async () => null, storage);
  t.after(() => unauthenticatedApp.close());
  const unauthenticated = await unauthenticatedApp.inject({
    method: "GET",
    url: "/photos/photo-private/metadata",
  });

  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(lookups, 0);

  const authenticatedApp = await createApp(
    db,
    async () => ({ user: { id: "user-a" } }),
    storage,
  );
  t.after(() => authenticatedApp.close());
  const otherUsersPhoto = await authenticatedApp.inject({
    method: "GET",
    url: "/photos/photo-private/metadata",
  });
  assert.equal(otherUsersPhoto.statusCode, 404);
  assert.equal(lookups, 1);
});

test("photo uploads require authentication and reject malformed images", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-photo-routes-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  const storage = new FileSystemStorage(rootPath);
  const db = createDb(async () => null, async () => []);
  const unauthenticatedApp = await createApp(db, async () => null, storage);
  t.after(() => unauthenticatedApp.close());
  const unauthenticated = await unauthenticatedApp.inject({
    method: "POST",
    url: "/photos",
    ...multipartImage(Buffer.from("not an image")),
  });
  assert.equal(unauthenticated.statusCode, 401);

  const authenticatedApp = await createApp(
    db,
    async () => ({ user: { id: "user-a" } }),
    storage,
  );
  t.after(() => authenticatedApp.close());
  const malformed = await authenticatedApp.inject({
    method: "POST",
    url: "/photos",
    ...multipartImage(Buffer.from("not an image")),
  });
  assert.equal(malformed.statusCode, 400);
});

test("valid upload saves an original and atomically registers a pending photo", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-photo-routes-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  const storage = new FileSystemStorage(rootPath);
  let createdInput:
    | {
        userId: string;
        filename: string;
        mimeType: string;
        size: number;
        storageKey: string;
      }
    | undefined;
  const app = await createApp(
    createDb(async () => null, async () => []),
    async () => ({ user: { id: "user-a" } }),
    storage,
    async (input) => {
      createdInput = input;
      return {
        id: "photo-new",
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
      };
    },
  );
  t.after(() => app.close());

  const image = await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 3,
      background: { r: 100, g: 120, b: 140 },
    },
  })
    .png()
    .toBuffer();
  const response = await app.inject({
    method: "POST",
    url: "/photos",
    ...multipartImage(image),
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), {
    id: "photo-new",
    filename: "test.png",
    mimeType: "image/png",
    size: image.length,
    createdAt: "2026-01-02T03:04:05.000Z",
    processingStatus: "PENDING",
    width: 3,
    height: 2,
  });
  assert.equal(createdInput?.userId, "user-a");
  assert.equal(createdInput?.mimeType, "image/png");
  assert.ok(createdInput?.storageKey);
  assert.deepEqual(await storage.read(createdInput!.storageKey), image);
});

test("upload removes the stored original if durable photo registration fails", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-photo-routes-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  const storage = new FileSystemStorage(rootPath);
  let savedKey: string | undefined;
  const app = await createApp(
    createDb(async () => null, async () => []),
    async () => ({ user: { id: "user-a" } }),
    storage,
    async (input) => {
      savedKey = input.storageKey;
      throw new Error("database unavailable");
    },
  );
  t.after(() => app.close());
  const image = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 1, g: 2, b: 3 },
    },
  })
    .png()
    .toBuffer();

  const response = await app.inject({
    method: "POST",
    url: "/photos",
    ...multipartImage(image),
  });

  assert.equal(response.statusCode, 500);
  assert.ok(savedKey);
  assert.equal(await storage.exists(savedKey), false);
});

test("thumbnail access cannot read another user's derivative", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-photo-routes-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));

  let storageReads = 0;
  const db = createDb(async () => null, async () => []);
  const storage = new FileSystemStorage(rootPath);
  const read = storage.read.bind(storage);
  storage.read = async (storageKey) => {
    storageReads += 1;
    return read(storageKey);
  };

  const app = await createApp(
    db,
    async () => ({ user: { id: "user-a" } }),
    storage,
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/photos/photo-private/thumbnail/thumbnail",
  });

  assert.equal(response.statusCode, 404);
  assert.equal(storageReads, 0);
});

test("exact duplicate lookup filters by the authenticated user's library", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-photo-routes-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));

  let duplicateWhere: Record<string, unknown> | undefined;
  const hash = "a".repeat(64);
  const db = createDb(
    async ({ where }) => {
      assert.deepEqual(where, { id: "photo-a", userId: "user-a" });
      return {
        id: "photo-a",
        sha256: hash,
        processingStatus: "COMPLETED",
      };
    },
    async ({ where }) => {
      duplicateWhere = where;
      return [];
    },
  );

  const app = await createApp(
    db,
    async () => ({ user: { id: "user-a" } }),
    new FileSystemStorage(rootPath),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/photos/photo-a/duplicates",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), []);
  assert.deepEqual(duplicateWhere, {
    userId: "user-a",
    sha256: hash,
    id: { not: "photo-a" },
    processingStatus: "COMPLETED",
  });
});

test("photo deletion requires authentication and hides other users' photos", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-photo-routes-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));

  let lookups = 0;
  let deletions = 0;
  const db = createDb(
    async ({ where }) => {
      lookups += 1;
      assert.deepEqual(where, { id: "photo-private", userId: "user-a" });
      return null;
    },
    async () => [],
    async () => {
      deletions += 1;
      return { count: 1 };
    },
  );
  const storage = new FileSystemStorage(rootPath);

  const unauthenticatedApp = await createApp(db, async () => null, storage);
  t.after(() => unauthenticatedApp.close());
  const unauthenticated = await unauthenticatedApp.inject({
    method: "DELETE",
    url: "/photos/photo-private",
  });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(lookups, 0);

  const authenticatedApp = await createApp(
    db,
    async () => ({ user: { id: "user-a" } }),
    storage,
  );
  t.after(() => authenticatedApp.close());
  const otherUsersPhoto = await authenticatedApp.inject({
    method: "DELETE",
    url: "/photos/photo-private",
  });
  assert.equal(otherUsersPhoto.statusCode, 404);
  assert.equal(lookups, 1);
  assert.equal(deletions, 0);
});

test("photo deletion removes the user's original, derivatives, and database row", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-photo-routes-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));

  const storage = new FileSystemStorage(rootPath);
  const photoId = "photo-owned";
  const storageKey = await storage.save(
    "user-a",
    Buffer.from("original photo"),
    ".jpg",
  );
  await storage.saveDerivative(photoId, "thumbnail", Buffer.from("thumbnail"));
  await storage.saveDerivative(photoId, "medium", Buffer.from("medium"));
  await storage.saveDerivative(photoId, "large", Buffer.from("large"));

  let deletedWhere: Record<string, unknown> | undefined;
  const db = createDb(
    async ({ where }) => {
      assert.deepEqual(where, { id: photoId, userId: "user-a" });
      return {
        id: photoId,
        storageKey,
        processingStatus: "PENDING",
      };
    },
    async () => [],
    async ({ where }) => {
      deletedWhere = where;
      return { count: 1 };
    },
    {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        assert.deepEqual(where, {
          id: photoId,
          userId: "user-a",
          deletingAt: null,
          processingStatus: { not: "PROCESSING" },
        });
        assert.ok(data.deletingAt instanceof Date);
        return { count: 1 };
      },
    },
  );
  const app = await createApp(
    db,
    async () => ({ user: { id: "user-a" } }),
    storage,
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: "DELETE",
    url: `/photos/${photoId}`,
  });

  assert.equal(response.statusCode, 204);
  assert.deepEqual(deletedWhere, {
    id: photoId,
    userId: "user-a",
    deletingAt: { not: null },
  });
  assert.equal(await storage.exists(storageKey), false);
  for (const variant of ["thumbnail", "medium", "large"] as const) {
    assert.equal(
      await storage.exists(storage.derivativeKey(photoId, variant)),
      false,
    );
  }
});

test("photo deletion tolerates missing assets and keeps the row on cleanup failure", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-photo-routes-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));

  const photoId = "photo-owned";
  const storageKey = path.join("user-a", "missing.jpg");
  const storage = new FileSystemStorage(rootPath);
  let deleteCount = 0;
  const db = createDb(
    async () => ({
      id: photoId,
      storageKey,
      processingStatus: "COMPLETED",
    }),
    async () => [],
    async () => {
      deleteCount += 1;
      return { count: 1 };
    },
  );
  const app = await createApp(
    db,
    async () => ({ user: { id: "user-a" } }),
    storage,
  );
  t.after(() => app.close());

  const missingAssets = await app.inject({
    method: "DELETE",
    url: `/photos/${photoId}`,
  });
  assert.equal(missingAssets.statusCode, 204);
  assert.equal(deleteCount, 1);

  const failingStorage = new FileSystemStorage(rootPath);
  failingStorage.deletePhotoAssets = async () => {
    throw new Error("storage unavailable");
  };
  const failureApp = await createApp(
    db,
    async () => ({ user: { id: "user-a" } }),
    failingStorage,
  );
  t.after(() => failureApp.close());
  const cleanupFailure = await failureApp.inject({
    method: "DELETE",
    url: `/photos/${photoId}`,
  });
  assert.equal(cleanupFailure.statusCode, 500);
  assert.equal(deleteCount, 1);
});

test("photo deletion leaves a retryable database row when record deletion fails", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-photo-routes-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));

  const photoId = "photo-retry";
  const storage = new FileSystemStorage(rootPath);
  const storageKey = await storage.save(
    "user-a",
    Buffer.from("original photo"),
    ".jpg",
  );
  await storage.saveDerivative(photoId, "thumbnail", Buffer.from("thumbnail"));
  let deleteAttempts = 0;
  const db = createDb(
    async () => ({
      id: photoId,
      storageKey,
      processingStatus: "COMPLETED",
    }),
    async () => [],
    async () => {
      deleteAttempts += 1;
      if (deleteAttempts === 1) throw new Error("database unavailable");
      return { count: 1 };
    },
  );
  const app = await createApp(
    db,
    async () => ({ user: { id: "user-a" } }),
    storage,
  );
  t.after(() => app.close());

  const failedAttempt = await app.inject({
    method: "DELETE",
    url: `/photos/${photoId}`,
  });
  assert.equal(failedAttempt.statusCode, 500);
  assert.equal(await storage.exists(storageKey), false);
  assert.equal(
    await storage.exists(storage.derivativeKey(photoId, "thumbnail")),
    false,
  );

  const retry = await app.inject({
    method: "DELETE",
    url: `/photos/${photoId}`,
  });
  assert.equal(retry.statusCode, 204);
  assert.equal(deleteAttempts, 2);
});

test("photo deletion does not remove a record while image processing is active", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-photo-routes-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));

  let deleteCount = 0;
  const db = createDb(
    async () => ({
      id: "photo-processing",
      storageKey: path.join("user-a", "photo.jpg"),
      processingStatus: "PROCESSING",
    }),
    async () => [],
    async () => {
      deleteCount += 1;
      return { count: 1 };
    },
  );
  const app = await createApp(
    db,
    async () => ({ user: { id: "user-a" } }),
    new FileSystemStorage(rootPath),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: "DELETE",
    url: "/photos/photo-processing",
  });
  assert.equal(response.statusCode, 409);
  assert.equal(deleteCount, 0);
});
