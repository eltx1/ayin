export interface LocalThumbnailChoice {
  id: string;
  label: string;
  blob: Blob;
  previewUrl: string;
}

const frameFractions = [0.2, 0.5, 0.8] as const;

export async function captureLocalThumbnailChoices(file: File): Promise<LocalThumbnailChoice[]> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return [];
  }
  const videoUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = videoUrl;

  try {
    await waitForMetadata(video);
    if (
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      return [];
    }
    const choices: LocalThumbnailChoice[] = [];
    for (const [index, fraction] of frameFractions.entries()) {
      const target = Math.min(
        Math.max(0, video.duration * fraction),
        Math.max(0, video.duration - 0.05),
      );
      await seekVideo(video, target);
      const blob = await frameBlob(video);
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

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Video metadata unavailable."));
  });
}

function seekVideo(video: HTMLVideoElement, target: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Frame capture timed out.")), 4_000);
    video.onseeked = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Frame capture failed."));
    };
    video.currentTime = target;
  });
}

function frameBlob(video: HTMLVideoElement): Promise<Blob | null> {
  const maxWidth = 1280;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.drawImage(video, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
}
