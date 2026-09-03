import { randomBytes, randomUUID } from "node:crypto";
import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";

import { Injectable } from "@nestjs/common";

export interface PasswordResetEmail {
  email: string;
  resetUrl: string;
}

export interface EmailAdapter {
  readonly configured: boolean;
  sendPasswordReset(message: PasswordResetEmail): Promise<void>;
}

export const EMAIL_ADAPTER = Symbol("EMAIL_ADAPTER");

type SmtpSocket = Socket | TLSSocket;
type SmtpScheme = "smtps" | "starttls";

interface SmtpConfiguration {
  ehloDomain: string;
  fromAddress: string;
  fromName: string;
  host: string;
  password: string;
  port: number;
  scheme: SmtpScheme;
  timeoutMs: number;
  username: string;
}

interface SmtpReply {
  code: number;
  lines: string[];
}

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeScheme(value: string): SmtpScheme {
  const normalized = value.trim().toLowerCase();
  if (normalized === "smtps" || normalized === "ssl") {
    return "smtps";
  }
  return "starttls";
}

function configuredSmtp(): SmtpConfiguration | null {
  const host = env("MAIL_HOST");
  const username = env("MAIL_USERNAME");
  const password = env("MAIL_PASSWORD");
  const fromAddress = env("MAIL_FROM_ADDRESS") || username;
  if (!host || !username || !password || !fromAddress) {
    return null;
  }

  let defaultEhloDomain = "ayin.stream";
  try {
    defaultEhloDomain = new URL(env("WEB_ORIGIN") || "https://ayin.stream").hostname;
  } catch {
    // Keep the safe AYIN default when WEB_ORIGIN is malformed.
  }

  const scheme = normalizeScheme(env("MAIL_SCHEME"));
  return {
    ehloDomain: env("MAIL_EHLO_DOMAIN") || defaultEhloDomain,
    fromAddress,
    fromName: env("MAIL_FROM_NAME") || "AYIN",
    host,
    password,
    port: parsePositiveInteger(env("MAIL_PORT"), scheme === "smtps" ? 465 : 587),
    scheme,
    timeoutMs: parsePositiveInteger(env("MAIL_TIMEOUT_MS"), 15_000),
    username,
  };
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dotStuff(value: string): string {
  return value
    .replace(/\r?\n/gu, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function waitForSocket(socket: SmtpSocket, event: "connect" | "secureConnect"): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off(event, onReady);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("SMTP connection timed out."));
    };
    socket.once(event, onReady);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

function readReply(socket: SmtpSocket): Promise<SmtpReply> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const lines: string[] = [];

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      socket.off("close", onClose);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("SMTP response timed out."));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("SMTP connection closed before a complete response was received."));
    };
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      while (true) {
        const end = buffer.indexOf("\n");
        if (end < 0) break;
        const line = buffer.slice(0, end + 1).replace(/\r?\n$/u, "");
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        lines.push(line);
        const match = /^(\d{3})([ -])/u.exec(line);
        if (match?.[2] === " ") {
          cleanup();
          resolve({ code: Number(match[1]), lines });
          return;
        }
      }
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.once("close", onClose);
  });
}

async function command(
  socket: SmtpSocket,
  value: string,
  expectedCodes: readonly number[],
): Promise<SmtpReply> {
  socket.write(`${value}\r\n`);
  const reply = await readReply(socket);
  if (!expectedCodes.includes(reply.code)) {
    throw new Error(`SMTP command failed with code ${reply.code}.`);
  }
  return reply;
}

function buildResetMessage(config: SmtpConfiguration, message: PasswordResetEmail): string {
  const fromName = sanitizeHeader(config.fromName);
  const fromAddress = sanitizeHeader(config.fromAddress);
  const recipient = sanitizeHeader(message.email);
  const resetUrl = message.resetUrl;
  const boundary = `ayin-${randomBytes(12).toString("hex")}`;
  const text = [
    "Reset your AYIN password",
    "",
    "We received a request to reset the password for your AYIN account.",
    "",
    `Open this link to choose a new password: ${resetUrl}`,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\r\n");
  const htmlUrl = escapeHtml(resetUrl);
  const html = [
    "<!doctype html>",
    '<html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.6">',
    '<div style="max-width:560px;margin:0 auto;padding:28px">',
    '<div style="font-size:28px;font-weight:800;letter-spacing:.08em;margin-bottom:24px">AYIN</div>',
    "<h1>Reset your password</h1>",
    "<p>We received a request to reset the password for your AYIN account.</p>",
    `<p><a href="${htmlUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:8px">Reset password</a></p>`,
    `<p style="font-size:13px;color:#6b7280;word-break:break-all">${htmlUrl}</p>`,
    "<p>If you did not request this, you can ignore this email.</p>",
    "</div></body></html>",
  ].join("");
  const fromHeader = fromName ? `"${fromName.replaceAll('"', "'')}" ` : "";

  return [
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@ayin.stream>`,
    `From: ${fromHeader}<${fromAddress}>`,
    `To: <${recipient}>`,
    "Subject: Reset your AYIN password",
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function sendWithSmtp(config: SmtpConfiguration, message: PasswordResetEmail): Promise<void> {
  let socket: SmtpSocket;
  if (config.scheme === "smtps") {
    const tlsSocket = connectTls({ host: config.host, port: config.port, servername: config.host });
    tlsSocket.setTimeout(config.timeoutMs);
    await waitForSocket(tlsSocket, "secureConnect");
    socket = tlsSocket;
  } else {
    const tcpSocket = connectTcp({ host: config.host, port: config.port });
    tcpSocket.setTimeout(config.timeoutMs);
    await waitForSocket(tcpSocket, "connect");
    socket = tcpSocket;
  }

  try {
    const greeting = await readReply(socket);
    if (greeting.code !== 220) {
      throw new Error(`SMTP greeting failed with code ${greeting.code}.`);
    }

    await command(socket, `EHLO ${config.ehloDomain}`, [250]);

    if (config.scheme === "starttls") {
      await command(socket, "STARTTLS", [220]);
      const tlsSocket = connectTls({ socket: socket as Socket, servername: config.host });
      tlsSocket.setTimeout(config.timeoutMs);
      await waitForSocket(tlsSocket, "secureConnect");
      socket = tlsSocket;
      await command(socket, `EHLO ${config.ehloDomain}`, [250]);
    }

    await command(socket, "AUTH LOGIN", [334]);
    await command(socket, Buffer.from(config.username, "utf8").toString("base64"), [334]);
    await command(socket, Buffer.from(config.password, "utf8").toString("base64"), [235]);
    await command(socket, `MAIL FROM:<${config.fromAddress}>`, [250]);
    await command(socket, `RCPT TO:<${message.email}>`, [250, 251]);
    await command(socket, "DATA", [354]);

    socket.write(`${dotStuff(buildResetMessage(config, message))}\r\n.\r\n`);
    const accepted = await readReply(socket);
    if (accepted.code !== 250) {
      throw new Error(`SMTP message delivery failed with code ${accepted.code}.`);
    }

    try {
      await command(socket, "QUIT", [221]);
    } catch {
      // The message has already been accepted; a failed QUIT must not turn delivery into an error.
    }
  } finally {
    socket.destroy();
  }
}

@Injectable()
export class SmtpEmailAdapter implements EmailAdapter {
  get configured(): boolean {
    return configuredSmtp() !== null;
  }

  async sendPasswordReset(message: PasswordResetEmail): Promise<void> {
    const config = configuredSmtp();
    if (!config) {
      throw new Error("SMTP email delivery is not configured.");
    }
    await sendWithSmtp(config, message);
  }
}
