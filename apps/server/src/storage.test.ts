import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
