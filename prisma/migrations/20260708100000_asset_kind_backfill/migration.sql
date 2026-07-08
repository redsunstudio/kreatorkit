-- Data fix: generic-path uploads were stored as kind FILE even for images —
-- reclassify by extension so post media, previews and pushes see them.
UPDATE "video_assets"
SET "kind" = 'IMAGE'
WHERE "provider" = 'R2_FILE'
  AND "kind" = 'FILE'
  AND ("displayName" ~* '\.(png|jpg|jpeg|webp|gif)$');

UPDATE "video_assets"
SET "kind" = 'AUDIO'
WHERE "provider" = 'R2_FILE'
  AND "kind" = 'FILE'
  AND ("displayName" ~* '\.(mp3|wav|m4a|aac|flac)$');
