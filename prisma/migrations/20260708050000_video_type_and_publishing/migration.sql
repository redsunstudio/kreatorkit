-- Video type (podcast / long form / short) + per-workspace publish wiring
CREATE TYPE "VideoType" AS ENUM ('PODCAST', 'LONGFORM', 'SHORT');

ALTER TABLE "videos" ADD COLUMN "videoType" "VideoType" NOT NULL DEFAULT 'LONGFORM';

ALTER TABLE "workspaces" ADD COLUMN "publishing" JSONB;
