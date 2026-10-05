-- Channel-local recent-content scans, including timestamp ties and keyset pages.
CREATE INDEX "video_studio_content_cursor_idx" ON "Video" ("channelId", "updatedAt", "id");
