ALTER TABLE "Photo"
ADD COLUMN "processingStartedAt" TIMESTAMP(3),
ADD COLUMN "deletingAt" TIMESTAMP(3);

CREATE INDEX "Photo_processingStatus_processingStartedAt_idx"
ON "Photo"("processingStatus", "processingStartedAt");
CREATE INDEX "Photo_deletingAt_idx" ON "Photo"("deletingAt");

CREATE TABLE "PhotoProcessingOutbox" (
  "id" TEXT NOT NULL,
  "photoId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  CONSTRAINT "PhotoProcessingOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PhotoProcessingOutbox_publishedAt_createdAt_idx"
ON "PhotoProcessingOutbox"("publishedAt", "createdAt");
ALTER TABLE "PhotoProcessingOutbox"
ADD CONSTRAINT "PhotoProcessingOutbox_photoId_fkey"
FOREIGN KEY ("photoId") REFERENCES "Photo"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
