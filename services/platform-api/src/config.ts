import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

export interface PlatformConfig {
  environment: "development" | "test" | "production";
  databaseUrl: string;
  host: string;
  port: number;
  publicUrl: string;
  tokenSecret: string;
  pepper: string;
  fixtureMode: boolean;
  fixtureOtp: string;
  licensePrivateKey?: string;
  licenseKeyId: string;
  artifactDirectory: string;
  downloadOrigins: string[];
  updatePublicKeys: Record<string, string>;
  updateOrigins: string[];
  otpUrl?: string;
  otpToken?: string;
  payment: {
    merchantId?: string;
    appId?: string;
    privateKey?: string;
    certificateSerial?: string;
    apiKey?: string;
    platformCertificates: Record<string, string>;
    notifyUrl?: string;
  };
}
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlatformConfig {
  const environment =
    env.NODE_ENV === "production"
      ? "production"
      : env.NODE_ENV === "test"
        ? "test"
        : "development";
  const fixtureMode = env.PLATFORM_DEV_FIXTURES === "1";
  const host = env.PLATFORM_HOST || "127.0.0.1";
  const publicUrl = env.PLATFORM_PUBLIC_URL || "http://127.0.0.1:4318";
  if (
    fixtureMode &&
    (environment === "production" ||
      !["127.0.0.1", "::1", "localhost"].includes(host) ||
      !["127.0.0.1", "[::1]", "localhost"].includes(
        new URL(publicUrl).hostname,
      ))
  )
    throw new Error(
      "Development fixtures require a non-production loopback server.",
    );
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!env.PLATFORM_TOKEN_SECRET || env.PLATFORM_TOKEN_SECRET.length < 32)
    throw new Error(
      "PLATFORM_TOKEN_SECRET must contain at least 32 characters.",
    );
  if (!env.PLATFORM_PEPPER || env.PLATFORM_PEPPER.length < 32)
    throw new Error("PLATFORM_PEPPER must contain at least 32 characters.");
  if (environment === "production" && !publicUrl.startsWith("https://"))
    throw new Error("Production public URL must use HTTPS.");
  return {
    environment,
    databaseUrl: env.DATABASE_URL,
    host,
    port: Number(env.PLATFORM_PORT || 4318),
    publicUrl: publicUrl.replace(/\/$/, ""),
    tokenSecret: env.PLATFORM_TOKEN_SECRET,
    pepper: env.PLATFORM_PEPPER,
    fixtureMode,
    fixtureOtp: env.PLATFORM_DEV_OTP || "246810",
    licensePrivateKey: env.PLATFORM_LICENSE_PRIVATE_KEY,
    licenseKeyId: env.PLATFORM_LICENSE_KEY_ID || "license-1",
    artifactDirectory: resolve(
      env.PLATFORM_ARTIFACT_DIRECTORY || "./data/artifacts",
    ),
    downloadOrigins: (
      env.PLATFORM_ARTIFACT_ORIGINS ||
      "https://cdn1.suno.ai,https://cdn2.suno.ai"
    )
      .split(",")
      .filter(Boolean),
    updatePublicKeys: env.PLATFORM_UPDATE_PUBLIC_KEYS
      ? JSON.parse(env.PLATFORM_UPDATE_PUBLIC_KEYS)
      : {},
    updateOrigins: (env.PLATFORM_UPDATE_ORIGINS || "")
      .split(",")
      .filter(Boolean),
    otpUrl: env.PLATFORM_OTP_URL,
    otpToken: env.PLATFORM_OTP_TOKEN,
    payment: {
      merchantId: env.WECHAT_MERCHANT_ID,
      appId: env.WECHAT_APP_ID,
      privateKey: env.WECHAT_PRIVATE_KEY,
      certificateSerial: env.WECHAT_CERT_SERIAL,
      apiKey: env.WECHAT_API_V3_KEY,
      platformCertificates: env.WECHAT_PLATFORM_CERTIFICATES
        ? JSON.parse(env.WECHAT_PLATFORM_CERTIFICATES)
        : {},
      notifyUrl: env.WECHAT_NOTIFY_URL,
    },
  };
}
export const randomSecret = () => randomBytes(32).toString("base64url");
