-- Publish trail: Zernio post link, YouTube URL, synced analytics
ALTER TABLE "videos" ADD COLUMN "zernioPostId" TEXT;
ALTER TABLE "videos" ADD COLUMN "publishedUrl" TEXT;
ALTER TABLE "videos" ADD COLUMN "publishStats" JSONB;
ALTER TABLE "videos" ADD COLUMN "publishStatsAt" TIMESTAMP(3);
