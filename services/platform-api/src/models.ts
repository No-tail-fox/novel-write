import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, type Tx, iso, outbox } from "./db.js";
import { canonical, hash } from "./crypto.js";
import type { AuthContext } from "./auth.js";
import { requireLicense } from "./licenses.js";
import { reserve, finalizeJob } from "./wallet.js";
import type { PlatformConfig } from "./config.js";

export const capabilities = [
  "text",
  "image",
  "video",
  "music",
  "tts",
  "speechToText",
  "vision",
] as const;
export const parameterSchemas: Record<string, Record<string, unknown>> = {
  music: {
    description: { type: "string", maxLength: 5000 },
    prompt: { type: "string", maxLength: 5000 },
    mode: { type: "string", enum: ["description", "custom", "sounds"] },
    lyrics: { type: "string", maxLength: 30000 },
    title: { type: "string", maxLength: 200 },
    style: { type: "string", maxLength: 5000 },
    negativeStyle: { type: "string", maxLength: 5000 },
    instrumental: { type: "boolean" },
    maxMode: { type: "boolean" },
    variety: { type: "number", minimum: 0, maximum: 4 },
    styleWeight: { type: "number", minimum: 0, maximum: 1 },
    weirdness: { type: "number", minimum: 0, maximum: 1 },
    vocalGender: { type: "string", enum: ["", "m", "f"] },
    loop: { type: "boolean" },
    bpm: { type: "number", minimum: 20, maximum: 300 },
    key: { type: "string", maxLength: 20 },
  },
  text: {
    prompt: { type: "string", maxLength: 60000, required: true },
    system: { type: "string", maxLength: 10000 },
    maxTokens: { type: "number", minimum: 1, maximum: 16000 },
    temperature: { type: "number", minimum: 0, maximum: 2 },
  },
  vision: {
    prompt: { type: "string", maxLength: 30000, required: true },
    assetId: { type: "string", maxLength: 36, required: true },
    maxTokens: { type: "number", minimum: 1, maximum: 16000 },
  },
  image: {
    prompt: { type: "string", maxLength: 10000, required: true },
    size: {
      type: "string",
      enum: ["1024x1024", "1024x1536", "1536x1024", "auto"],
    },
    quality: { type: "string", enum: ["low", "medium", "high", "auto"] },
    n: { type: "number", minimum: 1, maximum: 4 },
  },
  video: {
    prompt: { type: "string", maxLength: 10000, required: true },
    duration: { type: "number", minimum: 1, maximum: 30 },
    size: { type: "string", maxLength: 30 },
  },
  tts: {
    input: { type: "string", maxLength: 10000, required: true },
    voice: { type: "string", maxLength: 80 },
    speed: { type: "number", minimum: 0.25, maximum: 4 },
  },
  speechToText: {
    assetId: { type: "string", maxLength: 36, required: true },
    language: { type: "string", maxLength: 10 },
  },
};
export function validateParams(
  params: Record<string, unknown>,
  rules: Record<string, any>,
) {
  if (!params || Array.isArray(params) || Object.keys(params).length > 50)
    throw new ApiError("PARAMETERS_INVALID", "模型参数无效。");
  for (const name of Object.keys(params)) {
    if (!rules[name])
      throw new ApiError(
        "PARAMETERS_INVALID",
        `不支持参数：${name.slice(0, 60)}`,
      );
  }
  for (const [name, rule] of Object.entries(rules)) {
    const value = params[name];
    if (value === undefined) {
      if (rule.required)
        throw new ApiError("PARAMETERS_INVALID", `缺少参数：${name}`);
      continue;
    }
    if (
      ["n", "maxTokens", "variety"].includes(name) &&
      !Number.isInteger(value)
    )
      throw new ApiError("PARAMETERS_INVALID", `参数需要整数：${name}`);
    if (
      typeof value !== rule.type ||
      (rule.type === "number" &&
        (!Number.isFinite(value) ||
          (value as number) < (rule.minimum ?? -Infinity) ||
          (value as number) > (rule.maximum ?? Infinity))) ||
      (rule.type === "string" &&
        (value as string).length > (rule.maxLength ?? 60000)) ||
      (rule.enum && !rule.enum.includes(value))
    )
      throw new ApiError("PARAMETERS_INVALID", `参数格式或范围不符：${name}`);
  }
}
export function routeConfigured(
  route: Record<string, any>,
  config: PlatformConfig,
) {
  return (
    route.enabled &&
    (route.adapter === "fixture"
      ? config.fixtureMode
      : !!process.env[route.credential_ref])
  );
}
export async function catalog(tx: Tx, config: PlatformConfig) {
  const rows = (
    await tx.query(
      "SELECT DISTINCT ON(m.id) m.*,r.units_per_quantity,r.unit,p.enabled AS route_enabled,p.adapter,p.credential_ref FROM model_entries m JOIN LATERAL(SELECT * FROM rate_versions WHERE model_id=m.id AND model_version=m.version ORDER BY published_at DESC LIMIT 1) r ON true JOIN provider_routes p ON p.id=m.route_id ORDER BY m.id,r.published_at DESC",
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    name: row.display_name,
    capability: row.capability,
    operation: row.operation,
    priceUnits: row.units_per_quantity,
    unit: row.unit,
    status: !row.enabled
      ? "disabled"
      : routeConfigured({ ...row, enabled: row.route_enabled }, config)
        ? "available"
        : "unconfigured",
    version: row.version,
    description:
      row.operation +
      " · " +
      row.unit +
      (row.adapter === "fixture" ? " · 本地开发测试" : ""),
    parameterSchema: row.parameter_schema,
    isDefault: row.is_default,
  }));
}
export async function createQuote(
  tx: Tx,
  config: PlatformConfig,
  auth: AuthContext,
  input: unknown,
) {
  const body = z
    .object({
      modelId: z.string().min(1).max(128),
      operation: z.string().min(1).max(100),
      params: z.record(z.string(), z.unknown()),
    })
    .strict()
    .parse(input);
  const row = (
    await tx.query(
      "SELECT m.*,r.id AS rate_id,r.unit,r.units_per_quantity,r.max_quantity,r.minimum_success,r.multipliers,p.adapter,p.origin,p.credential_ref,p.upstream_model,p.options,p.enabled AS route_enabled FROM model_entries m JOIN LATERAL(SELECT * FROM rate_versions WHERE model_id=m.id AND model_version=m.version ORDER BY published_at DESC LIMIT 1) r ON true JOIN provider_routes p ON p.id=m.route_id WHERE m.id=$1 AND m.operation=$2 AND m.enabled=true ORDER BY r.published_at DESC LIMIT 1",
      [body.modelId, body.operation],
    )
  ).rows[0];
  if (!row || !routeConfigured({ ...row, enabled: row.route_enabled }, config))
    throw new ApiError("MODEL_UNAVAILABLE", "所选平台模型尚不可用。", 409);
  await requireLicense(tx, auth, row.capability);
  validateParams(body.params, row.parameter_schema);
  if (row.capability === "music") {
    const p = body.params;
    if (p.mode === "custom") {
      if (
        !String(p.style || "").trim() ||
        (!p.instrumental && !String(p.lyrics || "").trim())
      )
        throw new ApiError(
          "PARAMETERS_INVALID",
          "高级创作需要风格；非纯音乐还需要歌词。",
        );
    } else if (!String(p.description || p.prompt || "").trim())
      throw new ApiError("PARAMETERS_INVALID", "请填写歌曲或音效描述。");
  }
  if (body.params.assetId) {
    const asset = (
      await tx.query(
        "SELECT id FROM upload_assets WHERE id=$1 AND user_id=$2 AND verified=true AND expires_at>now()",
        [body.params.assetId, auth.userId],
      )
    ).rows[0];
    if (!asset)
      throw new ApiError(
        "ASSET_INVALID",
        "输入素材未验证或不属于当前账号。",
        409,
      );
  }
  const quantity =
    row.unit === "request"
      ? 1n
      : row.unit === "image"
        ? BigInt(Number(body.params.n || 1))
        : row.unit === "second"
          ? BigInt(Math.ceil(Number(body.params.duration || 0)))
          : row.unit === "character"
            ? BigInt(Array.from(String(body.params.input || "")).length)
            : row.unit === "token"
              ? BigInt(
                  Buffer.byteLength(
                    String(body.params.prompt || "") +
                      String(body.params.system || ""),
                    "utf8",
                  ) + Number(body.params.maxTokens || 4096),
                )
              : 0n;
  if (quantity <= 0n || quantity > BigInt(row.max_quantity))
    throw new ApiError("QUOTE_LIMIT_EXCEEDED", "输入超过当前模型的计费上限。");
  const multiplier =
    row.capability === "music" && body.params.maxMode
      ? BigInt(row.multipliers?.maxMode || "2")
      : 1n;
  const effectivePrice = BigInt(row.units_per_quantity) * multiplier;
  const reserved = quantity * effectivePrice,
    id = randomUUID(),
    expiresAt = new Date(Date.now() + 300000).toISOString(),
    inputHash = hash(canonical(body));
  const route = {
    id: row.route_id,
    adapter: row.adapter,
    origin: row.origin,
    credentialRef: row.credential_ref,
    upstreamModel: row.upstream_model,
    options: row.options,
    unit: row.unit,
    unitsPerQuantity: String(effectivePrice),
    minimumSuccess: row.minimum_success,
  };
  await tx.query(
    "INSERT INTO quotes(id,user_id,model_id,model_version,rate_id,capability,operation,params,input_hash,reserved_units,quantity,route_snapshot,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [
      id,
      auth.userId,
      row.id,
      row.version,
      row.rate_id,
      row.capability,
      row.operation,
      JSON.stringify(body.params),
      inputHash,
      String(reserved),
      String(quantity),
      JSON.stringify(route),
      expiresAt,
    ],
  );
  return {
    id,
    quoteId: id,
    modelId: row.id,
    operation: row.operation,
    reservedUnits: String(reserved),
    expiresAt,
    description: `${row.display_name}，最多预留 ${String(reserved / 1000n)} 积分`,
    inputHash,
    rateVersion: row.rate_id,
  };
}
export async function jobView(tx: Tx, row: Record<string, any>) {
  const quote = (
    await tx.query("SELECT model_id FROM quotes WHERE id=$1", [row.quote_id])
  ).rows[0];
  const artifacts = (
    await tx.query(
      "SELECT * FROM artifacts WHERE job_id=$1 ORDER BY created_at,id",
      [row.id],
    )
  ).rows;
  return {
    id: row.id,
    modelId: quote.model_id,
    state:
      row.state === "delivery_review"
        ? "awaiting_delivery"
        : row.state === "cancel_requested"
          ? "running"
          : row.state,
    reservedUnits: row.reserved_units,
    settledUnits: row.settled_units,
    releasedUnits: row.released_units,
    createdAt: iso(row.created_at),
    message: row.failure_code || undefined,
    artifacts: artifacts.map((a) => ({
      id: a.id,
      name: a.label,
      mime: a.mime,
      size: Number(a.size),
      sha256: a.sha256,
    })),
  };
}
export async function createJob(tx: Tx, auth: AuthContext, input: unknown) {
  const body = z
    .object({ quoteId: z.uuid(), operationId: z.string().min(8).max(180) })
    .strict()
    .parse(input);
  const quote = (
    await tx.query(
      "SELECT * FROM quotes WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [body.quoteId, auth.userId],
    )
  ).rows[0];
  if (!quote) throw new ApiError("NOT_FOUND", "报价不存在。", 404);
  const prior = (
    await tx.query(
      "SELECT * FROM generation_jobs WHERE user_id=$1 AND (quote_id=$2 OR client_operation_id=$3)",
      [auth.userId, quote.id, body.operationId],
    )
  ).rows[0];
  if (prior) {
    if (prior.quote_id !== quote.id)
      throw new ApiError(
        "IDEMPOTENCY_CONFLICT",
        "同一操作不能使用不同报价。",
        409,
      );
    return jobView(tx, prior);
  }
  if (quote.expires_at < Date.now())
    throw new ApiError("QUOTE_EXPIRED", "报价已过期，请重新确认。", 409);
  await requireLicense(tx, auth, quote.capability);
  const route = (
    await tx.query("SELECT enabled FROM provider_routes WHERE id=$1", [
      quote.route_snapshot.id,
    ])
  ).rows[0];
  if (!route?.enabled)
    throw new ApiError("MODEL_UNAVAILABLE", "此模型渠道已停用。", 409);
  const id = randomUUID(),
    job = (
      await tx.query(
        "INSERT INTO generation_jobs(id,user_id,quote_id,client_operation_id,reserved_units,submission_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          id,
          auth.userId,
          quote.id,
          body.operationId,
          quote.reserved_units,
          randomUUID(),
        ],
      )
    ).rows[0];
  await reserve(tx, auth.userId, id, BigInt(quote.reserved_units));
  await outbox(tx, "job.reserved", id);
  return jobView(tx, job);
}
export async function cancelJob(tx: Tx, auth: AuthContext, id: string) {
  const job = (
    await tx.query(
      "SELECT * FROM generation_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [id, auth.userId],
    )
  ).rows[0];
  if (!job) throw new ApiError("NOT_FOUND", "任务不存在。", 404);
  if (job.state === "reserved")
    return jobView(tx, await finalizeJob(tx, id, 0n, "cancelled_released"));
  if (
    [
      "submitting",
      "running",
      "submission_unknown",
      "awaiting_delivery",
    ].includes(job.state)
  ) {
    job.failure_code = "当前上游任务已受理，继续查询原任务；不会重复生成。";
  }
  return jobView(tx, job);
}
