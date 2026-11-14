import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import Fastify from "fastify";

import { FileSystemStorage } from "./storage";
import type { createPhotoRoutes as createPhotoRoutesType } from "./routes/photos";

process.env.NODE_ENV = "test";
process.env.BETTER_AUTH_SECRET = "test-secret-with-more-than-thirty-two-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.PHOTO_STORAGE_PATH = tmpdir();

const { createPhotoRoutes } = await import("./routes/photos");
type PhotoRouteDb = Parameters<typeof createPhotoRoutesType>[0]["db"];

function createDb(
  findFirst: (args: { where: Record<string, unknown> }) => Promise<unknown>,
  findMany: (args: { where: Record<string, unknown> }) => Promise<unknown>,
): PhotoRouteDb {
  return {
    photo: { findFirst, findMany },
  } as unknown as PhotoRouteDb;
}

async function createApp(
  db: PhotoRouteDb,
  getSession: Parameters<typeof createPhotoRoutesType>[0]["getSession"],
  storage: FileSystemStorage,
) {
  const app = Fastify();
  app.register(createPhotoRoutes({ db, getSession, storage }));
  await app.ready();
  return app;
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
