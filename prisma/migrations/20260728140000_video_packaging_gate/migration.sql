-- Packaging gate: title + thumbnail + description confirmed BEFORE the edit
-- starts, plus a members-only flag that blocks the automated YouTube push.
-- Table is "videos" (@@map). Column types copied from
-- `prisma migrate diff --from-empty --to-schema`.

ALTER TABLE "videos" ADD COLUMN "packagingConfirmedAt" TIMESTAMP(3);
ALTER TABLE "videos" ADD COLUMN "packagingConfirmedById" TEXT;
ALTER TABLE "videos" ADD COLUMN "packagingConfirmedName" TEXT;
ALTER TABLE "videos" ADD COLUMN "membersOnly" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: anything that ALREADY has a thumbnail and a description was packaged
-- under the old (end-of-process) workflow, so grandfather it in. Without this the
-- gate would retroactively block approval on live client items that are genuinely
-- finished. Items missing either field are correctly left unconfirmed.
UPDATE "videos"
SET "packagingConfirmedAt" = COALESCE("updatedAt", NOW()),
    "packagingConfirmedName" = 'backfilled (pre-gate)'
WHERE "thumbnailUrl" IS NOT NULL
  AND btrim("thumbnailUrl") <> ''
  AND "description" IS NOT NULL
  AND btrim("description") <> '';
