import "varlock/auto-load";

import { createServer } from "node:http";

import { Worker } from "bullmq";

import { createPrismaClient } from "@clichy/db";
import {
  DEFAULT_PHOTO_QUEUE_NAME,
  PHOTO_PROCESSING_JOB,
  photoProcessingJobId,
  type PhotoProcessingJob,
} from "@clichy/jobs";
import { createRedisConnection } from "@clichy/jobs/redis";

import { processPhotoJob } from "./photo-processing.worker";
import { FileSystemStorage } from "../../server/src/storage";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const concurrency = Number(process.env.PHOTO_WORKER_CONCURRENCY ?? 1);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
  throw new Error("PHOTO_WORKER_CONCURRENCY must be 1 or 2");
}

const queueName =
  process.env.PHOTO_QUEUE_NAME?.trim() || DEFAULT_PHOTO_QUEUE_NAME;
const db = createPrismaClient({ DATABASE_URL: databaseUrl });
const connection = createRedisConnection();
const storage = new FileSystemStorage();
const logger = {
  info: (fields: Record<string, unknown>, message: string) =>
    console.info(JSON.stringify({ level: "info", message, ...fields })),
  warn: (fields: Record<string, unknown>, message: string) =>
    console.warn(JSON.stringify({ level: "warn", message, ...fields })),
  error: (fields: Record<string, unknown>, message: string) =>
    console.error(JSON.stringify({ level: "error", message, ...fields })),
};
const worker = new Worker<PhotoProcessingJob>(
  queueName,
  async (job) => {
    if (job.name !== PHOTO_PROCESSING_JOB) {
      throw new Error(`Unsupported photo job name: ${job.name}`);
    }
    logger.info({ photoId: job.data.photoId, jobId: job.id }, "Photo job started");
    await processPhotoJob(
      db,
      storage,
      job.data.photoId,
      job.attemptsMade,
      Number(job.opts.attempts ?? 1),
      logger,
      job.id ?? photoProcessingJobId(job.data.photoId),
    );
  },
  { connection, concurrency },
);

worker.on("error", (error) => logger.error({ err: error }, "Worker error"));
worker.on("failed", (job, error) => {
  logger.error(
    { err: error, photoId: job?.data.photoId, jobId: job?.id },
    "Photo queue job failed",
  );
});
worker.on("ready", () => logger.info({ queueName, concurrency }, "Worker ready"));

const healthServer = createServer((request, response) => {
  const live = worker.isRunning();
  const ready = live && connection.status === "ready";
  const isReady = request.url === "/ready";
  response.writeHead(isReady ? (ready ? 200 : 503) : live ? 200 : 503, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify({ live, ready }));
});
healthServer.listen(3001, "0.0.0.0");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Worker shutting down");
  healthServer.close();
  await worker.close();
  await connection.quit();
  await db.$disconnect();
}

function handleShutdown(signal: string) {
  void shutdown(signal).catch((error: unknown) => {
    logger.error({ err: error, signal }, "Worker shutdown failed");
    process.exitCode = 1;
  });
}

process.once("SIGTERM", () => handleShutdown("SIGTERM"));
process.once("SIGINT", () => handleShutdown("SIGINT"));
