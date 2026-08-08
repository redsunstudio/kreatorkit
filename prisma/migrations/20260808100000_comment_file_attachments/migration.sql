-- Generic file attachments on review comments (the client-requested gap left
-- after image attach: "attach an image OR A FILE to a comment"). Additive and
-- nullable - no backfill needed. Table is "comments" (@@map).

ALTER TABLE "comments" ADD COLUMN "fileUrl" TEXT;
ALTER TABLE "comments" ADD COLUMN "fileName" TEXT;

-- Same one-attachment-one-comment rule imageUrl/voiceUrl already enforce;
-- the serving route's access check depends on an attachment resolving to a
-- single video.
CREATE UNIQUE INDEX "comments_fileUrl_key" ON "comments"("fileUrl");
