export type VideoInspectionResult =
  | { status: "compatible"; message: string; durationSeconds: number | null }
  | { status: "unknown"; message: string; durationSeconds: number | null }
  | { status: "incompatible"; message: string; durationSeconds: number | null };

export type SupportedVideoContainer = "mp4" | "mov";

export function detectVideoContainer(
  file: Pick<File, "type" | "name">,
): SupportedVideoContainer | null {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type === "video/mp4" || name.endsWith(".mp4")) return "mp4";
  if (type === "video/quicktime" || name.endsWith(".mov")) return "mov";
  return null;
}

export function isMp4File(file: Pick<File, "type" | "name">): boolean {
  return detectVideoContainer(file) === "mp4";
}

export function isSupportedVideoFile(file: Pick<File, "type" | "name">): boolean {
  return detectVideoContainer(file) !== null;
}

export function videoMimeTypeForUpload(
  file: Pick<File, "type" | "name">,
): "video/mp4" | "video/quicktime" {
  const container = detectVideoContainer(file);
  if (container === "mp4") return "video/mp4";
  if (container === "mov") return "video/quicktime";
  throw new Error("Unsupported video source. Choose an MP4 or iPhone MOV video.");
}

export async function inspectVideoFile(file: File): Promise<VideoInspectionResult> {
  const container = detectVideoContainer(file);
  if (!container) {
    return {
      status: "incompatible",
      message:
        "Choose an MP4 or iPhone MOV video. Other source formats need transcoding before upload.",
      durationSeconds: null,
    };
  }

  const metadata = await readLocalVideoMetadata(file);
  if (!metadata.readable) {
    return {
      status: "incompatible",
      message:
        container === "mov"
          ? "This MOV could not be opened by your browser. Try another iPhone video or an MP4 export."
          : "This MP4 could not be opened by your browser. Try another playback-ready file.",
      durationSeconds: null,
    };
  }

  const video = document.createElement("video");
  if (container === "mov") {
    return {
      status: "unknown",
      message:
        "iPhone MOV opened successfully. AYIN will prepare an H.264/AAC MP4 after upload for reliable web, Android and TV playback.",
      durationSeconds: metadata.durationSeconds,
    };
  }

  const capability = video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
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
      "Your browser cannot confirm the exact codec profile. You can continue; AYIN will prepare a canonical H.264/AAC MP4 after upload.",
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
