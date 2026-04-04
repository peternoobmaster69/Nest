import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const secret = process.env.CARD_ENCRYPTION_KEY ?? "";

  if (!secret) {
    throw new Error("CARD_ENCRYPTION_KEY is required for card field encryption.");
  }

  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) {
    throw new Error("CARD_ENCRYPTION_KEY must be 32 bytes base64-encoded.");
  }

  return key;
}

export function encryptText(plainText: string) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encrypted, iv, tag };
}

export function decryptText(encrypted: Buffer, iv: Buffer, tag: Buffer) {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plain.toString("utf8");
}
