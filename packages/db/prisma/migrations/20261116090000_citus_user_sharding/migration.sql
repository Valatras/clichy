-- Make each user's photo rows and outbox events colocatable by Citus.
-- Test and local/Dev use the full composite primary keys. Production keeps
-- its old single-column keys during the rolling-compatible transition; the
-- matching composite unique indexes support the new Prisma client meanwhile.

ALTER TABLE "PhotoProcessingOutbox"
  ADD COLUMN "userId" TEXT;

UPDATE "PhotoProcessingOutbox" AS outbox
SET "userId" = photo."userId"
FROM "Photo" AS photo
WHERE photo."id" = outbox."photoId";

-- Citus does not support a cross-shard cascading delete from its replicated
-- identity table into distributed Photo rows. Restrict deletion instead.
ALTER TABLE "Photo"
  DROP CONSTRAINT "Photo_userId_fkey";

ALTER TABLE "Photo"
  ADD CONSTRAINT "Photo_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PhotoProcessingOutbox_userId_photoId_idx"
  ON "PhotoProcessingOutbox"("userId", "photoId");

DO $$
BEGIN
  IF current_database() = 'clichy_prod' THEN
    -- Keep existing write paths valid while the old Production Pods are still
    -- running: they do not send userId when inserting outbox rows.
    CREATE UNIQUE INDEX "Photo_userId_id_key"
      ON "Photo"("userId", "id");
    CREATE UNIQUE INDEX "Photo_userId_storageKey_key"
      ON "Photo"("userId", "storageKey");
    CREATE UNIQUE INDEX "PhotoProcessingOutbox_userId_id_key"
      ON "PhotoProcessingOutbox"("userId", "id");
    ALTER TABLE "PhotoProcessingOutbox"
      ADD CONSTRAINT "PhotoProcessingOutbox_userId_photoId_fkey"
      FOREIGN KEY ("userId", "photoId")
      REFERENCES "Photo"("userId", "id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  ELSE
    ALTER TABLE "PhotoProcessingOutbox"
      DROP CONSTRAINT "PhotoProcessingOutbox_photoId_fkey";
    ALTER TABLE "PhotoProcessingOutbox"
      ALTER COLUMN "userId" SET NOT NULL;

    ALTER TABLE "Photo"
      DROP CONSTRAINT "Photo_pkey";
    ALTER TABLE "Photo"
      ADD CONSTRAINT "Photo_pkey" PRIMARY KEY ("userId", "id");
    ALTER TABLE "Photo"
      DROP CONSTRAINT "Photo_storageKey_key";
    CREATE UNIQUE INDEX "Photo_userId_storageKey_key"
      ON "Photo"("userId", "storageKey");

    ALTER TABLE "PhotoProcessingOutbox"
      DROP CONSTRAINT "PhotoProcessingOutbox_pkey";
    ALTER TABLE "PhotoProcessingOutbox"
      ADD CONSTRAINT "PhotoProcessingOutbox_pkey" PRIMARY KEY ("userId", "id");
    ALTER TABLE "PhotoProcessingOutbox"
      ADD CONSTRAINT "PhotoProcessingOutbox_userId_photoId_fkey"
      FOREIGN KEY ("userId", "photoId")
      REFERENCES "Photo"("userId", "id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
