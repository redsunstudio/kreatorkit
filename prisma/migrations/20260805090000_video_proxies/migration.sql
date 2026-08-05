-- Proxy renditions of a cut (4K / 1080 / 720 lightweights) + the source geometry
-- the worker measures when it probes the master.
-- NOTE: every model carries @@map, so tables are snake_case plurals —
-- "video_versions", not "VideoVersion" (a 2026-07-25 migration crash-looped prod
-- by getting this wrong).
CREATE TYPE "VideoProxyStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'SKIPPED');

ALTER TABLE "video_versions" ADD COLUMN "sourceWidth" INTEGER;
ALTER TABLE "video_versions" ADD COLUMN "sourceHeight" INTEGER;

CREATE TABLE "video_proxies" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "height" INTEGER NOT NULL,
    "status" "VideoProxyStatus" NOT NULL DEFAULT 'PENDING',
    "objectKey" TEXT,
    "width" INTEGER,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_proxies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "video_proxies_versionId_height_key" ON "video_proxies"("versionId", "height");

CREATE INDEX "video_proxies_status_createdAt_idx" ON "video_proxies"("status", "createdAt");

ALTER TABLE "video_proxies" ADD CONSTRAINT "video_proxies_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "video_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
