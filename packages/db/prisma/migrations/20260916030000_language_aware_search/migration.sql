-- Task 65: language-aware PostgreSQL search for English and Arabic.
-- The Arabic normalizer is deliberately conservative and search-only: it never mutates stored text.
CREATE OR REPLACE FUNCTION ayin_arabic_search_normalize(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT translate(lower(coalesce(input, '')), 'أإآٱىـًٌٍَُِّْٰ', 'ااااي');
$$;

-- English stemming/tokenization for primary searchable documents.
CREATE INDEX IF NOT EXISTS "search65_video_english_fts_idx"
  ON "Video" USING GIN (
    to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", ''))
  );
CREATE INDEX IF NOT EXISTS "search65_channel_english_fts_idx"
  ON "Channel" USING GIN (
    to_tsvector('english', coalesce("name", '') || ' ' || coalesce("description", ''))
  );
CREATE INDEX IF NOT EXISTS "search65_playlist_english_fts_idx"
  ON "Playlist" USING GIN (
    to_tsvector('english', coalesce("name", '') || ' ' || coalesce("description", ''))
  );
CREATE INDEX IF NOT EXISTS "search65_series_english_fts_idx"
  ON "Series" USING GIN (
    to_tsvector('english', coalesce("title", '') || ' ' || coalesce("synopsis", ''))
  );
CREATE INDEX IF NOT EXISTS "search65_movie_english_fts_idx"
  ON "Movie" USING GIN (
    to_tsvector('english', coalesce("title", '') || ' ' || coalesce("synopsis", ''))
  );

-- Arabic matching keeps original display data intact while normalizing common Alef variants,
-- Alef Maqsura, tatweel and common harakat for indexed matching.
CREATE INDEX IF NOT EXISTS "search65_video_ar_title_prefix_idx"
  ON "Video" (ayin_arabic_search_normalize("title") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search65_video_ar_title_trgm_idx"
  ON "Video" USING GIN (ayin_arabic_search_normalize("title") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search65_video_ar_fts_idx"
  ON "Video" USING GIN (
    to_tsvector('simple', ayin_arabic_search_normalize(coalesce("title", '') || ' ' || coalesce("description", '')))
  );

CREATE INDEX IF NOT EXISTS "search65_channel_ar_name_prefix_idx"
  ON "Channel" (ayin_arabic_search_normalize("name") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search65_channel_ar_name_trgm_idx"
  ON "Channel" USING GIN (ayin_arabic_search_normalize("name") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search65_channel_ar_fts_idx"
  ON "Channel" USING GIN (
    to_tsvector('simple', ayin_arabic_search_normalize(coalesce("name", '') || ' ' || coalesce("description", '')))
  );

CREATE INDEX IF NOT EXISTS "search65_playlist_ar_name_prefix_idx"
  ON "Playlist" (ayin_arabic_search_normalize("name") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search65_playlist_ar_fts_idx"
  ON "Playlist" USING GIN (
    to_tsvector('simple', ayin_arabic_search_normalize(coalesce("name", '') || ' ' || coalesce("description", '')))
  );
CREATE INDEX IF NOT EXISTS "search65_creator_tv_ar_name_prefix_idx"
  ON "CreatorTvChannel" (ayin_arabic_search_normalize("name") text_pattern_ops);

CREATE INDEX IF NOT EXISTS "search65_series_ar_title_prefix_idx"
  ON "Series" (ayin_arabic_search_normalize("title") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search65_series_ar_fts_idx"
  ON "Series" USING GIN (
    to_tsvector('simple', ayin_arabic_search_normalize(coalesce("title", '') || ' ' || coalesce("synopsis", '')))
  );
CREATE INDEX IF NOT EXISTS "search65_movie_ar_title_prefix_idx"
  ON "Movie" (ayin_arabic_search_normalize("title") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search65_movie_ar_fts_idx"
  ON "Movie" USING GIN (
    to_tsvector('simple', ayin_arabic_search_normalize(coalesce("title", '') || ' ' || coalesce("synopsis", '')))
  );

-- Task 61 localized Movie/Series metadata participates in exact/prefix/fuzzy and language FTS.
CREATE INDEX IF NOT EXISTS "search65_series_localization_title_prefix_idx"
  ON "SeriesLocalization" (lower("title") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search65_series_localization_title_trgm_idx"
  ON "SeriesLocalization" USING GIN (lower("title") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search65_series_localization_english_fts_idx"
  ON "SeriesLocalization" USING GIN (
    to_tsvector('english', coalesce("title", '') || ' ' || coalesce("synopsis", '') || ' ' || coalesce("shortDescription", ''))
  );
CREATE INDEX IF NOT EXISTS "search65_series_localization_ar_title_prefix_idx"
  ON "SeriesLocalization" (ayin_arabic_search_normalize("title") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search65_series_localization_ar_fts_idx"
  ON "SeriesLocalization" USING GIN (
    to_tsvector('simple', ayin_arabic_search_normalize(coalesce("title", '') || ' ' || coalesce("synopsis", '') || ' ' || coalesce("shortDescription", '')))
  );

CREATE INDEX IF NOT EXISTS "search65_movie_localization_title_prefix_idx"
  ON "MovieLocalization" (lower("title") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search65_movie_localization_title_trgm_idx"
  ON "MovieLocalization" USING GIN (lower("title") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "search65_movie_localization_english_fts_idx"
  ON "MovieLocalization" USING GIN (
    to_tsvector('english', coalesce("title", '') || ' ' || coalesce("synopsis", '') || ' ' || coalesce("shortDescription", ''))
  );
CREATE INDEX IF NOT EXISTS "search65_movie_localization_ar_title_prefix_idx"
  ON "MovieLocalization" (ayin_arabic_search_normalize("title") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search65_movie_localization_ar_fts_idx"
  ON "MovieLocalization" USING GIN (
    to_tsvector('simple', ayin_arabic_search_normalize(coalesce("title", '') || ' ' || coalesce("synopsis", '') || ' ' || coalesce("shortDescription", '')))
  );
