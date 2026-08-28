export function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.mp4$/i, "");
  const cleaned = withoutExtension
    .normalize("NFKC")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Untitled video";
}
