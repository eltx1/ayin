// Explicit fake provider metadata for the isolated E2E adapter; no bytes are uploaded.
export function simulatedMultipartParts(
  sizeBytes: number,
  partSizeBytes: number,
  partCount: number,
) {
  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    !Number.isSafeInteger(partSizeBytes) ||
    partSizeBytes <= 0 ||
    partCount !== Math.ceil(sizeBytes / partSizeBytes)
  )
    throw new Error("Invalid simulated multipart fixture.");
  return Array.from({ length: partCount }, (_, index) => ({
    partNumber: index + 1,
    etag: `e2e-bytes-${Math.min(partSizeBytes, sizeBytes - index * partSizeBytes)}`,
  }));
}
