import type { StudioComment } from "./studio";

export type CommentVisibility = "ALL" | "PUBLISHED" | "HIDDEN";

// Filters only the API's bounded recent snapshot, never claims a global search.
export function filterRecentComments(
  comments: readonly StudioComment[],
  query: string,
  visibility: CommentVisibility,
) {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
  const needle = normalize(query.trim());
  return comments.filter(
    (comment) =>
      (visibility === "ALL" || comment.status === visibility) &&
      (!needle ||
        [comment.body, comment.authorProfile.name, comment.video.title].some((value) =>
          normalize(value).includes(needle),
        )),
  );
}
