import {
  createHash,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  sign,
  verify,
  createPublicKey,
} from "node:crypto";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const digest = (value: string, secret: string) =>
  createHmac("sha256", secret).update(value).digest("hex");
export function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function encrypt(value: unknown, secret: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret).digest(),
      iv,
    );
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
export function decrypt<T>(value: string, secret: string): T {
  const data = Buffer.from(value, "base64url"),
    cipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret).digest(),
      data.subarray(0, 12),
    );
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(
      "utf8",
    ),
  ) as T;
}
export function signedToken(payload: object, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return data + "." + digest(data, secret);
}
export function readToken<T>(token: string, secret: string): T {
  const [data, signature, ...rest] = token.split(".");
  if (
    !data ||
    !signature ||
    rest.length ||
    !safeEqual(signature, digest(data, secret))
  )
    throw new Error("Invalid token");
  return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as T;
}
export function validPublicKey(pem: string): boolean {
  try {
    const key = createPublicKey(pem);
    return key.asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
}
export function verifyDevice(
  pem: string,
  payload: string,
  signature: string,
): boolean {
  try {
    return (
      validPublicKey(pem) &&
      verify(null, Buffer.from(payload), pem, Buffer.from(signature, "base64"))
    );
  } catch {
    return false;
  }
}
export function signDocument<T extends object>(
  payload: T,
  key: string,
  keyId: string,
) {
  return {
    payload,
    keyId,
    signature: sign(null, Buffer.from(canonical(payload)), key).toString(
      "base64",
    ),
  };
}
