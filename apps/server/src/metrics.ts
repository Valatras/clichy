import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "@prometheus-io/client";
import type { FastifyInstance } from "fastify";

export function registerServerMetrics(fastify: FastifyInstance): void {
  const registry = new Registry();
  const requests = new Counter({
    name: "clichy_http_requests_total",
    help: "Total HTTP requests handled by the Clichy server.",
    labelNames: ["method", "route", "status_code"],
    registers: [registry],
  });
  const requestDuration = new Histogram({
    name: "clichy_http_request_duration_seconds",
    help: "HTTP request duration in seconds.",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const activeRequests = new Gauge({
    name: "clichy_http_active_requests",
    help: "Number of HTTP requests currently being handled.",
    registers: [registry],
  });
  const requestStartTimes = new WeakMap<object, bigint>();

  fastify.addHook("onRequest", async (request) => {
    if (request.url === "/metrics" || request.url.startsWith("/metrics?")) {
      return;
    }

    activeRequests.inc();
    requestStartTimes.set(request, process.hrtime.bigint());
  });

  fastify.addHook("onResponse", async (request, reply) => {
    if (request.url === "/metrics" || request.url.startsWith("/metrics?")) {
      return;
    }

    const startedAt = requestStartTimes.get(request);
    if (startedAt === undefined) {
      return;
    }

    const labels = {
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      status_code: String(reply.statusCode),
    };
    const durationSeconds =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

    requests.inc(labels);
    requestDuration.observe(labels, durationSeconds);
    activeRequests.dec();
  });

  fastify.get("/metrics", async (_request, reply) =>
    reply.type(registry.contentType).send(await registry.metrics()),
  );
}
