from pathlib import Path

ROOT = Path.cwd()


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"anchor missing in {path}: {old[:160]!r}")
    target.write_text(text.replace(old, new, 1))


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


# Broad, explicit source-format allowlist. Every accepted source is still normalized by FFmpeg
# before public playback; this list only controls safe ingest containers.
replace_once(
    "apps/api/src/media/media-upload.service.ts",
    '''const SUPPORTED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime"]);\n\ntype SupportedVideoMimeType = "video/mp4" | "video/quicktime";\n\nfunction normalizeVideoMimeType(value: string): SupportedVideoMimeType | null {\n  const mimeType = value.toLowerCase().split(";", 1)[0]?.trim() ?? "";\n  return SUPPORTED_VIDEO_MIME_TYPES.has(mimeType) ? (mimeType as SupportedVideoMimeType) : null;\n}\n\nfunction sourceExtension(mimeType: SupportedVideoMimeType): "mp4" | "mov" {\n  return mimeType === "video/quicktime" ? "mov" : "mp4";\n}\n''',
    '''const SOURCE_VIDEO_MIME_TO_EXTENSION = {\n  "video/mp4": "mp4",\n  "video/x-m4v": "m4v",\n  "video/quicktime": "mov",\n  "video/webm": "webm",\n  "video/x-matroska": "mkv",\n  "video/matroska": "mkv",\n  "video/x-msvideo": "avi",\n  "video/avi": "avi",\n  "video/vnd.avi": "avi",\n  "video/mpeg": "mpeg",\n  "video/3gpp": "3gp",\n  "video/3gpp2": "3g2",\n  "video/mp2t": "ts",\n} as const;\n\ntype SupportedVideoMimeType = keyof typeof SOURCE_VIDEO_MIME_TO_EXTENSION;\n\nfunction normalizeVideoMimeType(value: string): SupportedVideoMimeType | null {\n  const mimeType = value.toLowerCase().split(";", 1)[0]?.trim() ?? "";\n  return mimeType in SOURCE_VIDEO_MIME_TO_EXTENSION ? (mimeType as SupportedVideoMimeType) : null;\n}\n\nfunction sourceExtension(mimeType: SupportedVideoMimeType): string {\n  return SOURCE_VIDEO_MIME_TO_EXTENSION[mimeType];\n}\n''',
)
replace_once(
    "apps/api/src/media/media-upload.service.ts",
    '''        "Choose an MP4 or iPhone MOV video. Other source formats need transcoding before upload.",\n''',
    '''        "Choose a supported video file such as MP4, MOV, M4V, WebM, MKV, AVI, MPEG, 3GP or a common camera transport stream.",\n''',
)

replace_once(
    "apps/api/src/media/upload-session-token.service.ts",
    '''  mimeType: z.enum(["video/mp4", "video/quicktime"]),\n''',
    '''  mimeType: z.enum([\n    "video/mp4",\n    "video/x-m4v",\n    "video/quicktime",\n    "video/webm",\n    "video/x-matroska",\n    "video/matroska",\n    "video/x-msvideo",\n    "video/avi",\n    "video/vnd.avi",\n    "video/mpeg",\n    "video/3gpp",\n    "video/3gpp2",\n    "video/mp2t",\n  ]),\n''',
)

# Client-side detection deliberately trusts a known container extension even if the browser cannot
# preview that codec/container. The server/FFmpeg pipeline is the compatibility authority.
write(
    "apps/web/src/lib/video-inspection.ts",
    '''export type VideoInspectionResult =\n  | { status: "compatible"; message: string; durationSeconds: number | null }\n  | { status: "unknown"; message: string; durationSeconds: number | null }\n  | { status: "incompatible"; message: string; durationSeconds: number | null };\n\nexport type SupportedVideoContainer =\n  | "mp4"\n  | "m4v"\n  | "mov"\n  | "webm"\n  | "mkv"\n  | "avi"\n  | "mpeg"\n  | "3gp"\n  | "3g2"\n  | "ts";\n\nexport type SupportedVideoMimeType =\n  | "video/mp4"\n  | "video/x-m4v"\n  | "video/quicktime"\n  | "video/webm"\n  | "video/x-matroska"\n  | "video/x-msvideo"\n  | "video/mpeg"\n  | "video/3gpp"\n  | "video/3gpp2"\n  | "video/mp2t";\n\nconst extensionProfiles: Array<{\n  extensions: string[];\n  container: SupportedVideoContainer;\n  mimeType: SupportedVideoMimeType;\n}> = [\n  { extensions: [".mp4"], container: "mp4", mimeType: "video/mp4" },\n  { extensions: [".m4v"], container: "m4v", mimeType: "video/x-m4v" },\n  { extensions: [".mov"], container: "mov", mimeType: "video/quicktime" },\n  { extensions: [".webm"], container: "webm", mimeType: "video/webm" },\n  { extensions: [".mkv"], container: "mkv", mimeType: "video/x-matroska" },\n  { extensions: [".avi"], container: "avi", mimeType: "video/x-msvideo" },\n  { extensions: [".mpg", ".mpeg"], container: "mpeg", mimeType: "video/mpeg" },\n  { extensions: [".3gp"], container: "3gp", mimeType: "video/3gpp" },\n  { extensions: [".3g2"], container: "3g2", mimeType: "video/3gpp2" },\n  { extensions: [".ts", ".mts", ".m2ts"], container: "ts", mimeType: "video/mp2t" },\n];\n\nconst mimeProfiles = new Map<string, (typeof extensionProfiles)[number]>([\n  ["video/mp4", extensionProfiles[0]!],\n  ["video/x-m4v", extensionProfiles[1]!],\n  ["video/quicktime", extensionProfiles[2]!],\n  ["video/webm", extensionProfiles[3]!],\n  ["video/x-matroska", extensionProfiles[4]!],\n  ["video/matroska", extensionProfiles[4]!],\n  ["video/x-msvideo", extensionProfiles[5]!],\n  ["video/avi", extensionProfiles[5]!],\n  ["video/vnd.avi", extensionProfiles[5]!],\n  ["video/mpeg", extensionProfiles[6]!],\n  ["video/3gpp", extensionProfiles[7]!],\n  ["video/3gpp2", extensionProfiles[8]!],\n  ["video/mp2t", extensionProfiles[9]!],\n]);\n\nfunction profileForFile(file: Pick<File, "type" | "name">) {\n  const type = file.type.toLowerCase().split(";", 1)[0]?.trim() ?? "";\n  const byMime = mimeProfiles.get(type);\n  if (byMime) return byMime;\n  const name = file.name.toLowerCase();\n  return extensionProfiles.find((profile) =>\n    profile.extensions.some((extension) => name.endsWith(extension)),\n  );\n}\n\nexport function detectVideoContainer(\n  file: Pick<File, "type" | "name">,\n): SupportedVideoContainer | null {\n  return profileForFile(file)?.container ?? null;\n}\n\nexport function isMp4File(file: Pick<File, "type" | "name">): boolean {\n  return detectVideoContainer(file) === "mp4";\n}\n\nexport function isSupportedVideoFile(file: Pick<File, "type" | "name">): boolean {\n  return profileForFile(file) !== undefined;\n}\n\nexport function videoMimeTypeForUpload(\n  file: Pick<File, "type" | "name">,\n): SupportedVideoMimeType {\n  const profile = profileForFile(file);\n  if (!profile) {\n    throw new Error(\n      "Unsupported video source. Choose a common video file such as MP4, MOV, M4V, WebM, MKV, AVI, MPEG, 3GP, MTS or M2TS.",\n    );\n  }\n  return profile.mimeType;\n}\n\nexport async function inspectVideoFile(file: File): Promise<VideoInspectionResult> {\n  const profile = profileForFile(file);\n  if (!profile) {\n    return {\n      status: "incompatible",\n      message:\n        "Choose a common video file such as MP4, MOV, M4V, WebM, MKV, AVI, MPEG, 3GP, MTS or M2TS.",\n      durationSeconds: null,\n    };\n  }\n\n  const metadata = await readLocalVideoMetadata(file);\n  if (!metadata.readable) {\n    return {\n      status: "unknown",\n      message:\n        "Your browser cannot preview this video format, but AYIN can still upload it and prepare a compatible playback version.",\n      durationSeconds: null,\n    };\n  }\n\n  return {\n    status: "compatible",\n    message: "Video checked. AYIN will prepare it for reliable playback after upload.",\n    durationSeconds: metadata.durationSeconds,\n  };\n}\n\nasync function readLocalVideoMetadata(\n  file: File,\n): Promise<{ readable: boolean; durationSeconds: number | null }> {\n  const url = URL.createObjectURL(file);\n  try {\n    return await new Promise((resolve) => {\n      const video = document.createElement("video");\n      const finish = (result: { readable: boolean; durationSeconds: number | null }) => {\n        video.removeAttribute("src");\n        video.load();\n        resolve(result);\n      };\n      video.preload = "metadata";\n      video.onloadedmetadata = () =>\n        finish({\n          readable: true,\n          durationSeconds: Number.isFinite(video.duration) ? video.duration : null,\n        });\n      video.onerror = () => finish({ readable: false, durationSeconds: null });\n      video.src = url;\n    });\n  } finally {\n    URL.revokeObjectURL(url);\n  }\n}\n''',
)

write(
    "apps/web/src/lib/video-inspection.test.ts",
    '''import { describe, expect, it } from "vitest";\n\nimport {\n  detectVideoContainer,\n  isSupportedVideoFile,\n  videoMimeTypeForUpload,\n} from "./video-inspection";\n\ndescribe("video source detection", () => {\n  it("recognizes common phone and camera containers by MIME or extension", () => {\n    expect(detectVideoContainer({ name: "camera.bin", type: "video/mp4" })).toBe("mp4");\n    expect(detectVideoContainer({ name: "IMG_0763.MOV", type: "" })).toBe("mov");\n    expect(detectVideoContainer({ name: "android.webm", type: "" })).toBe("webm");\n    expect(detectVideoContainer({ name: "camera.MKV", type: "application/octet-stream" })).toBe(\n      "mkv",\n    );\n    expect(detectVideoContainer({ name: "legacy.avi", type: "video/x-msvideo" })).toBe("avi");\n    expect(detectVideoContainer({ name: "camcorder.M2TS", type: "" })).toBe("ts");\n    expect(detectVideoContainer({ name: "phone.3gp", type: "video/3gpp" })).toBe("3gp");\n  });\n\n  it("rejects files outside the explicit source allowlist", () => {\n    const source = { name: "archive.zip", type: "application/zip" };\n    expect(detectVideoContainer(source)).toBeNull();\n    expect(isSupportedVideoFile(source)).toBe(false);\n    expect(() => videoMimeTypeForUpload(source)).toThrow(/Unsupported video source/u);\n  });\n\n  it("normalizes extension-only camera files to a safe upload MIME", () => {\n    expect(videoMimeTypeForUpload({ name: "movie.mp4", type: "" })).toBe("video/mp4");\n    expect(videoMimeTypeForUpload({ name: "IMG_0763.mov", type: "" })).toBe(\n      "video/quicktime",\n    );\n    expect(videoMimeTypeForUpload({ name: "clip.mkv", type: "" })).toBe("video/x-matroska");\n    expect(videoMimeTypeForUpload({ name: "clip.avi", type: "" })).toBe("video/x-msvideo");\n    expect(videoMimeTypeForUpload({ name: "camera.mts", type: "" })).toBe("video/mp2t");\n  });\n});\n''',
)

replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''        Choose an MP4 or MOV video. AYIN will check the file before the upload starts.\n''',
    '''        Choose a common phone, camera or web video. AYIN will check and prepare it for playback.\n''',
)
replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''          accept="video/mp4,video/quicktime,.mp4,.mov"\n''',
    '''          accept="video/mp4,video/x-m4v,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,video/mpeg,video/3gpp,video/3gpp2,video/mp2t,.mp4,.m4v,.mov,.webm,.mkv,.avi,.mpg,.mpeg,.3gp,.3g2,.ts,.mts,.m2ts"\n''',
)

replace_once(
    "apps/web/src/lib/direct-video-upload.ts",
    '''        "R2 uploaded a part but did not expose its ETag. Check the bucket CORS ExposeHeaders setting.",\n''',
    '''        "The upload service could not verify one video part. Please retry the upload.",\n''',
)
replace_once(
    "apps/web/src/lib/direct-video-upload.ts",
    '''    request.onerror = () => reject(new Error("The direct R2 upload was interrupted."));\n''',
    '''    request.onerror = () => reject(new Error("The video upload was interrupted. Please retry."));\n''',
)
replace_once(
    "apps/web/src/lib/direct-video-upload.ts",
    '''        reject(new Error("R2 rejected this upload part. Please retry."));\n''',
    '''        reject(new Error("The upload service rejected this video part. Please retry."));\n''',
)

# API integration coverage now treats WebM/MKV/camera streams as valid ingest and rejects a truly
# unsupported file type instead.
replace_once(
    "apps/api/test/media-upload.integration.test.ts",
    '''      payload: { channelId: owner.user.channel.id, sizeBytes: 1024, mimeType: "video/webm" },\n''',
    '''      payload: { channelId: owner.user.channel.id, sizeBytes: 1024, mimeType: "application/zip" },\n''',
)
replace_once(
    "apps/api/test/media-upload.integration.test.ts",
    '''  it("marks a multipart MediaAsset uploaded only after complete succeeds", async () => {\n''',
    '''  it("accepts common transcoding source containers", async () => {\n    const owner = await register("Formats Owner", "formats-owner@example.com");\n    for (const [mimeType, extension] of [\n      ["video/webm", "webm"],\n      ["video/x-matroska", "mkv"],\n      ["video/x-msvideo", "avi"],\n      ["video/mpeg", "mpeg"],\n      ["video/3gpp", "3gp"],\n      ["video/mp2t", "ts"],\n    ] as const) {\n      const response = await app.inject({\n        method: "POST",\n        url: "/media/uploads/sessions",\n        headers: { cookie: owner.cookie },\n        payload: { channelId: owner.user.channel.id, sizeBytes: 1024, mimeType },\n      });\n      expect(response.statusCode).toBe(201);\n      expect(response.json().objectKey).toMatch(new RegExp(`source\\\\.${extension}$`, "u"));\n    }\n  });\n\n  it("marks a multipart MediaAsset uploaded only after complete succeeds", async () => {\n''',
)

# Reproducible user-space FFmpeg provisioning: fixed immutable mirror + SHA-256 verification.
replace_once(
    "deploy/release.sh",
    '''AYIN_DEPLOY_LOCK_FILE="${AYIN_DEPLOY_LOCK_FILE:-/home/ayin/.deploy.lock}"\n\nfor required in git node corepack pm2 curl flock; do\n''',
    '''AYIN_DEPLOY_LOCK_FILE="${AYIN_DEPLOY_LOCK_FILE:-/home/ayin/.deploy.lock}"\nAYIN_BIN_DIR="${AYIN_BIN_DIR:-/home/ayin/bin}"\nAYIN_FFMPEG_VERSION="7.0.2"\nAYIN_FFMPEG_ARCHIVE="ffmpeg-7.0.2-amd64-static.tar.xz"\nAYIN_FFMPEG_URL="https://github.com/publicala/ffmpeg-static/releases/download/v7.0.2/ffmpeg-7.0.2-amd64-static.tar.xz"\nAYIN_FFMPEG_SHA256="abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67"\n\nfor required in git node corepack pm2 curl flock sha256sum tar; do\n''',
)
replace_once(
    "deploy/release.sh",
    '''mkdir -p "$AYIN_RELEASES_DIR"\nmkdir -p "$(dirname "$AYIN_DEPLOY_LOCK_FILE")"\n''',
    '''ensure_ffmpeg() {\n  local ffmpeg="$AYIN_BIN_DIR/ffmpeg"\n  local ffprobe="$AYIN_BIN_DIR/ffprobe"\n  if [[ -x "$ffmpeg" && -x "$ffprobe" ]] && "$ffmpeg" -hide_banner -encoders 2>/dev/null | grep -q 'libx264'; then\n    return 0\n  fi\n\n  local temp_dir archive extracted\n  temp_dir="$(mktemp -d)"\n  archive="$temp_dir/$AYIN_FFMPEG_ARCHIVE"\n  trap 'rm -rf "$temp_dir"' RETURN\n  curl --fail --location --retry 3 --retry-delay 2 --max-time 180 \\\n    "$AYIN_FFMPEG_URL" --output "$archive"\n  printf '%s  %s\\n' "$AYIN_FFMPEG_SHA256" "$archive" | sha256sum --check --status -\n  tar -xJf "$archive" -C "$temp_dir"\n  extracted="$(find "$temp_dir" -maxdepth 1 -type d -name "ffmpeg-${AYIN_FFMPEG_VERSION}-*-static" -print -quit)"\n  [[ -n "$extracted" && -x "$extracted/ffmpeg" && -x "$extracted/ffprobe" ]] || {\n    echo "error: verified FFmpeg archive did not contain the expected binaries" >&2\n    return 1\n  }\n  install -d -m 755 "$AYIN_BIN_DIR/ffmpeg-$AYIN_FFMPEG_VERSION"\n  install -m 755 "$extracted/ffmpeg" "$AYIN_BIN_DIR/ffmpeg-$AYIN_FFMPEG_VERSION/ffmpeg"\n  install -m 755 "$extracted/ffprobe" "$AYIN_BIN_DIR/ffmpeg-$AYIN_FFMPEG_VERSION/ffprobe"\n  ln -sfn "$AYIN_BIN_DIR/ffmpeg-$AYIN_FFMPEG_VERSION/ffmpeg" "$ffmpeg"\n  ln -sfn "$AYIN_BIN_DIR/ffmpeg-$AYIN_FFMPEG_VERSION/ffprobe" "$ffprobe"\n  "$ffmpeg" -hide_banner -encoders 2>/dev/null | grep -q 'libx264' || {\n    echo "error: provisioned FFmpeg does not include libx264" >&2\n    return 1\n  }\n  "$ffprobe" -version >/dev/null\n}\n\nensure_ffmpeg\n\nmkdir -p "$AYIN_RELEASES_DIR"\nmkdir -p "$(dirname "$AYIN_DEPLOY_LOCK_FILE")"\n''',
)
replace_once(
    "deploy/release.sh",
    '''  # PM2 startOrReload preserves the original script path/arguments for existing process IDs.\n  # Releases may legitimately change their launch definition, so recreate only AYIN's two\n  # isolated processes from the ecosystem file belonging to the active release.\n  pm2 delete ayin-web >/dev/null 2>&1 || true\n  pm2 delete ayin-api >/dev/null 2>&1 || true\n\n  if ! pm2 start "$AYIN_CURRENT_LINK/deploy/ecosystem.config.cjs"; then\n''',
    '''  # Releases may change launch definitions. Recreate every isolated AYIN process so no worker\n  # can stay pinned to a previous release path after a deploy or rollback.\n  pm2 delete ayin-web >/dev/null 2>&1 || true\n  pm2 delete ayin-api >/dev/null 2>&1 || true\n  pm2 delete ayin-media-worker >/dev/null 2>&1 || true\n\n  if ! pm2 start "$AYIN_CURRENT_LINK/deploy/ecosystem.config.cjs"; then\n''',
)
replace_once(
    "deploy/release.sh",
    '''  if ! pm2 save; then\n    echo "error: PM2 state could not be persisted" >&2\n    return 1\n  fi\n''',
    '''  for app in ayin-web ayin-api ayin-media-worker; do\n    local pid\n    pid="$(pm2 pid "$app" | tail -n 1)"\n    if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]]; then\n      echo "error: PM2 application '$app' is not online" >&2\n      return 1\n    fi\n  done\n  if ! pm2 save; then\n    echo "error: PM2 state could not be persisted" >&2\n    return 1\n  fi\n''',
)

replace_once(
    "deploy/ecosystem.config.cjs",
    '''        MEDIA_PROCESSING_WORKDIR: apiEnv.MEDIA_PROCESSING_WORKDIR || "/tmp/ayin-media-processing",\n''',
    '''        MEDIA_PROCESSING_WORKDIR: apiEnv.MEDIA_PROCESSING_WORKDIR || "/tmp/ayin-media-processing",\n        FFMPEG_PATH: apiEnv.FFMPEG_PATH || "/home/ayin/bin/ffmpeg",\n        FFPROBE_PATH: apiEnv.FFPROBE_PATH || "/home/ayin/bin/ffprobe",\n''',
)

# Admin queue control center: settings remain in Platform Settings, while this page exposes live
# queue state and explicit retry/reprocess controls.
write(
    "apps/web/src/components/admin/admin-media-processing.tsx",
    '''"use client";\n\nimport Link from "next/link";\nimport { useCallback, useEffect, useState } from "react";\n\nimport styles from "@/app/admin/admin.module.css";\nimport { apiBaseUrl, readApiError } from "@/lib/api";\n\ninterface MediaJob {\n  id: string;\n  videoId: string;\n  generation: number;\n  status: string;\n  stage: string | null;\n  progressPercent: number;\n  attempt: number;\n  errorMessage: string | null;\n  updatedAt: string;\n  video: { title: string; slug: string; channelId: string };\n}\n\ninterface MediaOverview {\n  capacity: { enabled: boolean; concurrentJobs: number; retryLimit: number; leaseSeconds: number };\n  active: number;\n  counts: Record<string, number>;\n  jobs: MediaJob[];\n}\n\nexport function AdminMediaProcessing() {\n  const [data, setData] = useState<MediaOverview | null>(null);\n  const [message, setMessage] = useState("");\n  const [busyId, setBusyId] = useState<string | null>(null);\n\n  const load = useCallback(async () => {\n    try {\n      const response = await fetch(`${apiBaseUrl}/admin/media-processing`, {\n        credentials: "include",\n        cache: "no-store",\n      });\n      if (!response.ok) throw new Error(await readApiError(response));\n      setData((await response.json()) as MediaOverview);\n    } catch (error) {\n      setMessage(error instanceof Error ? error.message : "Media processing status is unavailable.");\n    }\n  }, []);\n\n  useEffect(() => {\n    void load();\n    const timer = window.setInterval(() => void load(), 5000);\n    return () => window.clearInterval(timer);\n  }, [load]);\n\n  async function action(path: string, id: string, success: string) {\n    setBusyId(id);\n    setMessage("");\n    try {\n      const response = await fetch(`${apiBaseUrl}${path}`, {\n        method: "POST",\n        credentials: "include",\n      });\n      if (!response.ok) throw new Error(await readApiError(response));\n      setMessage(success);\n      await load();\n    } catch (error) {\n      setMessage(error instanceof Error ? error.message : "The processing action failed.");\n    } finally {\n      setBusyId(null);\n    }\n  }\n\n  return (\n    <>\n      <header className={styles.header}>\n        <div>\n          <span className={styles.eyebrow}>Video operations</span>\n          <h1>Media Processing</h1>\n          <p className={styles.muted}>\n            Monitor the processing queue, retry failed videos and explicitly reprocess a completed\n            video when required. Capacity and quality controls are available in Platform Settings.\n          </p>\n        </div>\n        <Link className={styles.button} href="/admin/settings">\n          Processing settings\n        </Link>\n      </header>\n\n      {message ? <p className={styles.notice}>{message}</p> : null}\n\n      <section aria-label="Media processing summary" className={styles.metrics}>\n        <article className={styles.metric}>\n          <span className={styles.muted}>Processing</span>\n          <strong>{data?.capacity.enabled ? "Enabled" : "Paused"}</strong>\n        </article>\n        <article className={styles.metric}>\n          <span className={styles.muted}>Active jobs</span>\n          <strong>{data?.active ?? 0}</strong>\n        </article>\n        <article className={styles.metric}>\n          <span className={styles.muted}>Global capacity</span>\n          <strong>{data?.capacity.concurrentJobs ?? 0}</strong>\n        </article>\n        <article className={styles.metric}>\n          <span className={styles.muted}>Queued</span>\n          <strong>{data?.counts.QUEUED ?? 0}</strong>\n        </article>\n        <article className={styles.metric}>\n          <span className={styles.muted}>Failed</span>\n          <strong>{data?.counts.FAILED ?? 0}</strong>\n        </article>\n        <article className={styles.metric}>\n          <span className={styles.muted}>Ready</span>\n          <strong>{data?.counts.READY ?? 0}</strong>\n        </article>\n      </section>\n\n      <section className={styles.card}>\n        <div className={styles.cardHeader}>\n          <div>\n            <h2>Recent processing jobs</h2>\n            <p className={styles.muted}>Newest activity is shown first and refreshes automatically.</p>\n          </div>\n          <button className={styles.button} type="button" onClick={() => void load()}>\n            Refresh\n          </button>\n        </div>\n        <div className={styles.grid}>\n          {data?.jobs.map((job) => (\n            <article className={styles.cardInset} key={job.id}>\n              <div className={styles.cardHeader}>\n                <div>\n                  <strong>{job.video.title}</strong>\n                  <p className={styles.muted}>\n                    {job.status} · {job.stage?.replaceAll("_", " ") ?? "Waiting"} · {job.progressPercent}%\n                  </p>\n                </div>\n                <span className={styles.statusBadge}>Generation {job.generation}</span>\n              </div>\n              <p className={styles.muted}>Attempts: {job.attempt}</p>\n              {job.errorMessage ? <p className={styles.notice}>{job.errorMessage}</p> : null}\n              <div className={styles.actions}>\n                <Link className={styles.button} href={`/watch/${job.video.slug}`}>\n                  Open video\n                </Link>\n                {job.status === "FAILED" ? (\n                  <button\n                    className={styles.button}\n                    disabled={busyId === job.id}\n                    type="button"\n                    onClick={() =>\n                      void action(\n                        `/admin/media-processing/jobs/${job.id}/retry`,\n                        job.id,\n                        "Failed job returned to the queue.",\n                      )\n                    }\n                  >\n                    Retry\n                  </button>\n                ) : null}\n                {job.status === "READY" ? (\n                  <button\n                    className={styles.button}\n                    disabled={busyId === job.id}\n                    type="button"\n                    onClick={() => {\n                      if (window.confirm("Create a new processing generation for this video?")) {\n                        void action(\n                          `/admin/media-processing/videos/${job.videoId}/reprocess`,\n                          job.id,\n                          "A new processing generation was queued.",\n                        );\n                      }\n                    }}\n                  >\n                    Reprocess\n                  </button>\n                ) : null}\n              </div>\n            </article>\n          ))}\n          {data && data.jobs.length === 0 ? <p className={styles.muted}>No processing jobs yet.</p> : null}\n        </div>\n      </section>\n    </>\n  );\n}\n''',
)
write(
    "apps/web/src/app/admin/media-processing/page.tsx",
    '''import { AdminMediaProcessing } from "@/components/admin/admin-media-processing";\n\nexport default function AdminMediaProcessingPage() {\n  return <AdminMediaProcessing />;\n}\n''',
)
replace_once(
    "apps/web/src/components/admin/admin-sidebar.tsx",
    '''  { label: "Videos", href: "/admin/videos", roles: ["OPERATIONS", "CONTENT_MODERATOR"] },\n''',
    '''  { label: "Videos", href: "/admin/videos", roles: ["OPERATIONS", "CONTENT_MODERATOR"] },\n  { label: "Media Processing", href: "/admin/media-processing", roles: ["OPERATIONS"] },\n''',
)

# Keep test expectations aligned with expanded source support.
replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''        <p>Choose a video from your device. AYIN checks it and gets it ready for publishing.</p>\n''',
    '''        <p>Choose a video from your device. AYIN checks it and gets it ready for publishing.</p>\n''',
)

print("AYIN media production hardening patch applied.")
