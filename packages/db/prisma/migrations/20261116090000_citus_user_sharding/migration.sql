-- Make each user's photo rows and outbox events colocatable by Citus.
-- The statements before the branch are repeatable because Prisma does not roll
-- back a failed migration automatically.
ALTER TABLE "PhotoProcessingOutbox"
  ADD COLUMN IF NOT EXISTS "userId" TEXT;

UPDATE "PhotoProcessingOutbox" AS outbox
SET "userId" = photo."userId"
FROM "Photo" AS photo
WHERE photo."id" = outbox."photoId"
  AND outbox."userId" IS NULL;

-- Citus does not support a cross-shard cascading delete from its replicated
-- identity table into distributed Photo rows. Restrict deletion instead.
ALTER TABLE "Photo"
  DROP CONSTRAINT IF EXISTS "Photo_userId_fkey";

ALTER TABLE "Photo"
  ADD CONSTRAINT "Photo_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "PhotoProcessingOutbox_userId_photoId_idx"
  ON "PhotoProcessingOutbox"("userId", "photoId");

DO $$
BEGIN
  IF current_database() = 'clichy_prod' THEN
    -- Keep old Production Pods writable: they insert outbox rows without userId.
    CREATE UNIQUE INDEX IF NOT EXISTS "Photo_userId_id_key"
      ON "Photo"("userId", "id");
    CREATE UNIQUE INDEX IF NOT EXISTS "Photo_userId_storageKey_key"
      ON "Photo"("userId", "storageKey");
    CREATE UNIQUE INDEX IF NOT EXISTS "PhotoProcessingOutbox_userId_id_key"
      ON "PhotoProcessingOutbox"("userId", "id");

    ALTER TABLE "PhotoProcessingOutbox"
      DROP CONSTRAINT IF EXISTS "PhotoProcessingOutbox_userId_photoId_fkey";
    ALTER TABLE "PhotoProcessingOutbox"
      ADD CONSTRAINT "PhotoProcessingOutbox_userId_photoId_fkey"
      FOREIGN KEY ("userId", "photoId")
      REFERENCES "Photo"("userId", "id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  ELSE
    ALTER TABLE "PhotoProcessingOutbox"
      DROP CONSTRAINT IF EXISTS "PhotoProcessingOutbox_userId_photoId_fkey";
    ALTER TABLE "PhotoProcessingOutbox"
      DROP CONSTRAINT IF EXISTS "PhotoProcessingOutbox_photoId_fkey";
    ALTER TABLE "PhotoProcessingOutbox"
      ALTER COLUMN "userId" SET NOT NULL;

    ALTER TABLE "Photo"
      DROP CONSTRAINT IF EXISTS "Photo_pkey";
    ALTER TABLE "Photo"
      ADD CONSTRAINT "Photo_pkey" PRIMARY KEY ("userId", "id");

    -- Prisma created this as a standalone unique index, not a table constraint.
    ALTER TABLE "Photo"
      DROP CONSTRAINT IF EXISTS "Photo_storageKey_key";
    DROP INDEX IF EXISTS "Photo_storageKey_key";
    CREATE UNIQUE INDEX IF NOT EXISTS "Photo_userId_storageKey_key"
      ON "Photo"("userId", "storageKey");

    ALTER TABLE "PhotoProcessingOutbox"
      DROP CONSTRAINT IF EXISTS "PhotoProcessingOutbox_pkey";
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
