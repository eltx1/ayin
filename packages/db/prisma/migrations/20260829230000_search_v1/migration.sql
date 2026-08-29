CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Video_title_search_idx" ON "Video" USING GIN ("title" gin_trgm_ops)
WHERE "status" = 'PUBLISHED' AND "visibility" = 'PUBLIC' AND "removedAt" IS NULL;
CREATE INDEX "Video_description_search_idx" ON "Video" USING GIN ("description" gin_trgm_ops)
WHERE "status" = 'PUBLISHED' AND "visibility" = 'PUBLIC' AND "removedAt" IS NULL;
CREATE INDEX "Channel_name_search_idx" ON "Channel" USING GIN ("name" gin_trgm_ops)
WHERE "status" = 'ACTIVE' AND "removedAt" IS NULL;
CREATE INDEX "Channel_handle_search_idx" ON "Channel" USING GIN ("handle" gin_trgm_ops)
WHERE "status" = 'ACTIVE' AND "removedAt" IS NULL;
CREATE INDEX "Playlist_name_search_idx" ON "Playlist" USING GIN ("name" gin_trgm_ops)
WHERE "visibility" = 'PUBLIC' AND "deletedAt" IS NULL;
CREATE INDEX "CreatorTvChannel_name_search_idx" ON "CreatorTvChannel" USING GIN ("name" gin_trgm_ops)
WHERE "status" = 'ACTIVE' AND "disabledAt" IS NULL;
