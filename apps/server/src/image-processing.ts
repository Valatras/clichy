import { createHash } from "node:crypto";

import exifr from "exifr";
import sharp, { type Metadata, type OutputInfo } from "sharp";

import type { Database } from "@clichy/db";

import {
  DERIVATIVE_VARIANTS,
  type DerivativeVariant,
  FileSystemStorage,
} from "./storage";

export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_CONCURRENT_IMAGE_PROCESSES = 1;
export const IMAGE_PROCESSING_VERSION = 1;

const SUPPORTED_FORMATS = {
  jpeg: { extension: ".jpg", mimeType: "image/jpeg" },
  png: { extension: ".png", mimeType: "image/png" },
  webp: { extension: ".webp", mimeType: "image/webp" },
  gif: { extension: ".gif", mimeType: "image/gif" },
} as const;

type SupportedFormat = keyof typeof SUPPORTED_FORMATS;

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export class ImageProcessingCapacityError extends Error {
  constructor() {
    super("Image processing capacity is currently full");
    this.name = "ImageProcessingCapacityError";
  }
}

export type ImageTechnicalMetadata = {
  imageFormat: SupportedFormat;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  orientation: number | null;
  dateTaken: Date | null;
  cameraMake: string | null;
  cameraModel: string | null;
  exposureTime: number | null;
  aperture: number | null;
  iso: number | null;
  focalLength: number | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
};

let activeProcesses = 0;

sharp.concurrency(1);
sharp.cache({ memory: 64, files: 20, items: 100 });

export function reserveImageProcessingSlot(): (() => void) | null {
  if (activeProcesses >= MAX_CONCURRENT_IMAGE_PROCESSES) {
    return null;
  }

  activeProcesses += 1;
  let released = false;

  return () => {
    if (!released) {
      activeProcesses -= 1;
      released = true;
    }
  };
}

function isSupportedFormat(format: string | undefined): format is SupportedFormat {
  return format !== undefined && format in SUPPORTED_FORMATS;
}

export async function inspectImage(buffer: Buffer): Promise<{
  imageFormat: SupportedFormat;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  orientation: number | null;
}> {
  let metadata: Metadata;

  try {
    metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
  } catch (error) {
    throw new ImageValidationError(
      error instanceof Error ? error.message : "The image could not be decoded",
    );
  }

  const imageFormat = metadata.format;
  if (!isSupportedFormat(imageFormat)) {
    throw new ImageValidationError("Unsupported or invalid image content");
  }

  if (!metadata.width || !metadata.height) {
    throw new ImageValidationError("Image dimensions are missing");
  }

  if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
    throw new ImageValidationError(
      `Images may not exceed ${MAX_IMAGE_PIXELS} pixels`,
    );
  }

  const orientation = metadata.orientation ?? null;
  const swapsDimensions = orientation !== null && [5, 6, 7, 8].includes(orientation);
  const format = SUPPORTED_FORMATS[imageFormat];

  return {
    imageFormat,
    mimeType: format.mimeType,
    extension: format.extension,
    width: swapsDimensions ? metadata.height : metadata.width,
    height: swapsDimensions ? metadata.width : metadata.height,
    orientation,
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInteger(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function toDate(value: unknown): Date | null {
  if (!(value instanceof Date) && typeof value !== "string") {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export async function extractImageMetadata(
  buffer: Buffer,
): Promise<ImageTechnicalMetadata> {
  const inspected = await inspectImage(buffer);
  let exif: Record<string, unknown> | undefined;

  try {
    exif = (await exifr.parse(buffer)) as Record<string, unknown> | undefined;
  } catch (error) {
    console.warn("Unable to parse optional EXIF metadata", error);
  }

  return {
    ...inspected,
    dateTaken: toDate(exif?.DateTimeOriginal ?? exif?.CreateDate),
    cameraMake: toStringOrNull(exif?.Make),
    cameraModel: toStringOrNull(exif?.Model),
    exposureTime: toFiniteNumber(exif?.ExposureTime),
    aperture: toFiniteNumber(exif?.FNumber),
    iso: toInteger(exif?.ISO),
    focalLength: toFiniteNumber(exif?.FocalLength),
    gpsLatitude: toFiniteNumber(exif?.latitude),
    gpsLongitude: toFiniteNumber(exif?.longitude),
  };
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function perceptualHash(buffer: Buffer): Promise<string> {
  let decoded: OutputInfo;
  let pixels: Buffer;

  try {
    ({ data: pixels, info: decoded } = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
      .rotate()
      .resize(32, 32, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch (error) {
    throw new ImageValidationError(
      error instanceof Error ? error.message : "The image could not be decoded",
    );
  }

  const size = 32;
  const coefficients: number[] = [];

  for (let vertical = 0; vertical < 8; vertical += 1) {
    for (let horizontal = 0; horizontal < 8; horizontal += 1) {
      let sum = 0;

      for (let y = 0; y < size; y += 1) {
        const verticalCosine = Math.cos(
          (Math.PI * (2 * y + 1) * vertical) / (2 * size),
        );

        for (let x = 0; x < size; x += 1) {
          const horizontalCosine = Math.cos(
            (Math.PI * (2 * x + 1) * horizontal) / (2 * size),
          );
          const pixel = pixels[(y * size + x) * decoded.channels]!;
          sum += pixel * verticalCosine * horizontalCosine;
        }
      }

      const verticalScale = vertical === 0 ? Math.SQRT1_2 : 1;
      const horizontalScale = horizontal === 0 ? Math.SQRT1_2 : 1;
      coefficients.push(sum * verticalScale * horizontalScale);
    }
  }

  const acCoefficients = coefficients.slice(1).sort((left, right) => left - right);
  const median = acCoefficients[Math.floor(acCoefficients.length / 2)]!;
  let hash = 0n;

  for (const coefficient of coefficients) {
    hash = (hash << 1n) | (coefficient >= median ? 1n : 0n);
  }

  return hash.toString(16).padStart(16, "0");
}

export function hammingDistance(left: string, right: string): number {
  if (!/^[\da-f]{16}$/i.test(left) || !/^[\da-f]{16}$/i.test(right)) {
    throw new Error("Perceptual hashes must be 16-character hexadecimal strings");
  }

  let differingBits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;

  while (differingBits !== 0n) {
    distance += Number(differingBits & 1n);
    differingBits >>= 1n;
  }

  return distance;
}

export async function generateDerivatives(
  buffer: Buffer,
  photoId: string,
  storage: FileSystemStorage,
): Promise<void> {
  for (const [variant, maximumDimension] of Object.entries(
    DERIVATIVE_VARIANTS,
  ) as [DerivativeVariant, number][]) {
    const derivative = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
      .rotate()
      .resize(maximumDimension, maximumDimension, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    await storage.saveDerivative(photoId, variant, derivative);
  }
}

type ProcessingDatabase = Pick<Database, "photo">;

export async function processPhoto(
  db: ProcessingDatabase,
  storage: FileSystemStorage,
  photoId: string,
  reservedSlot?: () => void,
): Promise<void> {
  const releaseSlot = reservedSlot ?? reserveImageProcessingSlot();

  if (!releaseSlot) {
    await db.photo.update({
      where: { id: photoId },
      data: {
        processingStatus: "FAILED",
        processingError: "Image processing capacity is currently full",
        processedAt: null,
      },
    });
    throw new ImageProcessingCapacityError();
  }

  let photoExists = false;

  try {
    const photo = await db.photo.findUnique({
      where: { id: photoId },
      select: { storageKey: true },
    });

    if (!photo) {
      throw new Error("Photo record not found");
    }
    photoExists = true;

    await db.photo.update({
      where: { id: photoId },
      data: {
        processingStatus: "PROCESSING",
        processingError: null,
        processedAt: null,
      },
    });

    const original = await storage.read(photo.storageKey);
    const metadata = await extractImageMetadata(original);
    const hash = sha256(original);
    const visualHash = await perceptualHash(original);

    await generateDerivatives(original, photoId, storage);

    await db.photo.update({
      where: { id: photoId },
      data: {
        sha256: hash,
        perceptualHash: visualHash,
        imageFormat: metadata.imageFormat,
        mimeType: metadata.mimeType,
        size: original.length,
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        dateTaken: metadata.dateTaken,
        cameraMake: metadata.cameraMake,
        cameraModel: metadata.cameraModel,
        exposureTime: metadata.exposureTime,
        aperture: metadata.aperture,
        iso: metadata.iso,
        focalLength: metadata.focalLength,
        gpsLatitude: metadata.gpsLatitude,
        gpsLongitude: metadata.gpsLongitude,
        processingStatus: "COMPLETED",
        processingVersion: IMAGE_PROCESSING_VERSION,
        processingError: null,
        processedAt: new Date(),
      },
    });
  } catch (error) {
    if (photoExists) {
      await db.photo.update({
        where: { id: photoId },
        data: {
          processingStatus: "FAILED",
          processingError:
            (error instanceof Error ? error.message : String(error)).slice(
              0,
              1000,
            ),
          processedAt: null,
        },
      });
    }
    throw error;
  } finally {
    releaseSlot();
  }
}
