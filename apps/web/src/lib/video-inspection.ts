export type VideoInspectionResult =
  | { status: "compatible"; message: string; durationSeconds: number | null }
  | { status: "unknown"; message: string; durationSeconds: number | null }
  | { status: "incompatible"; message: string; durationSeconds: number | null };

export function isMp4File(file: Pick<File, "type" | "name">): boolean {
  return file.type.toLowerCase() === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
}

export async function inspectVideoFile(file: File): Promise<VideoInspectionResult> {
  if (!isMp4File(file)) {
    return {
      status: "incompatible",
      message: "Choose an MP4 file. AYIN V1 uses playback-ready MP4 video.",
      durationSeconds: null,
    };
  }

  const metadata = await readLocalVideoMetadata(file);
  if (!metadata.readable) {
    return {
      status: "incompatible",
      message: "This MP4 could not be opened by your browser. Try another playback-ready file.",
      durationSeconds: null,
    };
  }

  const capability = document
    .createElement("video")
    .canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  if (capability === "probably") {
    return {
      status: "compatible",
      message:
        "MP4 looks ready for AYIN playback. Exact stream codecs may still require validation.",
      durationSeconds: metadata.durationSeconds,
    };
  }

  return {
    status: "unknown",
    message:
      "Your browser cannot confirm the exact H.264/AAC profile. You can continue; AYIN will keep the original MP4 without transcoding.",
    durationSeconds: metadata.durationSeconds,
  };
}

async function readLocalVideoMetadata(
  file: File,
): Promise<{ readable: boolean; durationSeconds: number | null }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const video = document.createElement("video");
      const finish = (result: { readable: boolean; durationSeconds: number | null }) => {
        video.removeAttribute("src");
        video.load();
        resolve(result);
      };
      video.preload = "metadata";
      video.onloadedmetadata = () =>
        finish({
          readable: true,
          durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
        });
      video.onerror = () => finish({ readable: false, durationSeconds: null });
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
