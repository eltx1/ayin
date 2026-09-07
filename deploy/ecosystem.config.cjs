"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile } = require("./env-file.cjs");

const currentDir = process.env.AYIN_CURRENT_DIR || "/home/ayin/htdocs/current";
const webEnvFile = process.env.AYIN_WEB_ENV_FILE || "/home/ayin/env/web.env";
const apiEnvFile = process.env.AYIN_API_ENV_FILE || "/home/ayin/env/api.env";

const webEnv = loadEnvFile(webEnvFile);
const apiEnv = loadEnvFile(apiEnvFile);

function releaseSha() {
  try {
    const head = fs.readFileSync(path.join(currentDir, ".git", "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head.toLowerCase();
  } catch {}
  const fallback = process.env.AYIN_RELEASE_SHA || "";
  return /^[0-9a-f]{40}$/i.test(fallback) ? fallback.toLowerCase() : "unknown";
}

const currentReleaseSha = releaseSha();

module.exports = {
  apps: [
    {
      name: "ayin-web",
      cwd: path.join(currentDir, "apps/web"),
      script: path.join(currentDir, "apps/web/node_modules/next/dist/bin/next"),
      args: "start --hostname 127.0.0.1 --port 3000",
      interpreter: "node",
      env: {
        ...webEnv,
        NODE_ENV: "production",
        AYIN_RELEASE_SHA: currentReleaseSha,
        AYIN_SERVICE_NAME: "ayin-web",
      },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 10000,
      listen_timeout: 10000,
      time: true,
    },
    {
      name: "ayin-api",
      cwd: path.join(currentDir, "apps/api"),
      script: "dist/main.js",
      interpreter: "node",
      node_args: "--enable-source-maps",
      env: {
        ...apiEnv,
        NODE_ENV: "production",
        APP_ENV: "production",
        API_HOST: "127.0.0.1",
        PORT: "4000",
        AYIN_RELEASE_SHA: currentReleaseSha,
        AYIN_SERVICE_NAME: "ayin-api",
      },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 10000,
      listen_timeout: 10000,
      time: true,
    },
    {
      name: "ayin-media-worker",
      cwd: path.join(currentDir, "apps/api"),
      script: "dist/media-worker.js",
      interpreter: "node",
      node_args: "--enable-source-maps",
      env: {
        ...apiEnv,
        NODE_ENV: "production",
        APP_ENV: "production",
        AYIN_RELEASE_SHA: currentReleaseSha,
        AYIN_SERVICE_NAME: "ayin-media-worker",
        MEDIA_WORKER_HEARTBEAT_PATH:
          apiEnv.MEDIA_WORKER_HEARTBEAT_PATH || "/tmp/ayin-media-worker-heartbeat.json",
        MEDIA_PROCESSING_WORKDIR: apiEnv.MEDIA_PROCESSING_WORKDIR || "/tmp/ayin-media-processing",
        FFMPEG_PATH: apiEnv.FFMPEG_PATH || "/home/ayin/bin/ffmpeg",
        FFPROBE_PATH: apiEnv.FFPROBE_PATH || "/home/ayin/bin/ffprobe",
      },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 10000,
      time: true,
    },
  ],
};
