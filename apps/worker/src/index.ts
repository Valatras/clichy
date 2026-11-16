import "varlock/auto-load";

import { createServer } from "node:http";

import { Queue, Worker } from "bullmq";
import { Counter, Gauge, Histogram, Registry } from "@prometheus-io/client";

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
const queueMonitor = new Queue<PhotoProcessingJob>(queueName, { connection });
const storage = new FileSystemStorage();
const metricsRegistry = new Registry();
const queueJobCounts = new Gauge({
  name: "clichy_photo_queue_jobs",
  help: "BullMQ photo jobs by queue state.",
  labelNames: ["state"],
  registers: [metricsRegistry],
});
const queueMetricsAvailable = new Gauge({
  name: "clichy_photo_queue_metrics_available",
  help: "Whether the worker can currently collect BullMQ queue metrics.",
  registers: [metricsRegistry],
});
const completedJobs = new Counter({
  name: "clichy_photo_worker_jobs_completed_total",
  help: "BullMQ photo jobs completed by this worker process, including safe no-op deliveries.",
  registers: [metricsRegistry],
});
const failedAttempts = new Counter({
  name: "clichy_photo_worker_job_failures_total",
  help: "BullMQ photo job attempts that failed in this worker process, including attempts that will retry.",
  registers: [metricsRegistry],
});
const jobDuration = new Histogram({
  name: "clichy_photo_worker_job_duration_seconds",
  help: "Duration of photo job handler executions in seconds.",
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [metricsRegistry],
});
const queueStates = ["waiting", "active", "completed", "failed", "delayed"] as const;
for (const state of queueStates) queueJobCounts.set({ state }, 0);
queueMetricsAvailable.set(0);
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
    const startedAt = process.hrtime.bigint();
    try {
      await processPhotoJob(
        db,
        storage,
        job.data.photoId,
        job.attemptsMade,
        Number(job.opts.attempts ?? 1),
        logger,
        job.id ?? photoProcessingJobId(job.data.photoId),
      );
      completedJobs.inc();
    } catch (error) {
      failedAttempts.inc();
      throw error;
    } finally {
      jobDuration.observe(
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000,
      );
    }
  },
  { connection, concurrency },
);

async function refreshQueueMetrics() {
  try {
    const counts = await queueMonitor.getJobCounts(...queueStates);
    for (const state of queueStates) {
      queueJobCounts.set({ state }, counts[state] ?? 0);
    }
    queueMetricsAvailable.set(1);
  } catch (error) {
    queueMetricsAvailable.set(0);
    logger.warn({ err: error }, "Unable to refresh BullMQ queue metrics");
  }
}

void refreshQueueMetrics();
const queueMetricsTimer = setInterval(() => void refreshQueueMetrics(), 15_000);
queueMetricsTimer.unref();

worker.on("error", (error) => logger.error({ err: error }, "Worker error"));
worker.on("failed", (job, error) => {
  logger.error(
    { err: error, photoId: job?.data.photoId, jobId: job?.id },
    "Photo queue job failed",
  );
});
worker.on("ready", () => logger.info({ queueName, concurrency }, "Worker ready"));

const healthServer = createServer((request, response) => {
  if (request.url === "/metrics") {
    void metricsRegistry
      .metrics()
      .then((metrics) => {
        response.writeHead(200, { "content-type": metricsRegistry.contentType });
        response.end(metrics);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "Worker metrics collection failed");
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end("Metrics collection failed\n");
      });
    return;
  }

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
  clearInterval(queueMetricsTimer);
  healthServer.close();
  await worker.close();
  await queueMonitor.close();
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
