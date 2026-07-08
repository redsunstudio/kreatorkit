-- Workspace brand asset library (logos, fonts, brand kits) — survives video archiving
CREATE TABLE "workspace_assets" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_assets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "workspace_assets_workspaceId_idx" ON "workspace_assets"("workspaceId");
ALTER TABLE "workspace_assets" ADD CONSTRAINT "workspace_assets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_assets" ADD CONSTRAINT "workspace_assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
