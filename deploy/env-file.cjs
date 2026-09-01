"use strict";

const fs = require("node:fs");

function decodeValue(rawValue, source, lineNumber) {
  const value = rawValue.trim();
  if (!value) return "";

  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    if (!value.endsWith(quote) || value.length < 2) {
      throw new Error(`${source}:${lineNumber}: unterminated quoted environment value`);
    }

    if (quote === "'") {
      return value.slice(1, -1);
    }

    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`${source}:${lineNumber}: invalid double-quoted environment value`);
    }
  }

  return value;
}

function parseEnvText(text, source = "environment file") {
  const environment = {};
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      throw new Error(`${source}:${index + 1}: invalid environment assignment`);
    }

    environment[match[1]] = decodeValue(match[2], source, index + 1);
  }

  return environment;
}

function loadEnvFile(filePath) {
  return parseEnvText(fs.readFileSync(filePath, "utf8"), filePath);
}

function assertPrivateFilePermissions(filePath) {
  if (process.platform === "win32") return;
  const mode = fs.statSync(filePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `${filePath}: permissions are too broad (${mode.toString(8)}); use chmod 600 or stricter`,
    );
  }
}

module.exports = {
  assertPrivateFilePermissions,
  loadEnvFile,
  parseEnvText,
};
