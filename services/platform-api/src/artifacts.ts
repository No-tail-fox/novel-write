import { mkdir, writeFile, readFile, rename } from "node:fs/promises";
import { resolve, sep, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { PlatformConfig } from "./config.js";
import { ApiError } from "./db.js";
export function objectPath(config: PlatformConfig, key: string) {
  if (!/^[a-f0-9-]+\/[a-f0-9.-]+$/i.test(key))
    throw new Error("Invalid object key");
  const path = resolve(config.artifactDirectory, key);
  if (!path.startsWith(resolve(config.artifactDirectory) + sep))
    throw new Error("Object path escaped");
  return path;
}
export async function putObject(
  config: PlatformConfig,
  key: string,
  bytes: Buffer,
) {
  const path = objectPath(config, key);
  await mkdir(dirname(path), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  await writeFile(temp, bytes, { flag: "wx" });
  await rename(temp, path);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
}
export async function getObject(config: PlatformConfig, key: string) {
  return readFile(objectPath(config, key));
}
export function validMedia(bytes: Buffer, mime: string) {
  if (!bytes.length) return false;
  if (mime === "text/plain" || mime === "application/json") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return !!text.trim() && !text.includes("\u0000");
    } catch {
      return false;
    }
  }
  if (mime === "audio/mpeg")
    return (
      bytes.subarray(0, 3).toString() === "ID3" ||
      (bytes[0] === 255 && (bytes[1] & 224) === 224)
    );
  if (mime === "audio/wav")
    return (
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WAVE"
    );
  if (mime === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp")
    return (
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP"
    );
  if (mime === "video/mp4") return bytes.subarray(4, 8).toString() === "ftyp";
  return false;
}
function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const p = address.split(".").map(Number);
    return !(
      p[0] === 0 ||
      p[0] === 10 ||
      p[0] === 127 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      p[0] >= 224 ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    );
  }
  return !/^(::|fc|fd|fe80|::ffff:)/i.test(address);
}
export async function downloadMedia(
  config: PlatformConfig,
  url: string,
  mime: string,
  fetcher: typeof fetch = fetch,
) {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    !config.downloadOrigins.includes(target.origin)
  )
    throw new ApiError(
      "ARTIFACT_ORIGIN_BLOCKED",
      "结果下载域名尚未列入平台允许列表。",
      409,
    );
  const addresses = await lookup(target.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new ApiError(
      "ARTIFACT_ORIGIN_BLOCKED",
      "结果下载地址不能指向私有网络。",
      409,
    );
  const response = await fetcher(target, {
    redirect: "error",
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok || !response.body)
    throw new Error("Artifact download incomplete");
  if (Number(response.headers.get("content-length") || 0) > 256 * 1024 * 1024)
    throw new Error("Artifact too large");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > 256 * 1024 * 1024) {
      await response.body.cancel().catch(() => {});
      throw new Error("Artifact too large");
    }
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (!validMedia(bytes, mime))
    throw new Error("Artifact content did not match declared media");
  return bytes;
}
