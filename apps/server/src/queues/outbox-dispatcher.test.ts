import assert from "node:assert/strict";
import { test } from "node:test";

import { photoProcessingJobId } from "@clichy/jobs";

import {
  dispatchOutboxOnce,
  recoverStalePhotos,
} from "./outbox-dispatcher";

type OutboxDb = Parameters<typeof dispatchOutboxOnce>[0];

function createHarness() {
  const event = {
    id: "outbox-a",
    photoId: "photo-a",
    attempts: 0,
  };
  let publishedAt: Date | null = null;
  let attempts = 0;
  let lastError: string | null = null;
  const db = {
    photoProcessingOutbox: {
      findMany: async () => (publishedAt ? [] : [event]),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.publishedAt instanceof Date) publishedAt = data.publishedAt;
        if (typeof data.attempts === "object" && data.attempts !== null) {
          attempts += 1;
        }
        if (typeof data.lastError === "string") lastError = data.lastError;
        if (data.lastError === null) lastError = null;
        return {};
      },
    },
  } as unknown as OutboxDb;
  const logger = { info: () => {}, error: () => {} };
  return {
    db,
    logger,
    state: () => ({ publishedAt, attempts, lastError }),
  };
}

test("outbox publishes the minimum payload with a stable job ID", async () => {
  const harness = createHarness();
  let enqueued: unknown;
  const queue = {
    getJob: async () => undefined,
    add: async (...args: unknown[]) => {
      enqueued = args;
      return {};
    },
  };

  const result = await dispatchOutboxOnce(
    harness.db,
    queue as unknown as Parameters<typeof dispatchOutboxOnce>[1],
    harness.logger,
  );

  assert.deepEqual(result, { published: 1, failed: 0 });
  assert.deepEqual(enqueued, [
    "process-photo",
    { photoId: "photo-a" },
    { jobId: photoProcessingJobId("photo-a") },
  ]);
  assert.ok(harness.state().publishedAt);
});

test("outbox retains failed events for retry when Redis is unavailable", async () => {
  const harness = createHarness();
  const queue = {
    getJob: async () => undefined,
    add: async () => {
      throw new Error("Redis unavailable");
    },
  };

  const result = await dispatchOutboxOnce(
    harness.db,
    queue as unknown as Parameters<typeof dispatchOutboxOnce>[1],
    harness.logger,
  );

  assert.deepEqual(result, { published: 0, failed: 1 });
  assert.deepEqual(harness.state(), {
    publishedAt: null,
    attempts: 1,
    lastError: "Redis unavailable",
  });
});

test("outbox removes retained terminal jobs before publishing a recovery event", async () => {
  const harness = createHarness();
  let removed = false;
  const queue = {
    getJob: async () => ({
      getState: async () => "failed",
      remove: async () => {
        removed = true;
      },
    }),
    add: async () => ({}),
  };

  await dispatchOutboxOnce(
    harness.db,
    queue as unknown as Parameters<typeof dispatchOutboxOnce>[1],
    harness.logger,
  );
  assert.equal(removed, true);
});

test("stale processing records are reset and get a transactional recovery event", async () => {
  let updateWhere: Record<string, unknown> | undefined;
  let createdEvents = 0;
  let findManyCalls = 0;
  const db = {
    photo: {
      findMany: async () => {
        findManyCalls += 1;
        return findManyCalls === 1 ? [{ id: "legacy-processing" }] : [];
      },
      updateMany: async ({
        where,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        updateWhere = where;
        return { count: 1 };
      },
    },
    photoProcessingOutbox: {
      create: async () => {
        createdEvents += 1;
        return {};
      },
    },
    $transaction: async (
      operation: (transaction: {
        photo: {
          updateMany: (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => Promise<{ count: number }>;
        };
        photoProcessingOutbox: {
          create: (args: { data: { photoId: string } }) => Promise<unknown>;
        };
      }) => Promise<number>,
    ) =>
      operation({
        photo: {
          updateMany: async ({ where, data }) =>
            db.photo.updateMany({ where, data }),
        },
        photoProcessingOutbox: {
          create: async (args) => db.photoProcessingOutbox.create(args),
        },
      }),
  } as unknown as Parameters<typeof recoverStalePhotos>[0];

  const recovered = await recoverStalePhotos(
    db,
    { warn: () => {} },
    new Date("2026-11-14T12:00:00.000Z"),
  );

  assert.equal(recovered, 1);
  assert.equal(createdEvents, 1);
  assert.deepEqual(updateWhere?.OR, [
    { processingStartedAt: { lt: new Date("2026-11-14T11:45:00.000Z") } },
    {
      processingStartedAt: null,
      createdAt: { lt: new Date("2026-11-14T11:45:00.000Z") },
    },
  ]);
});
