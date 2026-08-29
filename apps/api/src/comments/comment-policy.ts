export interface CommentPolicy {
  maxLength: number;
  blockedTerms: string[];
  editWindowMinutes: number;
}

export const defaultCommentPolicy: CommentPolicy = {
  maxLength: 3_000,
  blockedTerms: [],
  editWindowMinutes: 30,
};

export function normalizeCommentBody(input: string, policy: CommentPolicy): string {
  const normalized = input
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) throw new Error("COMMENT_EMPTY");
  if (normalized.length > policy.maxLength) throw new Error("COMMENT_TOO_LONG");
  const folded = normalized.toLocaleLowerCase();
  if (policy.blockedTerms.some((term) => term && folded.includes(term.toLocaleLowerCase()))) {
    throw new Error("COMMENT_BLOCKED_TERM");
  }
  return normalized;
}

export function canEditComment(createdAt: Date, now: Date, policy: CommentPolicy): boolean {
  return now.getTime() - createdAt.getTime() <= policy.editWindowMinutes * 60_000;
}
