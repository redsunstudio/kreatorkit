-- Review markers: orange signposts on a cut's timeline.
-- NOTE: every model here carries @@map, so the tables are snake_case plurals —
-- "video_versions", not "VideoVersion" (a 2026-07-25 migration crash-looped prod
-- by getting this wrong).
CREATE TABLE "video_markers" (
    "id" TEXT NOT NULL,
    "timestamp" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_markers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "video_markers_versionId_idx" ON "video_markers"("versionId");

CREATE INDEX "video_markers_versionId_timestamp_idx" ON "video_markers"("versionId", "timestamp");

ALTER TABLE "video_markers" ADD CONSTRAINT "video_markers_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "video_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
