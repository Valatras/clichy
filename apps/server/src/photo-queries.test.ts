import assert from "node:assert/strict";
import { test } from "node:test";

import {
  exactDuplicateWhere,
  ownedPhotoWhere,
  similarPhotoWhere,
} from "./photo-queries";

test("photo query filters always scope lookups to the authenticated user", () => {
  assert.deepEqual(ownedPhotoWhere("photo-1", "user-1"), {
    id: "photo-1",
    userId: "user-1",
  });
  assert.deepEqual(
    exactDuplicateWhere("user-1", "a".repeat(64), "photo-1"),
    {
      userId: "user-1",
      sha256: "a".repeat(64),
      id: { not: "photo-1" },
      processingStatus: "COMPLETED",
    },
  );
  assert.deepEqual(similarPhotoWhere("user-1", "photo-1"), {
    userId: "user-1",
    id: { not: "photo-1" },
    perceptualHash: { not: null },
    processingStatus: "COMPLETED",
  });
});
