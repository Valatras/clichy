import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PHOTO_JOB_OPTIONS,
  photoProcessingJobId,
} from "@clichy/jobs";
import { redisOptions } from "@clichy/jobs/redis";

test("photo jobs use deterministic BullMQ-safe identifiers and bounded retry retention", () => {
  const first = photoProcessingJobId("photo:with:reserved:characters");
  assert.equal(first, photoProcessingJobId("photo:with:reserved:characters"));
  assert.ok(!first.includes(":"));
  assert.equal(PHOTO_JOB_OPTIONS.attempts, 4);
  assert.deepEqual(PHOTO_JOB_OPTIONS.backoff, {
    type: "exponential",
    delay: 2000,
  });
  assert.deepEqual(PHOTO_JOB_OPTIONS.removeOnComplete, {
    age: 86400,
    count: 1000,
  });
});

test("Redis settings support authentication, database selection, and TLS", () => {
  const options = redisOptions({
    REDIS_HOST: "redis.internal",
    REDIS_PORT: "6380",
    REDIS_PASSWORD: "test-password",
    REDIS_DB: "3",
    REDIS_TLS: "true",
  });

  assert.equal(options.host, "redis.internal");
  assert.equal(options.port, 6380);
  assert.equal(options.password, "test-password");
  assert.equal(options.db, 3);
  assert.deepEqual(options.tls, { rejectUnauthorized: true });
  assert.equal(options.maxRetriesPerRequest, null);
});

test("Redis configuration rejects invalid numeric and boolean values", () => {
  assert.throws(() => redisOptions({ REDIS_PORT: "zero" }), /REDIS_PORT/);
  assert.throws(() => redisOptions({ REDIS_TLS: "yes" }), /REDIS_TLS/);
});
