"use node";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function randomState() {
  return randomBytes(32).toString("base64url");
}

export function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function encryptionKey() {
  const encoded = process.env.CONNECTION_ENCRYPTION_KEY;
  if (!encoded) throw new Error("CONNECTION_ENCRYPTION_KEY is not configured in Convex.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("CONNECTION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { secretCiphertext: ciphertext.toString("base64"), secretIv: iv.toString("base64"), secretVersion: 1 };
}

export function decryptSecret(ciphertext: string, encodedIv: string) {
  const payload = Buffer.from(ciphertext, "base64");
  const tag = payload.subarray(payload.length - 16);
  const encrypted = payload.subarray(0, payload.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(encodedIv, "base64"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

