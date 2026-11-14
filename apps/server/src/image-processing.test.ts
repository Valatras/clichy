import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import sharp from "sharp";

import {
  extractImageMetadata,
  generateDerivatives,
  hammingDistance,
  perceptualHash,
  sha256,
} from "./image-processing";
import {
  DERIVATIVE_VARIANTS,
  type DerivativeVariant,
  FileSystemStorage,
} from "./storage";

async function createImage(width = 64, height = 48): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const foreground = x > width / 3 && x < (width * 2) / 3 && y > height / 4;
      pixels[offset] = foreground ? 240 : 20;
      pixels[offset + 1] = foreground ? 30 : 40;
      pixels[offset + 2] = foreground ? 20 : 220;
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

test("SHA-256 hashes file contents, not filenames", () => {
  const original = Buffer.from("identical image bytes");
  const renamedCopy = Buffer.from("identical image bytes");

  assert.equal(sha256(original), sha256(renamedCopy));
  assert.notEqual(sha256(original), sha256(Buffer.from("different bytes")));
});

test("pHash is stable, resize tolerant, and distinguishes different images", async () => {
  const image = await createImage();
  const recompressed = await sharp(image)
    .resize(48, 36)
    .jpeg({ quality: 48 })
    .toBuffer();
  const different = await sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 240, g: 220, b: 10 },
    },
  })
    .png()
    .toBuffer();

  const originalHash = await perceptualHash(image);
  const recompressedHash = await perceptualHash(recompressed);
  const differentHash = await perceptualHash(different);

  assert.equal(originalHash, await perceptualHash(image));
  assert.ok(hammingDistance(originalHash, recompressedHash) <= 14);
  assert.ok(hammingDistance(originalHash, differentHash) > 10);
});

test("Hamming distance counts differing bits and validates hashes", () => {
  assert.equal(hammingDistance("0000000000000000", "0000000000000000"), 0);
  assert.equal(hammingDistance("0000000000000000", "000000000000000f"), 4);
  assert.throws(() => hammingDistance("not-a-hash", "0000000000000000"));
});

test("technical metadata reads actual format and dimensions without EXIF", async () => {
  const image = await createImage();
  const metadata = await extractImageMetadata(image);

  assert.equal(metadata.imageFormat, "png");
  assert.equal(metadata.mimeType, "image/png");
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 48);
  assert.equal(metadata.dateTaken, null);
  assert.equal(metadata.cameraMake, null);
  assert.equal(metadata.gpsLatitude, null);
});

test("EXIF date and camera fields are extracted when present", async () => {
  const base = await createImage();
  const image = await sharp(base)
    .jpeg()
    .withExif({
      IFD0: { Make: "Clichy test camera", Model: "Fixture" },
      IFD2: { DateTimeOriginal: "2020:03:04 05:06:07" },
    })
    .toBuffer();

  const metadata = await extractImageMetadata(image);

  assert.equal(metadata.cameraMake, "Clichy test camera");
  assert.equal(metadata.cameraModel, "Fixture");
  assert.ok(metadata.dateTaken);
  assert.deepEqual(
    [
      metadata.dateTaken.getFullYear(),
      metadata.dateTaken.getMonth(),
      metadata.dateTaken.getDate(),
      metadata.dateTaken.getHours(),
      metadata.dateTaken.getMinutes(),
      metadata.dateTaken.getSeconds(),
    ],
    [2020, 2, 4, 5, 6, 7],
  );
});

test("derivatives preserve aspect ratio, do not enlarge, and are idempotent", async (t) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "clichy-image-processing-"));
  t.after(() => rm(rootPath, { recursive: true, force: true }));

  const storage = new FileSystemStorage(rootPath);
  const original = await createImage(1600, 800);
  const originalKey = await storage.save("user-1", original, ".png");

  await generateDerivatives(original, "photo-1", storage);

  const firstPass = new Map<string, Buffer>();
  for (const [variant, maximumDimension] of Object.entries(
    DERIVATIVE_VARIANTS,
  )) {
    const key = storage.derivativeKey(
      "photo-1",
      variant as DerivativeVariant,
    );
    const derivative = await storage.read(key);
    const metadata = await sharp(derivative).metadata();

    assert.equal(metadata.format, "webp");
    assert.ok(metadata.width! <= maximumDimension);
    assert.ok(metadata.height! <= maximumDimension);
    assert.ok(Math.abs(metadata.width! / metadata.height! - 2) < 0.02);
    assert.equal(await storage.exists(key), true);
    firstPass.set(key, derivative);
  }

  await generateDerivatives(original, "photo-1", storage);

  for (const [key, previous] of firstPass) {
    assert.deepEqual(await storage.read(key), previous);
  }

  const missingThumbnailKey = storage.derivativeKey("photo-1", "thumbnail");
  await storage.delete(missingThumbnailKey);
  await generateDerivatives(original, "photo-1", storage);
  assert.deepEqual(
    await storage.read(missingThumbnailKey),
    firstPass.get(missingThumbnailKey),
  );
  assert.deepEqual(await storage.read(originalKey), original);

  const smallImage = await createImage(80, 40);
  await generateDerivatives(smallImage, "small-photo", storage);
  for (const variant of Object.keys(DERIVATIVE_VARIANTS) as DerivativeVariant[]) {
    const small = await sharp(
      await storage.read(storage.derivativeKey("small-photo", variant)),
    ).metadata();
    assert.deepEqual([small.width, small.height], [80, 40]);
  }
});

test("orientation is normalized in reported display dimensions", async () => {
  const base = await createImage();
  const oriented = await sharp(base)
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

  const metadata = await extractImageMetadata(oriented);

  assert.equal(metadata.orientation, 6);
  assert.deepEqual([metadata.width, metadata.height], [48, 64]);
});
