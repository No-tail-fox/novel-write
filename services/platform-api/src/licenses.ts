import { randomUUID } from "node:crypto";
import type { PlatformConfig } from "./config.js";
import type { AuthContext } from "./auth.js";
import { ApiError, audit, iso, type Tx } from "./db.js";
import { digest, hash, signDocument } from "./crypto.js";

export function entitlementView(row: Record<string, any>) {
  return {
    id: row.id,
    entitlementId: row.id,
    kind: row.kind,
    plan: row.product_id,
    planName: row.product_id,
    status:
      row.status === "active" &&
      (!row.expires_at || row.expires_at > Date.now())
        ? "active"
        : "expired",
    features: row.features,
    deviceLimit: row.device_limit,
    expiresAt: iso(row.expires_at) || null,
    version: row.version,
  };
}
export async function licenses(tx: Tx, auth: AuthContext) {
  const rows = (
    await tx.query(
      "SELECT * FROM entitlements WHERE user_id=$1 ORDER BY created_at DESC",
      [auth.userId],
    )
  ).rows;
  const bindings = (
    await tx.query(
      "SELECT entitlement_id FROM device_bindings WHERE device_id=$1 AND revoked_at IS NULL",
      [auth.deviceId],
    )
  ).rows;
  return {
    entitlements: rows.map(entitlementView),
    currentDeviceId: auth.deviceId,
    boundEntitlementIds: bindings.map((r) => r.entitlement_id),
  };
}
export async function redeem(
  tx: Tx,
  config: PlatformConfig,
  auth: AuthContext,
  code: string,
) {
  const row = (
    await tx.query(
      "SELECT c.*,p.kind,p.features,p.device_limit,p.duration_days,p.enabled FROM activation_codes c JOIN license_products p ON p.id=c.product_id AND p.version=c.product_version WHERE c.digest=$1 FOR UPDATE OF c",
      [digest(code.trim().toUpperCase(), config.pepper)],
    )
  ).rows[0];
  if (
    !row ||
    row.revoked_at ||
    !row.enabled ||
    (row.expires_at && row.expires_at < Date.now())
  )
    throw new ApiError("ACTIVATION_INVALID", "激活码无效或已过期。");
  if (row.redeemed_by) {
    if (row.redeemed_by !== auth.userId)
      throw new ApiError("ACTIVATION_REDEEMED", "激活码已被兑换。", 409);
    const existing = (
      await tx.query(
        "SELECT e.* FROM redemptions r JOIN entitlements e ON e.id=r.entitlement_id WHERE code_id=$1",
        [row.id],
      )
    ).rows[0];
    return entitlementView(existing);
  }
  const entitlementId = randomUUID(),
    expiresAt = row.duration_days
      ? new Date(Date.now() + row.duration_days * 86400000)
      : null;
  const entitlement = (
    await tx.query(
      "INSERT INTO entitlements(id,user_id,product_id,product_version,kind,features,device_limit,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        entitlementId,
        auth.userId,
        row.product_id,
        row.product_version,
        row.kind,
        JSON.stringify(row.features),
        row.device_limit,
        expiresAt,
      ],
    )
  ).rows[0];
  await tx.query(
    "INSERT INTO redemptions(code_id,user_id,entitlement_id) VALUES($1,$2,$3)",
    [row.id, auth.userId, entitlementId],
  );
  await tx.query(
    "UPDATE activation_codes SET redeemed_by=$2,redeemed_at=now() WHERE id=$1",
    [row.id, auth.userId],
  );
  await audit(tx, auth.userId, "license.redeem", entitlementId);
  return entitlementView(entitlement);
}
export async function bindDevice(
  tx: Tx,
  config: PlatformConfig,
  auth: AuthContext,
  entitlementId: string,
) {
  if (!config.licensePrivateKey)
    throw new ApiError(
      "LICENSE_SIGNING_UNAVAILABLE",
      "授权签名服务尚未配置。",
      503,
    );
  const entitlement = (
    await tx.query(
      "SELECT * FROM entitlements WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [entitlementId, auth.userId],
    )
  ).rows[0];
  if (
    !entitlement ||
    entitlement.status !== "active" ||
    (entitlement.expires_at && entitlement.expires_at < Date.now())
  )
    throw new ApiError("LICENSE_REQUIRED", "需要有效的软件授权。", 403);
  const existing = (
    await tx.query(
      "SELECT * FROM device_bindings WHERE entitlement_id=$1 AND device_id=$2 AND revoked_at IS NULL",
      [entitlementId, auth.deviceId],
    )
  ).rows[0];
  if (!existing) {
    const {
      rows: [count],
    } = await tx.query(
      "SELECT count(*)::int AS count FROM device_bindings WHERE entitlement_id=$1 AND revoked_at IS NULL",
      [entitlementId],
    );
    if (count.count >= entitlement.device_limit)
      throw new ApiError(
        "DEVICE_LIMIT_REACHED",
        "设备名额已用完，请先解绑旧设备。",
        409,
      );
    await tx.query(
      "INSERT INTO device_bindings(device_id,entitlement_id) VALUES($1,$2) ON CONFLICT(device_id,entitlement_id) DO UPDATE SET revoked_at=NULL,bound_at=now()",
      [auth.deviceId, entitlementId],
    );
  }
  const now = Date.now(),
    notAfter = new Date(
      Math.min(
        now + 72 * 3600000,
        entitlement.expires_at?.getTime() || Infinity,
      ),
    ).toISOString();
  const payload = {
    licenseId: entitlementId,
    userId: auth.userId,
    deviceId: auth.deviceId,
    devicePublicKeyHash: hash(auth.publicKey),
    entitlementVersion: entitlement.version,
    features: entitlement.features,
    issuedAt: new Date(now).toISOString(),
    notAfter,
    keyId: config.licenseKeyId,
  };
  await audit(tx, auth.userId, "license.bind-device", entitlementId, {
    deviceId: auth.deviceId,
  });
  return {
    entitlement: entitlementView(entitlement),
    lease: signDocument(payload, config.licensePrivateKey, config.licenseKeyId),
  };
}
export async function requireLicense(
  tx: Tx,
  auth: AuthContext,
  capability?: string,
) {
  const rows = (
    await tx.query(
      "SELECT e.* FROM entitlements e JOIN device_bindings b ON b.entitlement_id=e.id JOIN devices d ON d.id=b.device_id WHERE e.user_id=$1 AND b.device_id=$2 AND e.status='active' AND b.revoked_at IS NULL AND d.disabled_at IS NULL AND (e.expires_at IS NULL OR e.expires_at>now())",
      [auth.userId, auth.deviceId],
    )
  ).rows;
  if (
    !rows.some(
      (row) =>
        row.features.includes("platform") || row.features.includes(capability),
    )
  )
    throw new ApiError(
      "LICENSE_REQUIRED",
      "请激活当前设备后使用平台模型。",
      403,
    );
}
