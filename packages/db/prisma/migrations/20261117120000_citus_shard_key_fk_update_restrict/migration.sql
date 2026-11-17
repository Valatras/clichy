-- Citus cannot cascade updates to a column that is part of a distribution-key
-- foreign key. User IDs, Photo IDs and their shard keys are immutable here.
-- Keep delete semantics, but restrict updates for both Citus-compatible FKs.
ALTER TABLE "Photo"
  DROP CONSTRAINT IF EXISTS "Photo_userId_fkey";
ALTER TABLE "Photo"
  ADD CONSTRAINT "Photo_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PhotoProcessingOutbox"
  DROP CONSTRAINT IF EXISTS "PhotoProcessingOutbox_userId_photoId_fkey";
ALTER TABLE "PhotoProcessingOutbox"
  DROP CONSTRAINT IF EXISTS "PhotoProcessingOutbox_photoId_fkey";
ALTER TABLE "PhotoProcessingOutbox"
  ADD CONSTRAINT "PhotoProcessingOutbox_userId_photoId_fkey"
  FOREIGN KEY ("userId", "photoId")
  REFERENCES "Photo"("userId", "id")
  ON DELETE CASCADE ON UPDATE RESTRICT;
