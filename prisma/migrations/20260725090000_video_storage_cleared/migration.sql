-- Storage housekeeping stamp: cleanup no longer implies the Archived status
ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "storageClearedAt" TIMESTAMP(3);
