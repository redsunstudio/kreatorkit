-- ABC packaging test: up to three candidate title+thumbnail pairs per video
-- for YouTube's Test & Compare. Table is "videos" (@@map). Additive only —
-- no existing rows are touched.

ALTER TABLE "videos" ADD COLUMN "packagingOptions" JSONB;
