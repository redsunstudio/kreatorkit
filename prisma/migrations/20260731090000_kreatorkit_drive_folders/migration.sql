-- Workspace Drive: flat folders + the folderId link on workspace_uploads.
-- Hand-authored following the exact pattern of 20260728120000_workspace_drive
-- (this repo's own convention when `prisma migrate diff` needs a live DB this
-- environment doesn't have). Additive only: new table, nullable column, new
-- indexes/FKs — no existing rows touched. folderId FK is SET NULL, never
-- CASCADE, so deleting a folder can never delete files.

CREATE TABLE "workspace_upload_folders" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_upload_folders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "workspace_uploads" ADD COLUMN "folderId" TEXT;

CREATE INDEX "workspace_upload_folders_workspaceId_idx" ON "workspace_upload_folders"("workspaceId");
CREATE INDEX "workspace_upload_folders_workspaceId_createdAt_idx" ON "workspace_upload_folders"("workspaceId", "createdAt" DESC);
CREATE INDEX "workspace_upload_folders_workspaceId_name_idx" ON "workspace_upload_folders"("workspaceId", "name");
CREATE INDEX "workspace_uploads_folderId_idx" ON "workspace_uploads"("folderId");

ALTER TABLE "workspace_upload_folders" ADD CONSTRAINT "workspace_upload_folders_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_uploads" ADD CONSTRAINT "workspace_uploads_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "workspace_upload_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
