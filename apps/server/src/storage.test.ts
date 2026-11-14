import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { FileSystemStorage } from "./storage";

async function createStorage(t: { after: (fn: () => Promise<void>) => void }) {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-storage-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));

  return { rootPath, storage: new FileSystemStorage(rootPath) };
}

test("save writes a file and returns its storage key", async (t) => {
  const { rootPath, storage } = await createStorage(t);
  const content = Buffer.from("photo data");

  const storageKey = await storage.save("user-123", content, ".jpg");

  assert.match(storageKey, /^user-123[\\/].+\.jpg$/);
  assert.deepEqual(await readFile(path.join(rootPath, storageKey)), content);
});

test("read returns the saved file contents", async (t) => {
  const { storage } = await createStorage(t);
  const content = Buffer.from("photo data");
  const storageKey = await storage.save("user-123", content, ".png");

  assert.deepEqual(await storage.read(storageKey), content);
});

test("exists reports saved files and delete removes them", async (t) => {
  const { storage } = await createStorage(t);
  const storageKey = await storage.save(
    "user-123",
    Buffer.from("photo data"),
    ".webp",
  );

  assert.equal(await storage.exists(storageKey), true);

  await storage.delete(storageKey);

  assert.equal(await storage.exists(storageKey), false);
});

test("photo asset cleanup removes the original and the derivative directory", async (t) => {
  const { storage } = await createStorage(t);
  const photoId = "photo-123";
  const originalKey = await storage.save(
    "user-123",
    Buffer.from("photo data"),
    ".jpg",
  );
  await storage.saveDerivative(
    photoId,
    "thumbnail",
    Buffer.from("thumbnail"),
  );
  await storage.saveDerivative(photoId, "large", Buffer.from("large"));

  await storage.deletePhotoAssets("user-123", photoId, originalKey);

  assert.equal(await storage.exists(originalKey), false);
  assert.equal(
    await storage.exists(storage.derivativeKey(photoId, "thumbnail")),
    false,
  );
  assert.equal(
    await storage.exists(storage.derivativeKey(photoId, "large")),
    false,
  );
});

test("photo asset cleanup tolerates already missing files and rejects traversal", async (t) => {
  const { rootPath, storage } = await createStorage(t);
  const outsidePath = `${rootPath}-outside.txt`;
  t.after(() => rm(outsidePath, { force: true }));
  await writeFile(outsidePath, "must remain outside storage");

  await storage.deletePhotoAssets(
    "user-123",
    "photo-123",
    path.join("user-123", "missing.jpg"),
  );

  await assert.rejects(
    storage.deletePhotoAssets(
      "user-123",
      "photo-123",
      path.join("..", "other-user", "photo.jpg"),
    ),
    /Invalid photo storage key/,
  );
  await assert.rejects(
    storage.deletePhotoAssets(
      "user-123",
      "../other-photo",
      path.join("user-123", "photo.jpg"),
    ),
    /Invalid photo identifier/,
  );
  await assert.rejects(
    storage.delete(path.relative(rootPath, outsidePath)),
    /Invalid storage key/,
  );
  assert.equal(await readFile(outsidePath, "utf8"), "must remain outside storage");
});
