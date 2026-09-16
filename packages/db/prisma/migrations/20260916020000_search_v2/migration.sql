-- Task 64: PostgreSQL-native search quality and bounded autocomplete.
-- pg_trgm provides typo tolerance and indexed LIKE support without an external search cluster.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Video title: exact/prefix, typo tolerance, and language-neutral full text.
CREATE INDEX IF NOT EXISTS "search_video_title_prefix_idx"
  ON "Video" (lower("title") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search_video_title_trgm_idx"
  ON "Video" USING GIN (lower("title") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search_video_document_fts_idx"
  ON "Video" USING GIN (
    to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("description", ''))
  );

-- Channel weighting and autocomplete.
CREATE INDEX IF NOT EXISTS "search_channel_name_prefix_idx"
  ON "Channel" (lower("name") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search_channel_name_trgm_idx"
  ON "Channel" USING GIN (lower("name") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search_channel_handle_prefix_idx"
  ON "Channel" (lower("handle") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search_channel_handle_trgm_idx"
  ON "Channel" USING GIN (lower("handle") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search_channel_document_fts_idx"
  ON "Channel" USING GIN (
    to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("description", ''))
  );

-- Public playlist and Creator TV title lookup.
CREATE INDEX IF NOT EXISTS "search_playlist_name_prefix_idx"
  ON "Playlist" (lower("name") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search_playlist_name_trgm_idx"
  ON "Playlist" USING GIN (lower("name") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search_playlist_document_fts_idx"
  ON "Playlist" USING GIN (
    to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("description", ''))
  );
CREATE INDEX IF NOT EXISTS "search_creator_tv_name_prefix_idx"
  ON "CreatorTvChannel" (lower("name") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search_creator_tv_name_trgm_idx"
  ON "CreatorTvChannel" USING GIN (lower("name") gin_trgm_ops);

-- Movie and Series catalog identities plus genre/category signals.
CREATE INDEX IF NOT EXISTS "search_series_title_prefix_idx"
  ON "Series" (lower("title") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search_series_title_trgm_idx"
  ON "Series" USING GIN (lower("title") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search_series_document_fts_idx"
  ON "Series" USING GIN (
    to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("synopsis", ''))
  );
CREATE INDEX IF NOT EXISTS "search_series_genre_name_prefix_idx"
  ON "SeriesGenre" (lower("name") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search_series_genre_name_trgm_idx"
  ON "SeriesGenre" USING GIN (lower("name") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search_series_genre_slug_prefix_idx"
  ON "SeriesGenre" (lower("slug") text_pattern_ops);

CREATE INDEX IF NOT EXISTS "search_movie_title_prefix_idx"
  ON "Movie" (lower("title") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search_movie_title_trgm_idx"
  ON "Movie" USING GIN (lower("title") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search_movie_document_fts_idx"
  ON "Movie" USING GIN (
    to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("synopsis", ''))
  );
CREATE INDEX IF NOT EXISTS "search_movie_genre_name_prefix_idx"
  ON "MovieGenre" (lower("name") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search_movie_genre_name_trgm_idx"
  ON "MovieGenre" USING GIN (lower("name") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search_movie_genre_slug_prefix_idx"
  ON "MovieGenre" (lower("slug") text_pattern_ops);

-- Creator metadata uses exact indexed tags/category signals; public Video hydration remains authoritative.
CREATE INDEX IF NOT EXISTS "search_video_metadata_tags_gin_idx"
  ON "VideoCreatorMetadata" USING GIN ("tags");
CREATE INDEX IF NOT EXISTS "search_video_metadata_category_idx"
  ON "VideoCreatorMetadata" ("category");
