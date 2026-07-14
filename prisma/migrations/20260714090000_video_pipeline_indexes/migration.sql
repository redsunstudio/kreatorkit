-- Composite indexes for the workspace pipeline + published tab hot paths:
-- videos are always fetched per-project filtered/ordered by status or recency.
CREATE INDEX IF NOT EXISTS "videos_projectId_status_idx" ON "videos"("projectId", "status");
CREATE INDEX IF NOT EXISTS "videos_projectId_updatedAt_idx" ON "videos"("projectId", "updatedAt" DESC);
