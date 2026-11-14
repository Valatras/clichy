CREATE TYPE "ImageProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "Photo"
ADD COLUMN "sha256" VARCHAR(64),
ADD COLUMN "perceptualHash" VARCHAR(16),
ADD COLUMN "imageFormat" TEXT,
ADD COLUMN "width" INTEGER,
ADD COLUMN "height" INTEGER,
ADD COLUMN "orientation" INTEGER,
ADD COLUMN "dateTaken" TIMESTAMP(3),
ADD COLUMN "cameraMake" TEXT,
ADD COLUMN "cameraModel" TEXT,
ADD COLUMN "exposureTime" DOUBLE PRECISION,
ADD COLUMN "aperture" DOUBLE PRECISION,
ADD COLUMN "iso" INTEGER,
ADD COLUMN "focalLength" DOUBLE PRECISION,
ADD COLUMN "gpsLatitude" DOUBLE PRECISION,
ADD COLUMN "gpsLongitude" DOUBLE PRECISION,
ADD COLUMN "processingStatus" "ImageProcessingStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "processingVersion" INTEGER,
ADD COLUMN "processingError" TEXT,
ADD COLUMN "processedAt" TIMESTAMP(3);

CREATE INDEX "Photo_userId_sha256_idx" ON "Photo"("userId", "sha256");
CREATE INDEX "Photo_userId_perceptualHash_idx" ON "Photo"("userId", "perceptualHash");
