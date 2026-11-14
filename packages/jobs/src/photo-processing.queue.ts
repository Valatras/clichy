import { createHash } from "node:crypto";

import { Queue, type JobsOptions } from "bullmq";
import type IORedis from "ioredis";

import { createRedisConnection } from "./redis";

export const PHOTO_PROCESSING_JOB = "process-photo";
export const DEFAULT_PHOTO_QUEUE_NAME = "photo-processing";

export type PhotoProcessingJob = {
  photoId: string;
};

export function photoProcessingJobId(photoId: string): string {
  return `photo-${createHash("sha256").update(photoId).digest("hex")}`;
}

export const PHOTO_JOB_OPTIONS: JobsOptions = {
  attempts: positiveInteger(
    process.env.PHOTO_JOB_ATTEMPTS,
    4,
    "PHOTO_JOB_ATTEMPTS",
  ),
  backoff: {
    type: "exponential",
    delay: positiveInteger(
      process.env.PHOTO_JOB_BACKOFF_MS,
      2000,
      "PHOTO_JOB_BACKOFF_MS",
    ),
  },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: { age: 604800, count: 5000 },
};

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function createPhotoProcessingQueue(
  connection: IORedis = createRedisConnection(),
  name = process.env.PHOTO_QUEUE_NAME || DEFAULT_PHOTO_QUEUE_NAME,
) {
  if (!name.trim()) throw new Error("PHOTO_QUEUE_NAME must not be empty");
  return new Queue<PhotoProcessingJob>(name, {
    connection,
    defaultJobOptions: PHOTO_JOB_OPTIONS,
  });
}
