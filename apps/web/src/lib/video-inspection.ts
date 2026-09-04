export type VideoInspectionResult =
  | { status: "compatible"; message: string; durationSeconds: number | null }
  | { status: "unknown"; message: string; durationSeconds: number | null }
  | { status: "incompatible"; message: string; durationSeconds: number | null };

export type SupportedVideoContainer =
  | "mp4"
  | "mov"
  | "mkv"
  | "webm"
  | "avi"
  | "mpeg"
  | "m2ts"
  | "3gp"
  | "3g2"
  | "m4v"
  | "wmv"
  | "flv"
  | "ogv"
  | "mxf";

type UploadVideoMimeType =
  | "video/mp4"
  | "video/quicktime"
  | "video/x-matroska"
  | "video/webm"
  | "video/x-msvideo"
  | "video/mpeg"
  | "video/mp2t"
  | "video/3gpp"
  | "video/3gpp2"
  | "video/x-m4v"
  | "video/x-ms-wmv"
  | "video/x-flv"
  | "video/ogg"
  | "application/mxf";

interface SourceFormat {
  container: SupportedVideoContainer;
  mimeType: UploadVideoMimeType;
  extensions: string[];
  mimeAliases: string[];
}

const sourceFormats: SourceFormat[] = [
  {
    container: "mp4",
    mimeType: "video/mp4",
    extensions: [".mp4"],
    mimeAliases: ["video/mp4"],
  },
  {
    container: "mov",
    mimeType: "video/quicktime",
    extensions: [".mov"],
    mimeAliases: ["video/quicktime"],
  },
  {
    container: "mkv",
    mimeType: "video/x-matroska",
    extensions: [".mkv"],
    mimeAliases: ["video/x-matroska", "video/matroska"],
  },
  {
    container: "webm",
    mimeType: "video/webm",
    extensions: [".webm"],
    mimeAliases: ["video/webm"],
  },
  {
    container: "avi",
    mimeType: "video/x-msvideo",
    extensions: [".avi"],
    mimeAliases: ["video/x-msvideo", "video/avi", "video/msvideo"],
  },
  {
    container: "mpeg",
    mimeType: "video/mpeg",
    extensions: [".mpeg", ".mpg"],
    mimeAliases: ["video/mpeg"],
  },
  {
    container: "m2ts",
    mimeType: "video/mp2t",
    extensions: [".mts", ".m2ts", ".ts"],
    mimeAliases: ["video/mp2t"],
  },
  {
    container: "3gp",
    mimeType: "video/3gpp",
    extensions: [".3gp"],
    mimeAliases: ["video/3gpp"],
  },
  {
    container: "3g2",
    mimeType: "video/3gpp2",
    extensions: [".3g2"],
    mimeAliases: ["video/3gpp2"],
  },
  {
    container: "m4v",
    mimeType: "video/x-m4v",
    extensions: [".m4v"],
    mimeAliases: ["video/x-m4v", "video/m4v"],
  },
  {
    container: "wmv",
    mimeType: "video/x-ms-wmv",
    extensions: [".wmv"],
    mimeAliases: ["video/x-ms-wmv"],
  },
  {
    container: "flv",
    mimeType: "video/x-flv",
    extensions: [".flv"],
    mimeAliases: ["video/x-flv"],
  },
  {
    container: "ogv",
    mimeType: "video/ogg",
    extensions: [".ogv"],
    mimeAliases: ["video/ogg", "application/ogg"],
  },
  {
    container: "mxf",
    mimeType: "application/mxf",
    extensions: [".mxf"],
    mimeAliases: ["application/mxf"],
  },
];

function sourceFormatFor(file: Pick<File, "type" | "name">): SourceFormat | null {
  const type = file.type.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const typeMatch = sourceFormats.find((format) => format.mimeAliases.includes(type));
  if (typeMatch) return typeMatch;

  const name = file.name.toLowerCase();
  return (
    sourceFormats.find((format) =>
      format.extensions.some((extension) => name.endsWith(extension)),
    ) ?? null
  );
}

export function detectVideoContainer(
  file: Pick<File, "type" | "name">,
): SupportedVideoContainer | null {
  return sourceFormatFor(file)?.container ?? null;
}

export function isMp4File(file: Pick<File, "type" | "name">): boolean {
  return detectVideoContainer(file) === "mp4";
}

export function isSupportedVideoFile(file: Pick<File, "type" | "name">): boolean {
  return sourceFormatFor(file) !== null;
}

export function videoMimeTypeForUpload(
  file: Pick<File, "type" | "name">,
): UploadVideoMimeType {
  const format = sourceFormatFor(file);
  if (!format) throw new Error("This video format is not supported yet.");
  return format.mimeType;
}

export async function inspectVideoFile(file: File): Promise<VideoInspectionResult> {
  const container = detectVideoContainer(file);
  if (!container) {
    return {
      status: "incompatible",
      message: "This video format is not supported yet. Choose a common phone or camera video file.",
      durationSeconds: null,
    };
  }

  const metadata = await readLocalVideoMetadata(file);
  if (!metadata.readable) {
    return {
      status: "unknown",
      message: "AYIN supports this format and will prepare it for reliable playback after upload.",
      durationSeconds: null,
    };
  }

  if (container !== "mp4") {
    return {
      status: "unknown",
      message: "Video opened successfully. AYIN will prepare it for reliable playback after upload.",
      durationSeconds: metadata.durationSeconds,
    };
  }

  const video = document.createElement("video");
  const capability = video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  return {
    status: capability === "probably" ? "compatible" : "unknown",
    message:
      capability === "probably"
        ? "Video looks ready. AYIN will verify it after upload."
        : "AYIN will prepare a compatible playback version after upload.",
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
      let finished = false;
      const timeout = setTimeout(() => finish({ readable: false, durationSeconds: null }), 4000);
      const finish = (result: { readable: boolean; durationSeconds: number | null }) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
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
