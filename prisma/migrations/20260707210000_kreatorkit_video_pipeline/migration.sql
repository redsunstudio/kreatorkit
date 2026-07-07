-- KreatorKit production pipeline: video lifecycle status + brief
CREATE TYPE "VideoStatus" AS ENUM ('IDEA', 'FILMED', 'EDITING', 'REVIEW', 'APPROVED', 'PUBLISHED');
ALTER TABLE "videos" ADD COLUMN "status" "VideoStatus" NOT NULL DEFAULT 'REVIEW';
ALTER TABLE "videos" ADD COLUMN "brief" TEXT;
CREATE INDEX "videos_status_idx" ON "videos"("status");
