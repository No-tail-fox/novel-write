import Fastify from "fastify";
import { randomUUID, randomBytes, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type pg from "pg";
import type { PlatformConfig } from "./config.js";
import {
  ApiError,
  transaction,
  idempotent,
  audit,
  type Tx,
  iso,
} from "./db.js";
import {
  authenticate,
  createChallenge,
  verifyChallenge,
  refreshSession,
  publicProfile,
  assertCurrentAccount,
  type AuthContext,
  type RequestWithRaw,
} from "./auth.js";
import {
  wallet,
  walletView,
  transactionHistory,
  grant,
  reconcileWallets,
  finalizeJob,
} from "./wallet.js";
import { redeem, bindDevice, entitlementView } from "./licenses.js";
import {
  catalog,
  createQuote,
  createJob,
  jobView,
  cancelJob,
  parameterSchemas,
  capabilities,
} from "./models.js";
import {
  WechatPay,
  acceptPayment,
  createRefund,
  orderView,
  completeRefund,
  releaseRefund,
} from "./payments.js";
import {
  digest,
  hash,
  signedToken,
  readToken,
  canonical,
  encrypt,
  decrypt,
} from "./crypto.js";
import { putObject, getObject, validMedia } from "./artifacts.js";

const idSchema = z.uuid();
const units = z.string().regex(/^[1-9]\d{0,15}$/);
export function buildApp(config: PlatformConfig, pool: pg.Pool) {
  const app = Fastify({
    logger: {
      level: "warn",
      redact: [
        "req.headers.authorization",
        "req.body",
        "res.headers.set-cookie",
      ],
    },
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });
  const pay = new WechatPay(config);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      try {
        (request as RequestWithRaw).rawBody = body as string;
        done(null, body ? JSON.parse(body as string) : {});
      } catch {
        done(new ApiError("INVALID_JSON", "请求不是有效 JSON。"), undefined);
      }
    },
  );
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: 52428800 },
    (_request, body, done) => done(null, body),
  );
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: "INPUT_INVALID",
          message: "请求参数无效。",
          retryable: false,
          requestId: request.id,
        },
      });
    if (error instanceof ApiError)
      return reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          requestId: request.id,
        },
      });
    if ((error as { code?: string }).code === "23505")
      return reply.code(409).send({
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message: "记录已存在，请查询原请求。",
          retryable: false,
          requestId: request.id,
        },
      });
    request.log.error(
      {
        code: (error as { code?: string }).code,
        name: error instanceof Error ? error.name : "Error",
      },
      "Platform request failed",
    );
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "服务暂时未完成请求，请查询原操作状态。",
        retryable: true,
        requestId: request.id,
      },
    });
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    return payload;
  });
  const auth = (request: RequestWithRaw) => authenticate(pool, config, request);
  const write = async <T>(
    request: RequestWithRaw,
    context: AuthContext,
    fn: (tx: Tx) => Promise<T>,
  ) =>
    transaction(pool, (tx) =>
      idempotent(
        tx,
        context.userId + ":" + request.method + ":" + request.routeOptions.url,
        String(request.headers["idempotency-key"] || ""),
        { params: request.params, body: request.body ?? {} },
        async () => {
          await assertCurrentAccount(tx, context);
          return fn(tx);
        },
      ),
    );
  const ownedJob = async (tx: Tx, userId: string, id: string) => {
    const row = (
      await tx.query(
        "SELECT * FROM generation_jobs WHERE id=$1 AND user_id=$2",
        [idSchema.parse(id), userId],
      )
    ).rows[0];
    if (!row) throw new ApiError("NOT_FOUND", "任务不存在。", 404);
    return row;
  };
  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok", environment: config.environment };
  });
  app.get("/v1/public/config", () =>
    transaction(pool, async (tx) => ({
      environment:
        config.environment === "production" ? "production" : "development",
      paymentAvailable: config.fixtureMode || pay.enabled(),
      catalog: await catalog(tx, config),
    })),
  );
  app.post("/v1/auth/challenges", (request) =>
    createChallenge(pool, config, request),
  );
  app.post("/v1/auth/verify", (request) =>
    verifyChallenge(pool, config, request),
  );
  app.post("/v1/auth/refresh", (request) =>
    refreshSession(pool, config, request),
  );
  app.post("/v1/auth/logout", async (request) => {
    const a = await auth(request);
    const body = z
      .object({ allSessions: z.boolean().optional() })
      .strict()
      .parse(request.body || {});
    await transaction(pool, async (tx) => {
      await tx.query(
        body.allSessions
          ? "UPDATE sessions SET revoked_at=now() WHERE user_id=$1"
          : "UPDATE sessions SET revoked_at=now() WHERE id=$1",
        [body.allSessions ? a.userId : a.sessionId],
      );
      await audit(tx, a.userId, "session.logout", a.sessionId);
    });
    return { ok: true };
  });
  const devices = async (tx: Tx, a: AuthContext) =>
    (
      await tx.query(
        "SELECT id,label,last_seen_at FROM devices WHERE user_id=$1 AND disabled_at IS NULL ORDER BY last_seen_at DESC",
        [a.userId],
      )
    ).rows.map((d) => ({
      id: d.id,
      name: d.label,
      current: d.id === a.deviceId,
      lastSeenAt: iso(d.last_seen_at),
    }));
  app.get("/v1/me/snapshot", async (request) => {
    const a = await auth(request);
    return transaction(pool, async (tx) => {
      const row = (
        await tx.query(
          "SELECT * FROM entitlements WHERE user_id=$1 ORDER BY CASE WHEN status='active' AND (expires_at IS NULL OR expires_at>now()) THEN 0 ELSE 1 END,created_at DESC LIMIT 1",
          [a.userId],
        )
      ).rows[0];
      let license: Record<string, unknown> | null = row
        ? entitlementView(row)
        : null;
      if (row?.status === "active" && config.licensePrivateKey) {
        await tx.query("SAVEPOINT device_lease");
        try {
          const bound = await bindDevice(tx, config, a, row.id);
          license = {
            ...bound.entitlement,
            lease: JSON.stringify(bound.lease),
          };
          await tx.query("RELEASE SAVEPOINT device_lease");
        } catch (error) {
          await tx.query("ROLLBACK TO SAVEPOINT device_lease");
          if (!(error instanceof ApiError)) throw error;
          license = { ...license, status: "inactive" };
        }
      }
      return {
        user: await publicProfile(tx, a.userId),
        wallet: walletView(await wallet(tx, a.userId)),
        license,
        devices: await devices(tx, a),
      };
    });
  });
  app.get("/v1/me", async (request) => {
    const a = await auth(request);
    return transaction(pool, (tx) => publicProfile(tx, a.userId));
  });
  app.patch("/v1/me", async (request) => {
    const a = await auth(request),
      body = z
        .object({ displayName: z.string().trim().min(1).max(100) })
        .strict()
        .parse(request.body);
    return write(request, a, async (tx) => {
      await tx.query("UPDATE users SET display_name=$2 WHERE id=$1", [
        a.userId,
        body.displayName,
      ]);
      return publicProfile(tx, a.userId);
    });
  });
  app.get("/v1/me/devices", async (request) => {
    const a = await auth(request);
    return transaction(pool, (tx) => devices(tx, a));
  });
  app.delete("/v1/me/devices/:id/binding", async (request) => {
    const a = await auth(request),
      id = idSchema.parse((request.params as any).id);
    return write(request, a, async (tx) => {
      const row = (
        await tx.query(
          "SELECT id FROM devices WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [id, a.userId],
        )
      ).rows[0];
      if (!row) throw new ApiError("NOT_FOUND", "设备不存在。", 404);
      await tx.query(
        "UPDATE device_bindings SET revoked_at=now() WHERE device_id=$1",
        [id],
      );
      await tx.query(
        "UPDATE sessions SET revoked_at=now() WHERE device_id=$1",
        [id],
      );
      await tx.query("UPDATE devices SET disabled_at=now() WHERE id=$1", [id]);
      await audit(tx, a.userId, "device.unbind", id);
      return { ok: true };
    });
  });
  app.get("/v1/me/sessions", async (request) => {
    const a = await auth(request);
    return (
      await pool.query(
        'SELECT id,device_id AS "deviceId",created_at AS "createdAt" FROM sessions WHERE user_id=$1 AND revoked_at IS NULL',
        [a.userId],
      )
    ).rows;
  });
  app.delete("/v1/me/sessions/:id", async (request) => {
    const a = await auth(request),
      id = idSchema.parse((request.params as any).id);
    return write(request, a, async (tx) => {
      await tx.query(
        "UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2",
        [id, a.userId],
      );
      return { ok: true };
    });
  });
  app.post("/v1/licenses/redeem", async (request) => {
    const a = await auth(request),
      body = z
        .object({ code: z.string().trim().min(12).max(120) })
        .strict()
        .parse(request.body);
    const license = await write(request, a, (tx) =>
      redeem(tx, config, a, body.code),
    );
    try {
      const result = await transaction(pool, (tx) =>
        bindDevice(tx, config, a, license.id),
      );
      return { ...result.entitlement, lease: JSON.stringify(result.lease) };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ...license, status: "inactive" };
    }
  });
  for (const path of ["/v1/licenses/bind-device", "/v1/licenses/renew-lease"])
    app.post(path, async (request) => {
      const a = await auth(request),
        body = z
          .object({ entitlementId: z.uuid() })
          .strict()
          .parse(request.body);
      return write(request, a, (tx) =>
        bindDevice(tx, config, a, body.entitlementId),
      );
    });
  app.get("/v1/wallet", async (request) => {
    const a = await auth(request);
    return transaction(pool, async (tx) =>
      walletView(await wallet(tx, a.userId)),
    );
  });
  app.get("/v1/wallet/transactions", async (request) => {
    const a = await auth(request);
    return transaction(pool, async (tx) =>
      (await transactionHistory(tx, a.userId)).items.map((i) => ({
        ...i,
        description:
          (
            {
              reserve: "任务预留",
              settle: "生成结算",
              release: "释放预留",
              recharge: "充值到账",
              grant: "开发测试积分",
              refund_freeze: "退款冻结",
              refund: "退款扣回",
            } as Record<string, string>
          )[i.kind] || i.kind,
      })),
    );
  });
  app.get("/v1/recharge/products", async () => {
    if (!config.fixtureMode && !pay.enabled()) return [];
    return (
      await pool.query(
        "SELECT * FROM recharge_products WHERE enabled=true ORDER BY amount_fen",
      )
    ).rows.map((r) => ({
      id: r.id,
      version: r.version,
      name: r.name,
      amountFen: r.amount_fen,
      creditUnits: String(BigInt(r.paid_units) + BigInt(r.bonus_units)),
    }));
  });
  app.post("/v1/recharge/orders", async (request) => {
    const a = await auth(request),
      body = z
        .object({
          productId: z.string().min(1).max(100),
          version: z.string().min(1).max(100),
        })
        .strict()
        .parse(request.body);
    if (!config.fixtureMode && !pay.enabled())
      throw new ApiError("PAYMENT_UNAVAILABLE", "充值尚未开放。", 503);
    const order = await write(request, a, async (tx) => {
      const product = (
        await tx.query(
          "SELECT * FROM recharge_products WHERE id=$1 AND version=$2 AND enabled=true",
          [body.productId, body.version],
        )
      ).rows[0];
      if (!product)
        throw new ApiError(
          "PRODUCT_UNAVAILABLE",
          "充值套餐已下架或版本变化。",
          409,
        );
      const row = (
        await tx.query(
          "INSERT INTO recharge_orders(id,user_id,product_id,product_version,provider,amount_fen,paid_units,bonus_units,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            randomUUID(),
            a.userId,
            product.id,
            product.version,
            config.fixtureMode ? "fixture" : "wechat",
            product.amount_fen,
            product.paid_units,
            product.bonus_units,
            new Date(Date.now() + 1800000),
          ],
        )
      ).rows[0];
      return orderView(row);
    });
    const row = (
      await pool.query("SELECT * FROM recharge_orders WHERE id=$1", [order.id])
    ).rows[0];
    if (row.status === "created") {
      const claimed = await pool.query(
        "UPDATE recharge_orders SET status='payment_pending' WHERE id=$1 AND status='created' RETURNING *",
        [row.id],
      );
      if (claimed.rowCount) {
        try {
          const paymentAction = config.fixtureMode
            ? {
                type: "development",
                url: config.publicUrl + "/operator?order=" + row.id,
              }
            : await pay.create(row);
          await pool.query(
            "UPDATE recharge_orders SET payment_action=$2 WHERE id=$1",
            [row.id, JSON.stringify(paymentAction)],
          );
        } catch {
          await transaction(pool, (tx) =>
            audit(tx, "payment", "payment.creation-unknown", row.id),
          );
        }
      }
    }
    return orderView(
      (
        await pool.query("SELECT * FROM recharge_orders WHERE id=$1", [
          order.id,
        ])
      ).rows[0],
    );
  });
  app.get("/v1/recharge/orders", async (request) => {
    const a = await auth(request);
    return (
      await pool.query(
        "SELECT * FROM recharge_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
        [a.userId],
      )
    ).rows.map(orderView);
  });
  app.get("/v1/recharge/orders/:id", async (request) => {
    const a = await auth(request),
      id = idSchema.parse((request.params as any).id);
    const row = (
      await pool.query(
        "SELECT * FROM recharge_orders WHERE id=$1 AND user_id=$2",
        [id, a.userId],
      )
    ).rows[0];
    if (!row) throw new ApiError("NOT_FOUND", "订单不存在。", 404);
    return orderView(row);
  });
  app.post("/v1/recharge/orders/:id/refunds", async (request) => {
    const a = await auth(request),
      id = idSchema.parse((request.params as any).id);
    z.object({})
      .strict()
      .parse(request.body || {});
    return write(request, a, async (tx) => {
      await createRefund(tx, a.userId, id, "用户申请未消费充值整单退款");
      await tx.query(
        "UPDATE recharge_orders SET status='refund_pending' WHERE id=$1 AND status='credited'",
        [id],
      );
      return orderView(
        (await tx.query("SELECT * FROM recharge_orders WHERE id=$1", [id]))
          .rows[0],
      );
    });
  });
  app.post("/v1/payments/wechat/webhook", async (request, reply) => {
    const event = pay.webhook(
      request.headers,
      (request as RequestWithRaw).rawBody || "",
    );
    await transaction(pool, async (tx) => {
      if ("refundId" in event) {
        const refund = (
          await tx.query(
            "SELECT amount_fen FROM refunds WHERE id=$1 AND order_id=$2",
            [event.refundId, event.orderId],
          )
        ).rows[0];
        if (!refund || refund.amount_fen !== event.amountFen)
          throw new ApiError(
            "REFUND_MISMATCH",
            "退款金额与原退款单不匹配。",
            409,
          );
        if (event.state === "SUCCESS")
          await completeRefund(
            tx,
            event.refundId,
            event.providerRefundId,
            event.orderId,
          );
        else if (event.state === "CLOSED")
          await releaseRefund(
            tx,
            event.refundId,
            "Verified provider refund closed",
          );
        else await audit(tx, "payment", "refund.abnormal", event.refundId);
      } else await acceptPayment(tx, config, "wechat", event);
    });
    return reply.send({ code: "SUCCESS", message: "成功" });
  });
  app.get("/v1/models/catalog", () =>
    transaction(pool, (tx) => catalog(tx, config)),
  );
  app.post("/v1/quotes", async (request) => {
    const a = await auth(request);
    return write(request, a, (tx) => createQuote(tx, config, a, request.body));
  });
  app.post("/v1/jobs", async (request) => {
    const a = await auth(request);
    return write(request, a, (tx) => createJob(tx, a, request.body));
  });
  app.get("/v1/jobs", async (request) => {
    const a = await auth(request);
    return transaction(pool, async (tx) => {
      const rows = (
        await tx.query(
          "SELECT * FROM generation_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [a.userId],
        )
      ).rows;
      return Promise.all(rows.map((r) => jobView(tx, r)));
    });
  });
  app.get("/v1/jobs/:id", async (request) => {
    const a = await auth(request);
    return transaction(pool, async (tx) =>
      jobView(tx, await ownedJob(tx, a.userId, (request.params as any).id)),
    );
  });
  app.post("/v1/jobs/:id/cancel", async (request) => {
    const a = await auth(request);
    z.object({})
      .strict()
      .parse(request.body || {});
    return write(request, a, (tx) =>
      cancelJob(tx, a, idSchema.parse((request.params as any).id)),
    );
  });
  app.get("/v1/artifacts/:id", async (request, reply) => {
    const a = await auth(request),
      id = idSchema.parse((request.params as any).id),
      row = (
        await pool.query("SELECT * FROM artifacts WHERE id=$1 AND user_id=$2", [
          id,
          a.userId,
        ])
      ).rows[0];
    if (!row) throw new ApiError("NOT_FOUND", "产物不存在。", 404);
    return reply
      .type(row.mime)
      .header("Content-Length", row.size)
      .header("X-Content-SHA256", row.sha256)
      .send(await getObject(config, row.object_key));
  });
  app.post("/v1/assets/uploads", async (request) => {
    const a = await auth(request),
      body = z
        .object({
          size: z.number().int().min(1).max(52428800),
          mime: z.enum([
            "image/png",
            "image/jpeg",
            "image/webp",
            "audio/mpeg",
            "audio/wav",
          ]),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .parse(request.body);
    return write(request, a, async (tx) => {
      const id = randomUUID(),
        expiresAt = Date.now() + 600000;
      await tx.query(
        "INSERT INTO upload_assets(id,user_id,object_key,size,mime,sha256,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          a.userId,
          a.userId + "/" + id,
          body.size,
          body.mime,
          body.sha256,
          new Date(expiresAt),
        ],
      );
      return {
        assetId: id,
        uploadUrl:
          config.publicUrl +
          "/v1/assets/" +
          id +
          "/content?token=" +
          signedToken(
            { id, uid: a.userId, exp: expiresAt },
            config.tokenSecret,
          ),
        expiresAt: new Date(expiresAt).toISOString(),
      };
    });
  });
  app.put(
    "/v1/assets/:id/content",
    { bodyLimit: 52428800 },
    async (request) => {
      let token: { id: string; uid: string; exp: number };
      try {
        token = readToken(
          String((request.query as any).token || ""),
          config.tokenSecret,
        );
      } catch {
        throw new ApiError("UPLOAD_INVALID", "上传凭证无效。", 401);
      }
      if (token.exp < Date.now() || token.id !== (request.params as any).id)
        throw new ApiError("UPLOAD_EXPIRED", "上传已过期。", 401);
      const row = (
          await pool.query(
            "SELECT * FROM upload_assets WHERE id=$1 AND user_id=$2 AND verified=false",
            [token.id, token.uid],
          )
        ).rows[0],
        bytes = request.body;
      if (
        !row ||
        !Buffer.isBuffer(bytes) ||
        bytes.length !== Number(row.size) ||
        !validMedia(bytes, row.mime)
      )
        throw new ApiError("ASSET_INVALID", "素材大小或内容格式不符。");
      const metadata = await putObject(config, row.object_key, bytes);
      if (metadata.sha256 !== row.sha256)
        throw new ApiError("ASSET_HASH_MISMATCH", "素材摘要不符。");
      return { uploaded: true };
    },
  );
  app.post("/v1/assets/:id/complete", async (request) => {
    const a = await auth(request),
      id = idSchema.parse((request.params as any).id);
    return write(request, a, async (tx) => {
      const row = (
        await tx.query(
          "SELECT * FROM upload_assets WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE",
          [id, a.userId],
        )
      ).rows[0];
      if (!row)
        throw new ApiError("ASSET_INVALID", "素材不存在或已过期。", 404);
      const bytes = await getObject(config, row.object_key),
        metadata = await putObject(config, row.object_key, bytes);
      if (
        metadata.sha256 !== row.sha256 ||
        metadata.size !== Number(row.size) ||
        !validMedia(bytes, row.mime)
      )
        throw new ApiError("ASSET_INVALID", "素材校验失败。");
      await tx.query(
        "UPDATE upload_assets SET verified=true,expires_at=now()+interval '7 days' WHERE id=$1",
        [id],
      );
      return { assetId: id, verified: true };
    });
  });
  app.get("/v1/updates/check", async (request) => {
    const query = z
      .object({
        version: z.string().max(40),
        platform: z.string().max(30),
        arch: z.string().max(20),
        channel: z.enum(["stable", "beta"]),
      })
      .strict()
      .parse(request.query);
    const cohort =
      parseInt(
        hash(String(request.headers["x-device-id"] || "anonymous")).slice(0, 8),
        16,
      ) % 100;
    const row = (
      await pool.query(
        "SELECT manifest FROM release_manifests WHERE platform=$1 AND arch=$2 AND channel=$3 AND enabled=true AND rollout>$4 ORDER BY build DESC LIMIT 1",
        [query.platform, query.arch, query.channel, cohort],
      )
    ).rows[0];
    if (!row || row.manifest.version === query.version) return null;
    return row.manifest;
  });

  const operator = async (request: RequestWithRaw, roles = ["admin"]) => {
    const a = await auth(request),
      row = (
        await pool.query(
          "SELECT role FROM operator_users WHERE user_id=$1 AND enabled=true",
          [a.userId],
        )
      ).rows[0];
    if (!row || !roles.includes(row.role))
      throw new ApiError("OPERATOR_REQUIRED", "需要相应运营权限。", 403);
    if (request.method !== "GET") {
      const session = (
        await pool.query(
          "SELECT 1 FROM sessions WHERE id=$1 AND created_at>now()-interval '15 minutes'",
          [a.sessionId],
        )
      ).rowCount;
      if (!session)
        throw new ApiError(
          "REAUTH_REQUIRED",
          "此敏感操作需要重新验证登录。",
          401,
        );
    }
    return a;
  };
  app.get("/v1/operator/overview", async (request) => {
    await operator(request, ["admin", "finance", "support"]);
    const counts: Record<string, number> = {};
    for (const table of [
      "users",
      "recharge_orders",
      "generation_jobs",
      "refunds",
    ])
      counts[table] = (
        await pool.query(`SELECT count(*)::int AS count FROM ${table}`)
      ).rows[0].count;
    return {
      counts,
      environment: config.environment,
      fixtureMode: config.fixtureMode,
      paymentConfigured: pay.enabled(),
    };
  });
  const tableViews: Record<string, string> = {
    users:
      "SELECT u.*,w.available_units,w.reserved_units,w.frozen_units FROM users u JOIN wallets w ON w.user_id=u.id ORDER BY u.created_at DESC LIMIT 100",
    orders: "SELECT * FROM recharge_orders ORDER BY created_at DESC LIMIT 100",
    refunds: "SELECT * FROM refunds ORDER BY created_at DESC LIMIT 100",
    jobs: "SELECT id,user_id,quote_id,state,reserved_units,settled_units,failure_code,created_at FROM generation_jobs ORDER BY created_at DESC LIMIT 100",
    ledger:
      "SELECT * FROM ledger_transactions ORDER BY created_at DESC LIMIT 100",
    licenses: "SELECT * FROM entitlements ORDER BY created_at DESC LIMIT 100",
    models:
      "SELECT m.*,p.adapter,p.origin,p.credential_ref,p.upstream_model,p.enabled AS route_enabled FROM model_entries m JOIN provider_routes p ON p.id=m.route_id ORDER BY m.id",
    releases:
      "SELECT id,version,platform,arch,channel,build,rollout,enabled,created_at FROM release_manifests ORDER BY build DESC",
    audit: "SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100",
    products: "SELECT * FROM recharge_products ORDER BY id,version",
  };
  app.get("/v1/operator/data/:kind", async (request) => {
    const kind = String((request.params as any).kind);
    await operator(
      request,
      kind === "models" ? ["admin"] : ["admin", "finance", "support"],
    );
    if (!tableViews[kind])
      throw new ApiError("NOT_FOUND", "管理视图不存在。", 404);
    return (await pool.query(tableViews[kind])).rows;
  });
  app.post("/v1/operator/users/:id/status", async (request) => {
    const a = await operator(request),
      id = idSchema.parse((request.params as any).id),
      body = z
        .object({
          status: z.enum(["active", "restricted"]),
          reason: z.string().min(5).max(500),
        })
        .strict()
        .parse(request.body);
    return write(request, a, async (tx) => {
      await tx.query("UPDATE users SET status=$2 WHERE id=$1", [
        id,
        body.status,
      ]);
      await audit(tx, a.userId, "user.status", id, body);
      return { ok: true };
    });
  });
  app.post("/v1/operator/recharge-products", async (request) => {
    const a = await operator(request),
      body = z
        .object({
          id: z.string().min(1).max(100),
          version: z.string().min(1).max(80),
          name: z.string().min(1).max(100),
          amountFen: units,
          paidUnits: units,
          bonusUnits: z.string().regex(/^(0|[1-9]\d{0,15})$/),
          enabled: z.boolean(),
        })
        .strict()
        .parse(request.body);
    if (BigInt(body.amountFen) > 1000000n)
      throw new ApiError("PRODUCT_LIMIT", "单笔充值不能超过 10000 元。");
    return write(request, a, async (tx) => {
      await tx.query(
        "INSERT INTO recharge_products(id,version,name,amount_fen,paid_units,bonus_units,enabled) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          body.id,
          body.version,
          body.name,
          body.amountFen,
          body.paidUnits,
          body.bonusUnits,
          body.enabled,
        ],
      );
      await audit(tx, a.userId, "product.publish", body.id, body);
      return { ok: true };
    });
  });
  for (const [resource, table] of [
    ["recharge-products", "recharge_products"],
    ["license-products", "license_products"],
  ] as const)
    app.post(
      `/v1/operator/${resource}/:id/:version/enabled`,
      async (request) => {
        const a = await operator(request),
          params = z
            .object({ id: z.string().max(100), version: z.string().max(100) })
            .parse(request.params),
          body = z
            .object({
              enabled: z.boolean(),
              reason: z.string().min(5).max(500),
            })
            .strict()
            .parse(request.body);
        return write(request, a, async (tx) => {
          const changed = await tx.query(
            `UPDATE ${table} SET enabled=$3 WHERE id=$1 AND version=$2`,
            [params.id, params.version, body.enabled],
          );
          if (!changed.rowCount)
            throw new ApiError("NOT_FOUND", "商品版本不存在。", 404);
          await audit(tx, a.userId, resource + ".enabled", params.id, {
            ...body,
            version: params.version,
          });
          return { ok: true };
        });
      },
    );
  app.post("/v1/operator/license-products", async (request) => {
    const a = await operator(request),
      body = z
        .object({
          id: z.string().min(1).max(100),
          version: z.string().min(1).max(80),
          name: z.string().min(1).max(100),
          kind: z.enum(["trial", "subscription", "perpetual"]),
          durationDays: z.number().int().positive().max(3650).nullable(),
          deviceLimit: z.number().int().min(1).max(100),
          features: z.array(z.string().max(100)).min(1).max(30),
          enabled: z.boolean(),
        })
        .strict()
        .parse(request.body);
    return write(request, a, async (tx) => {
      await tx.query(
        "INSERT INTO license_products(id,version,name,kind,duration_days,device_limit,features,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          body.id,
          body.version,
          body.name,
          body.kind,
          body.durationDays,
          body.deviceLimit,
          JSON.stringify(body.features),
          body.enabled,
        ],
      );
      await audit(tx, a.userId, "license-product.publish", body.id, body);
      return { ok: true };
    });
  });
  app.post("/v1/operator/activation-codes", async (request) => {
    const a = await operator(request),
      body = z
        .object({
          productId: z.string().max(100),
          version: z.string().max(80),
          count: z.number().int().min(1).max(100),
          expiresAt: z.iso.datetime().optional(),
        })
        .strict()
        .parse(request.body);
    const stored = await write(request, a, async (tx) => {
      const codes = [];
      for (let i = 0; i < body.count; i++) {
        const code = "SD-" + randomBytes(20).toString("hex").toUpperCase(),
          id = randomUUID();
        await tx.query(
          "INSERT INTO activation_codes(id,digest,suffix,product_id,product_version,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            digest(code, config.pepper),
            code.slice(-6),
            body.productId,
            body.version,
            body.expiresAt || null,
          ],
        );
        codes.push({ id, code });
      }
      await audit(tx, a.userId, "activation-codes.issue", body.productId, {
        count: body.count,
      });
      return { ciphertext: encrypt({ codes }, config.tokenSecret) };
    });
    return decrypt(stored.ciphertext, config.tokenSecret);
  });
  app.post("/v1/operator/models", async (request) => {
    const a = await operator(request),
      body = z
        .object({
          id: z.string().min(1).max(128),
          version: z.string().min(1).max(80),
          name: z.string().min(1).max(100),
          capability: z.enum(capabilities),
          operation: z.string().min(1).max(100),
          adapter: z.enum([
            "suno",
            "openai-text",
            "openai-image",
            "openai-speech",
            "openai-transcription",
            "openai-vision",
            "async-video",
            "fixture",
          ]),
          origin: z.url(),
          credentialRef: z.string().regex(/^[A-Z][A-Z0-9_]{1,100}$/),
          upstreamModel: z.string().min(1).max(128),
          priceUnits: units,
          unit: z.enum(["request", "image", "second", "character", "token"]),
          maxQuantity: units,
          enabled: z.boolean(),
          isDefault: z.boolean().default(false),
        })
        .strict()
        .parse(request.body);
    const origin = new URL(body.origin);
    if (
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      (origin.protocol !== "https:" &&
        !(config.fixtureMode && body.adapter === "fixture"))
    )
      throw new ApiError("ROUTE_INVALID", "平台渠道必须是固定 HTTPS 根地址。");
    const allowedUnits = {
      text: ["request", "token"],
      vision: ["request", "token"],
      image: ["request", "image"],
      video: ["request", "second"],
      music: ["request"],
      tts: ["request", "character"],
      speechToText: ["request"],
    }[body.capability];
    if (!allowedUnits.includes(body.unit))
      throw new ApiError("RATE_UNIT_UNSUPPORTED", "该能力暂不支持此计量方式。");
    if (body.operation !== body.capability + ".generate")
      throw new ApiError(
        "OPERATION_UNSUPPORTED",
        "此平台适配器尚未开放该计费操作。",
      );
    const adapterCapability = {
      suno: "music",
      "openai-text": "text",
      "openai-image": "image",
      "openai-speech": "tts",
      "openai-transcription": "speechToText",
      "openai-vision": "vision",
      "async-video": "video",
      fixture: body.capability,
    }[body.adapter];
    if (adapterCapability !== body.capability)
      throw new ApiError(
        "ADAPTER_CAPABILITY_MISMATCH",
        "模型能力与适配器不一致。",
      );
    if (
      body.adapter !== "fixture" &&
      !/^(?:[A-Z][A-Z0-9_]*_API_KEY|PLATFORM_PROVIDER_[A-Z0-9_]+_KEY)$/.test(
        body.credentialRef,
      )
    )
      throw new ApiError(
        "CREDENTIAL_REF_INVALID",
        "凭据引用必须是专用模型渠道 API key 环境变量。",
      );
    if (body.adapter === "fixture" && !config.fixtureMode)
      throw new ApiError("ROUTE_INVALID", "生产环境禁用测试模型。");
    return write(request, a, async (tx) => {
      const routeId = randomUUID();
      await tx.query(
        "INSERT INTO provider_routes(id,adapter,origin,credential_ref,upstream_model,enabled) VALUES($1,$2,$3,$4,$5,$6)",
        [
          routeId,
          body.adapter,
          origin.origin,
          body.credentialRef,
          body.upstreamModel,
          body.enabled,
        ],
      );
      await tx.query(
        "INSERT INTO model_entries(id,version,capability,operation,display_name,route_id,parameter_schema,enabled,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          body.id,
          body.version,
          body.capability,
          body.operation,
          body.name,
          routeId,
          JSON.stringify(parameterSchemas[body.capability]),
          body.enabled,
          body.isDefault,
        ],
      );
      await tx.query(
        "INSERT INTO rate_versions(id,model_id,model_version,unit,units_per_quantity,max_quantity) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          body.id,
          body.version,
          body.unit,
          body.priceUnits,
          body.maxQuantity,
        ],
      );
      await audit(tx, a.userId, "model.publish", body.id, {
        version: body.version,
        capability: body.capability,
        priceUnits: body.priceUnits,
      });
      return { id: body.id, version: body.version };
    });
  });
  app.post("/v1/operator/models/:routeId/enabled", async (request) => {
    const a = await operator(request),
      id = idSchema.parse((request.params as any).routeId),
      body = z
        .object({ enabled: z.boolean(), reason: z.string().min(5).max(500) })
        .strict()
        .parse(request.body);
    return write(request, a, async (tx) => {
      await tx.query("UPDATE provider_routes SET enabled=$2 WHERE id=$1", [
        id,
        body.enabled,
      ]);
      await audit(tx, a.userId, "model.route-enabled", id, body);
      return { ok: true };
    });
  });
  app.post("/v1/operator/reconcile", async (request) => {
    const a = await operator(request, ["admin", "finance"]);
    return write(request, a, async (tx) => {
      const differences = await reconcileWallets(tx);
      await audit(tx, a.userId, "wallet.reconcile", "all", {
        differences: differences.length,
      });
      return { differences };
    });
  });
  app.post("/v1/operator/wallets/:id/rebuild", async (request) => {
    const a = await operator(request, ["admin", "finance"]),
      id = idSchema.parse((request.params as any).id),
      body = z
        .object({ reason: z.string().min(10).max(500) })
        .strict()
        .parse(request.body);
    return write(request, a, async (tx) => {
      const before = await wallet(tx, id, true);
      await tx.query("SELECT rebuild_wallet_projection($1)", [id]);
      await audit(tx, a.userId, "wallet.rebuild-projection", id, {
        reason: body.reason,
        before: walletView(before),
      });
      return walletView(await wallet(tx, id));
    });
  });
  app.post("/v1/operator/releases", async (request) => {
    const a = await operator(request),
      manifestSchema = z
        .object({
          version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
          platform: z.enum(["win32", "darwin", "linux"]),
          arch: z.enum(["x64", "arm64"]),
          channel: z.enum(["stable", "beta"]),
          publishedAt: z.iso.datetime(),
          releaseNotes: z.string().max(50000),
          url: z.url(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          size: z
            .number()
            .int()
            .positive()
            .max(8 * 1024 ** 3),
          minAppVersion: z
            .string()
            .regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
          keyId: z.string().min(1).max(128),
          signature: z.string().max(256),
        })
        .strict();
    const body = z
        .object({
          manifest: manifestSchema,
          build: units,
          rollout: z.number().int().min(0).max(100),
          enabled: z.boolean(),
        })
        .strict()
        .parse(request.body),
      { signature, ...payload } = body.manifest;
    const key = config.updatePublicKeys[payload.keyId],
      url = new URL(payload.url);
    if (
      !key ||
      !verify(
        null,
        Buffer.from(canonical(payload)),
        key,
        Buffer.from(signature, "base64"),
      )
    )
      throw new ApiError(
        "RELEASE_SIGNATURE_INVALID",
        "发布清单签名无效，必须由独立发布流程签名。",
      );
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !config.updateOrigins.includes(url.origin)
    )
      throw new ApiError(
        "RELEASE_ORIGIN_INVALID",
        "下载域名不在发布允许列表。",
      );
    return write(request, a, async (tx) => {
      const id = randomUUID();
      await tx.query(
        "INSERT INTO release_manifests(id,platform,arch,channel,version,build,manifest,rollout,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          id,
          payload.platform,
          payload.arch,
          payload.channel,
          payload.version,
          body.build,
          JSON.stringify(body.manifest),
          body.rollout,
          body.enabled,
        ],
      );
      await audit(tx, a.userId, "release.publish", id, {
        version: payload.version,
        build: body.build,
        rollout: body.rollout,
      });
      return { id };
    });
  });
  app.post("/v1/operator/releases/:id/rollout", async (request) => {
    const a = await operator(request),
      id = idSchema.parse((request.params as any).id),
      body = z
        .object({
          enabled: z.boolean(),
          rollout: z.number().int().min(0).max(100),
          reason: z.string().min(5).max(500),
        })
        .strict()
        .parse(request.body);
    return write(request, a, async (tx) => {
      await tx.query(
        "UPDATE release_manifests SET enabled=$2,rollout=$3 WHERE id=$1",
        [id, body.enabled, body.rollout],
      );
      await audit(tx, a.userId, "release.rollout", id, body);
      return { ok: true };
    });
  });
  app.post("/v1/operator/jobs/:id/release", async (request) => {
    const a = await operator(request, ["admin", "finance"]),
      id = idSchema.parse((request.params as any).id),
      body = z
        .object({ reason: z.string().min(10).max(500) })
        .strict()
        .parse(request.body);
    return write(request, a, async (tx) => {
      const row = (
        await tx.query("SELECT * FROM generation_jobs WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if (
        !row ||
        !["submission_unknown", "delivery_review"].includes(row.state)
      )
        throw new ApiError(
          "JOB_REVIEW_REQUIRED",
          "仅待人工核对任务可以补偿释放。",
          409,
        );
      await finalizeJob(tx, id, 0n, "failed_released", "PLATFORM_COMPENSATION");
      await audit(tx, a.userId, "job.compensate", id, body);
      return { ok: true };
    });
  });
  if (config.fixtureMode) {
    app.post("/v1/operator/dev/orders/:id/pay", async (request) => {
      const a = await operator(request),
        id = idSchema.parse((request.params as any).id);
      return write(request, a, async (tx) => {
        const order = (
          await tx.query("SELECT * FROM recharge_orders WHERE id=$1", [id])
        ).rows[0];
        if (!order || order.provider !== "fixture")
          throw new ApiError("NOT_FOUND", "开发订单不存在。", 404);
        await audit(tx, a.userId, "development.payment", id);
        return acceptPayment(tx, config, "fixture", {
          eventId: "fixture:" + id,
          orderId: id,
          tradeId: "fixture:" + id,
          merchantId: "development",
          appId: "development",
          amountFen: order.amount_fen,
          currency: "CNY",
          state: "SUCCESS",
        });
      });
    });
    app.post("/v1/operator/dev/refunds/:id/complete", async (request) => {
      const a = await operator(request),
        id = idSchema.parse((request.params as any).id);
      return write(request, a, async (tx) => {
        const row = (await tx.query("SELECT * FROM refunds WHERE id=$1", [id]))
          .rows[0];
        if (!row) throw new ApiError("NOT_FOUND", "退款不存在。", 404);
        await audit(tx, a.userId, "development.refund", id);
        return completeRefund(tx, id, "fixture:" + id, row.order_id);
      });
    });
  }
  app.get("/operator", async (_request, reply) =>
    reply
      .type("text/html")
      .send(
        await readFile(
          new URL("../../../apps/operator-console/index.html", import.meta.url),
          "utf8",
        ),
      ),
  );
  return app;
}
