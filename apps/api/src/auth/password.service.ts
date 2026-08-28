import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";

const keyLength = 64;
const saltLength = 16;
const cost = 32_768;
const blockSize = 8;
const parallelization = 1;
const maxMemory = 64 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N: cost, r: blockSize, p: parallelization, maxmem: maxMemory },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(saltLength);
    const derivedKey = await deriveKey(password, salt);
    return [
      "scrypt",
      cost,
      blockSize,
      parallelization,
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
    ].join("$");
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const [algorithm, encodedCost, encodedBlockSize, encodedParallelization, saltValue, hashValue] =
      encodedHash.split("$");

    if (
      algorithm !== "scrypt" ||
      Number(encodedCost) !== cost ||
      Number(encodedBlockSize) !== blockSize ||
      Number(encodedParallelization) !== parallelization ||
      !saltValue ||
      !hashValue
    ) {
      return false;
    }

    try {
      const salt = Buffer.from(saltValue, "base64url");
      const expected = Buffer.from(hashValue, "base64url");
      const actual = await deriveKey(password, salt);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }
}
