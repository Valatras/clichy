import fastifyCors from "@fastify/cors";
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";

import { ENV } from "./env.server";
import { auth, db } from "./services";
import photoRoutes from "./routes/photos";
import { registerServerMetrics } from "./metrics";
import { createPhotoProcessingQueue } from "@clichy/jobs";
import { createRedisConnection } from "@clichy/jobs/redis";
import { startOutboxDispatcher } from "./queues/outbox-dispatcher";


const baseCorsConfig = {
  origin: ENV.CORS_ORIGIN,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  maxAge: 86400,
};

const fastify = Fastify({
  logger: true,
});

registerServerMetrics(fastify);

fastify.register(fastifyMultipart, {
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

fastify.register(fastifyCors, baseCorsConfig);

fastify.register(photoRoutes);

const redisConnection = createRedisConnection();
const photoQueue = createPhotoProcessingQueue(redisConnection);
redisConnection.on("error", (error) => {
  fastify.log.error({ err: error }, "Redis connection error");
});
photoQueue.on("error", (error) => {
  fastify.log.error({ err: error }, "Photo queue error");
});
const stopOutboxDispatcher = startOutboxDispatcher(
  db,
  photoQueue,
  fastify.log,
);
fastify.addHook("onClose", async () => {
  stopOutboxDispatcher();
  await photoQueue.close();
  await redisConnection.quit();
  await db.$disconnect();
});

fastify.route({
  method: ["GET", "POST"],
  url: "/api/auth/*",
  async handler(request, reply) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = new Headers();
      Object.entries(request.headers).forEach(([key, value]) => {
        if (value) headers.append(key, value.toString());
      });
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        body: request.body ? JSON.stringify(request.body) : undefined,
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.send(response.body ? await response.text() : null);
    } catch (error) {
      fastify.log.error({ err: error }, "Authentication Error:");
      reply.status(500).send({
        error: "Internal authentication error",
        code: "AUTH_FAILURE",
      });
    }
  },
});

fastify.get("/", async () => {
  return "OK FROM FASTIFY-CLICHY";
});

fastify.listen({ port: 3000, host: "0.0.0.0" }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log("Server running on port 3000");
});

process.once("SIGTERM", () => {
  void fastify.close().catch((error: unknown) => {
    fastify.log.error({ err: error }, "Server shutdown failed");
    process.exitCode = 1;
  });
});
process.once("SIGINT", () => {
  void fastify.close().catch((error: unknown) => {
    fastify.log.error({ err: error }, "Server shutdown failed");
    process.exitCode = 1;
  });
});
