import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { PlatformConfig } from "./config.js";
import { ApiError, transaction, audit, iso, type Tx } from "./db.js";
import {
  hash,
  digest,
  safeEqual,
  signedToken,
  readToken,
  encrypt,
  decrypt,
  verifyDevice,
  validPublicKey,
} from "./crypto.js";

export interface AuthContext {
  userId: string;
  sessionId: string;
  deviceId: string;
  installationId: string;
  publicKey: string;
}
export async function assertCurrentAccount(tx: Tx, auth: AuthContext) {
  const row = (
    await tx.query(
      "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN devices d ON d.id=s.device_id WHERE s.id=$1 AND s.user_id=$2 AND s.device_id=$3 AND s.revoked_at IS NULL AND d.disabled_at IS NULL AND u.status='active' FOR SHARE OF s,d",
      [auth.sessionId, auth.userId, auth.deviceId],
    )
  ).rows[0];
  if (!row)
    throw new ApiError(
      "SESSION_REVOKED",
      "账号或设备状态已改变，请重新登录。",
      401,
    );
}
interface Claims {
  sub: string;
  sid: string;
  did: string;
  exp: number;
  aud: string;
  env: string;
}
export type RequestWithRaw = FastifyRequest & { rawBody?: string };
export function requestProof(request: RequestWithRaw) {
  const header = (name: string) => String(request.headers[name] || "");
  const timestamp = header("x-device-timestamp"),
    nonce = header("x-device-nonce"),
    installationId = header("x-device-id"),
    signature = header("x-device-signature");
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > 300000 ||
    !z.uuid().safeParse(nonce).success ||
    !installationId ||
    !signature
  )
    throw new ApiError("DEVICE_PROOF_REQUIRED", "需要有效的设备签名。", 401);
  return {
    installationId,
    nonce,
    signature,
    payload: `${request.method.toUpperCase()}\n${request.raw.url}\n${timestamp}\n${nonce}\n${hash(request.rawBody || "")}`,
  };
}
export async function assertDeviceProof(
  tx: Tx,
  request: RequestWithRaw,
  installationId: string,
  publicKey: string,
) {
  const proof = requestProof(request);
  if (
    proof.installationId !== installationId ||
    !verifyDevice(publicKey, proof.payload, proof.signature)
  )
    throw new ApiError("DEVICE_PROOF_INVALID", "设备签名验证失败。", 401);
  const inserted = await tx.query(
    "INSERT INTO request_nonces(device_id,nonce) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [installationId, proof.nonce],
  );
  if (!inserted.rowCount)
    throw new ApiError(
      "DEVICE_PROOF_REPLAY",
      "该设备请求已处理，请用新签名重试同一幂等请求。",
      409,
    );
}
export async function authenticate(
  pool: pg.Pool,
  config: PlatformConfig,
  request: RequestWithRaw,
  requireProof = true,
): Promise<AuthContext> {
  let claims: Claims;
  try {
    claims = readToken<Claims>(
      String(request.headers.authorization || "").replace(/^Bearer /, ""),
      config.tokenSecret,
    );
    if (
      claims.exp < Date.now() ||
      claims.aud !== "storydream-platform" ||
      claims.env !== config.environment
    )
      throw new Error();
  } catch {
    throw new ApiError("AUTH_REQUIRED", "请先登录账号。", 401);
  }
  return transaction(pool, async (tx) => {
    const row = (
      await tx.query(
        "SELECT s.*,u.status,d.installation_id,d.public_key,d.disabled_at FROM sessions s JOIN users u ON u.id=s.user_id JOIN devices d ON d.id=s.device_id WHERE s.id=$1 AND s.user_id=$2 AND s.device_id=$3",
        [claims.sid, claims.sub, claims.did],
      )
    ).rows[0];
    if (!row || row.revoked_at || row.disabled_at)
      throw new ApiError(
        "SESSION_REVOKED",
        "此设备会话已失效，请重新登录。",
        401,
      );
    if (row.status !== "active")
      throw new ApiError("ACCOUNT_RESTRICTED", "账号当前限制了在线服务。", 403);
    if (requireProof)
      await assertDeviceProof(tx, request, row.installation_id, row.public_key);
    return {
      userId: row.user_id,
      sessionId: row.id,
      deviceId: row.device_id,
      installationId: row.installation_id,
      publicKey: row.public_key,
    };
  });
}
export async function publicProfile(tx: Tx, userId: string) {
  const user = (await tx.query("SELECT * FROM users WHERE id=$1", [userId]))
    .rows[0];
  const phone = (
    await tx.query(
      "SELECT identifier FROM identities WHERE user_id=$1 AND kind='phone'",
      [userId],
    )
  ).rows[0]?.identifier;
  return {
    id: user.id,
    userId: user.id,
    displayName: user.display_name,
    status: user.status,
    phone: phone ? phone.slice(0, 5) + "****" + phone.slice(-4) : "",
    phoneMasked: phone
      ? phone.slice(0, 5) + "****" + phone.slice(-4)
      : undefined,
    createdAt: iso(user.created_at),
  };
}
async function issueSession(
  tx: Tx,
  config: PlatformConfig,
  userId: string,
  sessionId: string,
  deviceId: string,
) {
  const refreshToken = randomBytes(48).toString("base64url"),
    expiresAt = new Date(Date.now() + 600000).toISOString(),
    refreshExpiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  await tx.query(
    "INSERT INTO refresh_tokens(digest,session_id,expires_at) VALUES($1,$2,$3)",
    [digest(refreshToken, config.pepper), sessionId, refreshExpiresAt],
  );
  return {
    accessToken: signedToken(
      {
        sub: userId,
        sid: sessionId,
        did: deviceId,
        exp: Date.now() + 600000,
        aud: "storydream-platform",
        env: config.environment,
      },
      config.tokenSecret,
    ),
    refreshToken,
    userId,
    expiresAt,
    accessExpiresAt: expiresAt,
    refreshExpiresAt,
    sessionId,
    deviceId,
    user: await publicProfile(tx, userId),
  };
}
export async function createChallenge(
  pool: pg.Pool,
  config: PlatformConfig,
  request: RequestWithRaw,
) {
  const input = z
    .object({
      phone: z.string().regex(/^\+?[0-9]{8,15}$/),
      installationId: z.string().min(8).max(100).optional(),
    })
    .strict()
    .parse(request.body);
  const body = {
    target: input.phone,
    purpose: "login",
    installationId: input.installationId,
  };
  if (!config.fixtureMode && (!config.otpUrl || !config.otpToken))
    throw new ApiError("OTP_UNAVAILABLE", "短信服务尚未配置。", 503);
  const target = body.target.startsWith("+")
      ? body.target
      : body.target.length === 11
        ? "+86" + body.target
        : "+" + body.target,
    code = config.fixtureMode
      ? config.fixtureOtp
      : String(randomInt(100000, 1000000)),
    id = randomUUID();
  const ipHash = digest(request.ip, config.pepper),
    deviceHash = digest(
      body.installationId ||
        String(request.headers["x-device-id"] || request.ip),
      config.pepper,
    );
  const result = await transaction(pool, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "otp:" + ipHash,
    ]);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "otp-target:" + target,
    ]);
    const rows = (
      await tx.query(
        "SELECT count(*) FILTER(WHERE target=$1)::int AS target_hour,count(*) FILTER(WHERE ip_hash=$2)::int AS ip_hour,count(*) FILTER(WHERE device_hash=$3)::int AS device_hour,count(*) FILTER(WHERE target=$1 AND created_at>now()-interval '60 seconds')::int AS recent FROM auth_challenges WHERE created_at>now()-interval '1 hour' AND (target=$1 OR ip_hash=$2 OR device_hash=$3)",
        [target, ipHash, deviceHash],
      )
    ).rows[0];
    if (
      rows.recent ||
      rows.target_hour >= 10 ||
      rows.ip_hour >= 30 ||
      rows.device_hour >= 15
    )
      throw new ApiError("RATE_LIMITED", "发送过于频繁，请稍后重试。", 429);
    const expiresAt = new Date(Date.now() + 300000).toISOString();
    await tx.query(
      "INSERT INTO auth_challenges(id,purpose,target,code_hash,ip_hash,device_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        body.purpose,
        target,
        digest(id + ":" + code, config.pepper),
        ipHash,
        deviceHash,
        expiresAt,
      ],
    );
    return {
      challengeId: id,
      expiresAt,
      retryAfter: 60,
      retryAfterSeconds: 60,
      ...(config.fixtureMode
        ? { developmentCode: code, developmentFixture: true }
        : {}),
    };
  });
  if (!config.fixtureMode) {
    try {
      const endpoint = new URL(config.otpUrl!);
      if (endpoint.protocol !== "https:")
        throw new Error("OTP URL must be HTTPS");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: "Bearer " + config.otpToken,
          "content-type": "application/json",
          "idempotency-key": id,
        },
        body: JSON.stringify({
          challengeId: id,
          target,
          purpose: body.purpose,
          code,
          expiresIn: 300,
        }),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("OTP delivery failed");
    } catch {
      await pool.query(
        "UPDATE auth_challenges SET consumed_at=now() WHERE id=$1",
        [id],
      );
      throw new ApiError(
        "OTP_UNAVAILABLE",
        "验证码发送未完成，请稍后重试。",
        503,
      );
    }
  }
  return result;
}
export async function verifyChallenge(
  pool: pg.Pool,
  config: PlatformConfig,
  request: RequestWithRaw,
) {
  const body = z
    .object({
      challengeId: z.uuid(),
      code: z.string().regex(/^\d{6}$/),
      device: z
        .object({
          installationId: z.string().min(8).max(100),
          publicKey: z.string().max(2048),
          name: z.string().max(100).default("StoryDream 设备"),
          platform: z.string().max(40).default("win32"),
          appVersion: z.string().max(40).default("1.0.0"),
        })
        .strict(),
    })
    .strict()
    .parse(request.body);
  if (!validPublicKey(body.device.publicKey))
    throw new ApiError("DEVICE_KEY_INVALID", "设备密钥格式无效。");
  const result = await transaction(pool, async (tx) => {
    await assertDeviceProof(
      tx,
      request,
      body.device.installationId,
      body.device.publicKey,
    );
    const row = (
      await tx.query("SELECT * FROM auth_challenges WHERE id=$1 FOR UPDATE", [
        body.challengeId,
      ])
    ).rows[0];
    if (
      !row ||
      row.consumed_at ||
      row.expires_at < Date.now() ||
      row.attempt_count >= 5 ||
      row.purpose !== "login"
    )
      return { error: "验证码无效或已过期。" };
    await tx.query(
      "UPDATE auth_challenges SET attempt_count=attempt_count+1 WHERE id=$1",
      [body.challengeId],
    );
    if (
      !safeEqual(
        row.code_hash,
        digest(body.challengeId + ":" + body.code, config.pepper),
      )
    )
      return { error: "验证码无效或已过期。" };
    await tx.query("UPDATE auth_challenges SET consumed_at=now() WHERE id=$1", [
      body.challengeId,
    ]);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "identity:" + row.target,
    ]);
    let userId = (
      await tx.query(
        "SELECT user_id FROM identities WHERE kind='phone' AND identifier=$1",
        [row.target],
      )
    ).rows[0]?.user_id;
    if (!userId) {
      userId = randomUUID();
      await tx.query("INSERT INTO users(id) VALUES($1)", [userId]);
      await tx.query(
        "INSERT INTO identities(user_id,kind,identifier) VALUES($1,'phone',$2)",
        [userId, row.target],
      );
      await tx.query("INSERT INTO wallets(user_id) VALUES($1)", [userId]);
    }
    if (
      (await tx.query("SELECT status FROM users WHERE id=$1", [userId])).rows[0]
        .status !== "active"
    )
      return { error: "账号无法使用在线服务。" };
    const existing = (
      await tx.query(
        "SELECT * FROM devices WHERE user_id=$1 AND installation_id=$2 FOR UPDATE",
        [userId, body.device.installationId],
      )
    ).rows[0];
    if (existing && existing.public_key !== body.device.publicKey)
      return { error: "设备密钥不匹配，请建立新的设备身份。" };
    const deviceId = existing?.id || randomUUID(),
      sessionId = randomUUID();
    if (!existing)
      await tx.query(
        "INSERT INTO devices(id,user_id,installation_id,public_key,label,platform,app_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          deviceId,
          userId,
          body.device.installationId,
          body.device.publicKey,
          body.device.name,
          body.device.platform,
          body.device.appVersion,
        ],
      );
    else
      await tx.query(
        "UPDATE devices SET disabled_at=NULL,last_seen_at=now(),label=$2,app_version=$3 WHERE id=$1",
        [deviceId, body.device.name, body.device.appVersion],
      );
    await tx.query(
      "INSERT INTO sessions(id,user_id,device_id) VALUES($1,$2,$3)",
      [sessionId, userId, deviceId],
    );
    await audit(tx, userId, "session.login", sessionId);
    return {
      session: await issueSession(tx, config, userId, sessionId, deviceId),
    };
  });
  if (result.error) throw new ApiError("OTP_INVALID", result.error, 401);
  return result.session;
}
export async function refreshSession(
  pool: pg.Pool,
  config: PlatformConfig,
  request: RequestWithRaw,
) {
  const { refreshToken } = z
      .object({ refreshToken: z.string().min(32).max(200) })
      .strict()
      .parse(request.body),
    key = String(request.headers["idempotency-key"] || "");
  if (key.length < 8 || key.length > 180)
    throw new ApiError("IDEMPOTENCY_REQUIRED", "刷新会话需要幂等请求标识。");
  const result = await transaction(pool, async (tx) => {
    const token = (
      await tx.query(
        "SELECT r.*,s.user_id,s.device_id,s.revoked_at,d.installation_id,d.public_key,d.disabled_at,u.status FROM refresh_tokens r JOIN sessions s ON s.id=r.session_id JOIN devices d ON d.id=s.device_id JOIN users u ON u.id=s.user_id WHERE r.digest=$1 FOR UPDATE OF r,s",
        [digest(refreshToken, config.pepper)],
      )
    ).rows[0];
    if (
      !token ||
      token.revoked_at ||
      token.disabled_at ||
      token.status !== "active" ||
      token.expires_at < Date.now()
    )
      return { error: true };
    await assertDeviceProof(
      tx,
      request,
      token.installation_id,
      token.public_key,
    );
    const requestHash = hash(request.rawBody || "");
    if (token.used_at) {
      if (
        token.retry_key === key &&
        token.retry_request_hash === requestHash &&
        token.retry_until > Date.now()
      )
        return {
          session: decrypt<Record<string, unknown>>(
            token.retry_ciphertext,
            config.tokenSecret,
          ),
        };
      await tx.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
        token.session_id,
      ]);
      await audit(
        tx,
        token.user_id,
        "session.refresh-replay",
        token.session_id,
      );
      return { error: true };
    }
    const session = await issueSession(
      tx,
      config,
      token.user_id,
      token.session_id,
      token.device_id,
    );
    await tx.query(
      "UPDATE refresh_tokens SET used_at=now(),retry_key=$2,retry_request_hash=$3,retry_ciphertext=$4,retry_until=now()+interval '90 seconds' WHERE digest=$1",
      [
        digest(refreshToken, config.pepper),
        key,
        requestHash,
        encrypt(session, config.tokenSecret),
      ],
    );
    return { session };
  });
  if (result.error)
    throw new ApiError("SESSION_REVOKED", "登录已失效，请重新登录。", 401);
  return result.session;
}
