import { spawn } from "node:child_process";

export interface BoundedMediaProcessInput {
  executable: string;
  args: readonly string[];
  timeoutMs: number;
  label: string;
  stderrLimitBytes?: number;
}

export async function runBoundedMediaProcess(input: BoundedMediaProcessInput): Promise<void> {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error("Media process timeout must be a positive integer.");
  }
  const stderrLimit = input.stderrLimitBytes ?? 16_384;
  if (!Number.isSafeInteger(stderrLimit) || stderrLimit < 1024 || stderrLimit > 65_536) {
    throw new Error("Media process stderr capture limit is outside the safe range.");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.executable, [...input.args], {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    timeout.unref();

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-stderrLimit);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(
          new Error(`${input.label} timed out after ${Math.ceil(input.timeoutMs / 1000)} seconds.`),
        );
      } else if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${input.label} exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}. ${stderr}`.trim(),
          ),
        );
      }
    });
  });
}
