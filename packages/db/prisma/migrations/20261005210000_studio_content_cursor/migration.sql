-- Channel-local recent-content scans, including timestamp ties and keyset pages.
-- Keep outside a transaction: the current release continues writing while migrations run.
CREATE INDEX CONCURRENTLY "video_studio_content_cursor_idx" ON "Video" ("channelId", "updatedAt", "id");
