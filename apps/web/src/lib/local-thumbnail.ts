export interface LocalThumbnailChoice {
  id: string;
  label: string;
  blob: Blob;
  previewUrl: string;
}

const frameFractions = [0.2, 0.5, 0.8] as const;

export async function captureLocalThumbnailChoices(
  file: File,
  signal?: AbortSignal,
): Promise<LocalThumbnailChoice[]> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return [];
  }
  const videoUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const choices: LocalThumbnailChoice[] = [];

  try {
    signal?.throwIfAborted();
    await waitForMetadata(video, videoUrl);
    signal?.throwIfAborted();
    if (
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      return [];
    }
    for (const [index, fraction] of frameFractions.entries()) {
      const target = Math.min(
        Math.max(0, video.duration * fraction),
        Math.max(0, video.duration - 0.05),
      );
      await seekVideo(video, target);
      signal?.throwIfAborted();
      const blob = await frameBlob(video);
      signal?.throwIfAborted();
      if (!blob) continue;
      choices.push({
        id: `frame-${index + 1}`,
        label: `Frame ${index + 1}`,
        blob,
        previewUrl: URL.createObjectURL(blob),
      });
    }
    return choices;
  } catch {
    releaseLocalThumbnailChoices(choices);
    return [];
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(videoUrl);
  }
}

export function releaseLocalThumbnailChoices(choices: LocalThumbnailChoice[]): void {
  for (const choice of choices) {
    URL.revokeObjectURL(choice.previewUrl);
  }
}

function waitForMetadata(video: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (ok: boolean) => {
      window.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      if (ok) resolve();
      else reject(new Error("Video metadata unavailable."));
    };
    const timeout = window.setTimeout(() => finish(false), 4000);
    video.onloadedmetadata = () => finish(true);
    video.onerror = () => finish(false);
    video.src = url;
  });
}

function seekVideo(video: HTMLVideoElement, target: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (ok: boolean) => {
      window.clearTimeout(timeout);
      video.onseeked = null;
      video.onerror = null;
      if (ok) resolve();
      else reject(new Error("Frame capture failed."));
    };
    const timeout = window.setTimeout(() => finish(false), 4000);
    video.onseeked = () => finish(true);
    video.onerror = () => finish(false);
    video.currentTime = target;
  });
}

function frameBlob(video: HTMLVideoElement): Promise<Blob | null> {
  const maxWidth = 1280;
  const scale = Math.min(1, maxWidth / video.videoWidth, maxWidth / video.videoHeight);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.drawImage(video, 0, 0, width, height);
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), 4000);
    canvas.toBlob(
      (blob) => {
        window.clearTimeout(timeout);
        resolve(blob);
      },
      "image/jpeg",
      0.86,
    );
  });
}
