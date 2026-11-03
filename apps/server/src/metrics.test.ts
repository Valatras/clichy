import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";

import { registerServerMetrics } from "./metrics";

test("exports bounded HTTP metrics without counting the scrape request", async () => {
  const fastify = Fastify();
  registerServerMetrics(fastify);
  fastify.get("/photos/:photoId", async () => "ok");

  try {
    const response = await fastify.inject({
      method: "GET",
      url: "/photos/private-photo-id",
    });
    assert.equal(response.statusCode, 200);

    const metricsResponse = await fastify.inject("/metrics");
    assert.equal(metricsResponse.statusCode, 200);
    assert.match(
      metricsResponse.headers["content-type"] ?? "",
      /text\/plain/,
    );
    assert.match(
      metricsResponse.body,
      /clichy_http_requests_total\{method="GET",route="\/photos\/:photoId",status_code="200"\} 1/,
    );
    assert.match(
      metricsResponse.body,
      /clichy_http_request_duration_seconds_count\{method="GET",route="\/photos\/:photoId",status_code="200"\} 1/,
    );
    assert.match(metricsResponse.body, /clichy_http_active_requests 0/);
    assert.doesNotMatch(metricsResponse.body, /private-photo-id/);
  } finally {
    await fastify.close();
  }
});
