import {
  createSign,
  createVerify,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type pg from "pg";
import type { PlatformConfig } from "./config.js";
import { ApiError, audit, transaction, type Tx, iso, outbox } from "./db.js";
import { hash } from "./crypto.js";
import { grant, ledger, wallet } from "./wallet.js";

export interface VerifiedPayment {
  eventId: string;
  orderId: string;
  tradeId: string;
  merchantId: string;
  appId: string;
  amountFen: string;
  currency: string;
  state: "SUCCESS";
}
export class WechatPay {
  constructor(
    private config: PlatformConfig,
    private fetcher: typeof fetch = fetch,
  ) {}
  enabled() {
    const p = this.config.payment;
    return !!(
      p.merchantId &&
      p.appId &&
      p.privateKey &&
      p.certificateSerial &&
      p.apiKey &&
      p.notifyUrl &&
      Object.keys(p.platformCertificates).length
    );
  }
  private async request(path: string, method: string, body?: unknown) {
    if (!this.enabled())
      throw new ApiError(
        "PAYMENT_UNAVAILABLE",
        "微信支付尚未完成商户配置。",
        503,
      );
    const p = this.config.payment,
      timestamp = Math.floor(Date.now() / 1000).toString(),
      nonce = randomBytes(16).toString("hex"),
      raw = body === undefined ? "" : JSON.stringify(body);
    const signer = createSign("RSA-SHA256");
    signer.update(`${method}\n${path}\n${timestamp}\n${nonce}\n${raw}\n`);
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${p.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${p.certificateSerial}",signature="${signer.sign(p.privateKey!, "base64")}"`;
    const response = await this.fetcher(
      "https://api.mch.weixin.qq.com" + path,
      {
        method,
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : raw,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    const responseText = await response.text();
    this.verifySignature(
      Object.fromEntries(response.headers.entries()),
      responseText,
    );
    if (!response.ok)
      throw new ApiError(
        "PAYMENT_PROVIDER_ERROR",
        "支付服务暂未完成请求，请查询原订单。",
        502,
        true,
      );
    return responseText ? JSON.parse(responseText) : {};
  }
  verifySignature(
    headers: Record<string, string | string[] | undefined>,
    raw: string,
  ) {
    const timestamp = String(headers["wechatpay-timestamp"] || ""),
      nonce = String(headers["wechatpay-nonce"] || ""),
      signature = String(headers["wechatpay-signature"] || ""),
      serial = String(headers["wechatpay-serial"] || "");
    const certificate = this.config.payment.platformCertificates[serial];
    if (
      !certificate ||
      !/^\d+$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !nonce ||
      !signature
    )
      throw new ApiError(
        "PAYMENT_SIGNATURE_INVALID",
        "支付消息签名无效。",
        401,
      );
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${timestamp}\n${nonce}\n${raw}\n`);
    if (!verifier.verify(certificate, signature, "base64"))
      throw new ApiError(
        "PAYMENT_SIGNATURE_INVALID",
        "支付消息签名无效。",
        401,
      );
  }
  webhook(
    headers: Record<string, string | string[] | undefined>,
    raw: string,
  ):
    | VerifiedPayment
    | {
        refundId: string;
        providerRefundId: string;
        orderId: string;
        state: string;
        eventId: string;
        amountFen: string;
        currency: string;
      } {
    this.verifySignature(headers, raw);
    let envelope: any;
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new ApiError("PAYMENT_INVALID", "支付消息无效。");
    }
    if (
      envelope.resource?.algorithm !== "AEAD_AES_256_GCM" ||
      !this.config.payment.apiKey
    )
      throw new ApiError("PAYMENT_INVALID", "支付加密格式无效。");
    const data = Buffer.from(envelope.resource.ciphertext, "base64"),
      decipher = createDecipheriv(
        "aes-256-gcm",
        Buffer.from(this.config.payment.apiKey),
        Buffer.from(envelope.resource.nonce),
      );
    decipher.setAuthTag(data.subarray(-16));
    decipher.setAAD(Buffer.from(envelope.resource.associated_data || ""));
    let payload: any;
    try {
      payload = JSON.parse(
        Buffer.concat([
          decipher.update(data.subarray(0, -16)),
          decipher.final(),
        ]).toString("utf8"),
      );
    } catch {
      throw new ApiError("PAYMENT_INVALID", "支付消息解密失败。");
    }
    if (
      ["REFUND.SUCCESS", "REFUND.CLOSED", "REFUND.ABNORMAL"].includes(
        envelope.event_type,
      )
    ) {
      if (
        payload.mchid !== this.config.payment.merchantId ||
        !["SUCCESS", "CLOSED", "ABNORMAL"].includes(payload.refund_status) ||
        !Number.isSafeInteger(payload.amount?.refund) ||
        payload.amount?.currency !== "CNY"
      )
        throw new ApiError(
          "REFUND_MISMATCH",
          "退款消息商户或金额字段不匹配。",
          409,
        );
      return {
        refundId: payload.out_refund_no,
        providerRefundId: payload.refund_id,
        orderId: payload.out_trade_no,
        state: payload.refund_status,
        eventId: envelope.id,
        amountFen: String(payload.amount.refund),
        currency: payload.amount.currency,
      };
    }
    if (
      envelope.event_type !== "TRANSACTION.SUCCESS" ||
      payload.trade_state !== "SUCCESS"
    )
      throw new ApiError("PAYMENT_EVENT_UNSUPPORTED", "此事件不包含确认到账。");
    return {
      eventId: envelope.id,
      orderId: payload.out_trade_no,
      tradeId: payload.transaction_id,
      merchantId: payload.mchid,
      appId: payload.appid,
      amountFen: String(payload.amount?.total),
      currency: payload.amount?.currency,
      state: "SUCCESS",
    };
  }
  async create(order: Record<string, any>) {
    const p = this.config.payment;
    const result = await this.request("/v3/pay/transactions/native", "POST", {
      appid: p.appId,
      mchid: p.merchantId,
      description: "StoryDream 积分充值",
      out_trade_no: order.id,
      notify_url: p.notifyUrl,
      amount: { total: Number(order.amount_fen), currency: "CNY" },
    });
    return { type: "qr_code", url: result.code_url };
  }
  async query(orderId: string): Promise<VerifiedPayment | undefined> {
    const p = this.config.payment,
      r = await this.request(
        `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}?mchid=${encodeURIComponent(p.merchantId || "")}`,
        "GET",
      );
    if (r.trade_state !== "SUCCESS") return undefined;
    return {
      eventId: "query:" + r.transaction_id,
      orderId: r.out_trade_no,
      tradeId: r.transaction_id,
      merchantId: r.mchid,
      appId: r.appid,
      amountFen: String(r.amount.total),
      currency: r.amount.currency,
      state: "SUCCESS",
    };
  }
  async refund(refund: Record<string, any>, order: Record<string, any>) {
    return this.request("/v3/refund/domestic/refunds", "POST", {
      out_trade_no: order.id,
      out_refund_no: refund.id,
      reason: refund.reason.slice(0, 80),
      notify_url: this.config.payment.notifyUrl,
      amount: {
        refund: Number(refund.amount_fen),
        total: Number(order.amount_fen),
        currency: "CNY",
      },
    });
  }
  async queryRefund(id: string) {
    return this.request(
      "/v3/refund/domestic/refunds/" + encodeURIComponent(id),
      "GET",
    );
  }
}
export function orderView(row: Record<string, any>) {
  return {
    id: row.id,
    orderId: row.id,
    productId: row.product_id,
    productVersion: row.product_version,
    channel: row.provider,
    amountFen: row.amount_fen,
    creditUnits: String(BigInt(row.paid_units) + BigInt(row.bonus_units)),
    paidUnits: row.paid_units,
    bonusUnits: row.bonus_units,
    currency: row.currency,
    status: row.status === "created" ? "payment_pending" : row.status,
    paymentUrl: row.payment_action?.url,
    paymentAction: row.payment_action,
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    creditedAt: iso(row.credited_at),
  };
}
export async function acceptPayment(
  tx: Tx,
  config: PlatformConfig,
  provider: string,
  payment: VerifiedPayment,
) {
  const order = (
    await tx.query("SELECT * FROM recharge_orders WHERE id=$1 FOR UPDATE", [
      payment.orderId,
    ])
  ).rows[0];
  if (
    !order ||
    order.provider !== provider ||
    payment.state !== "SUCCESS" ||
    payment.amountFen !== order.amount_fen ||
    payment.currency !== order.currency ||
    payment.merchantId !==
      (provider === "fixture" ? "development" : config.payment.merchantId) ||
    payment.appId !==
      (provider === "fixture" ? "development" : config.payment.appId) ||
    !payment.tradeId ||
    !payment.eventId
  )
    throw new ApiError("PAYMENT_MISMATCH", "支付金额、商户或订单不匹配。", 409);
  const eventDigest = hash(JSON.stringify(payment)),
    prior = (
      await tx.query(
        "SELECT digest,order_id FROM payment_events WHERE provider=$1 AND event_id=$2",
        [provider, payment.eventId],
      )
    ).rows[0];
  if (prior && prior.digest !== eventDigest)
    throw new ApiError(
      "PAYMENT_EVENT_CONFLICT",
      "支付事件重复且内容不一致。",
      409,
    );
  if (order.provider_trade_id && order.provider_trade_id !== payment.tradeId)
    throw new ApiError(
      "PAYMENT_TRADE_CONFLICT",
      "订单已绑定其他支付记录。",
      409,
    );
  if (!prior)
    await tx.query(
      "INSERT INTO payment_events(provider,event_id,order_id,digest) VALUES($1,$2,$3,$4)",
      [provider, payment.eventId, order.id, eventDigest],
    );
  await tx.query(
    "UPDATE recharge_orders SET provider_trade_id=$2 WHERE id=$1",
    [order.id, payment.tradeId],
  );
  if (order.credited_at) return orderView(order);
  await grant(
    tx,
    order.user_id,
    order.id,
    BigInt(order.paid_units),
    BigInt(order.bonus_units),
  );
  const updated = (
    await tx.query(
      "UPDATE recharge_orders SET status='credited',credited_at=now() WHERE id=$1 RETURNING *",
      [order.id],
    )
  ).rows[0];
  await audit(tx, "payment:" + provider, "recharge.credited", order.id);
  return orderView(updated);
}
export async function createRefund(
  tx: Tx,
  userId: string,
  orderId: string,
  reason: string,
) {
  const order = (
    await tx.query(
      "SELECT * FROM recharge_orders WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [orderId, userId],
    )
  ).rows[0];
  if (!order) throw new ApiError("NOT_FOUND", "订单不存在。", 404);
  const existing = (
    await tx.query(
      "SELECT * FROM refunds WHERE order_id=$1 AND status IN('funds_frozen','provider_pending','refunded')",
      [orderId],
    )
  ).rows[0];
  if (existing) return refundView(existing);
  if (order.status !== "credited")
    throw new ApiError(
      "REFUND_INELIGIBLE",
      "仅到账且未消费的充值可申请整单退款。",
      409,
    );
  await wallet(tx, userId, true);
  const lots = (
    await tx.query(
      "SELECT * FROM credit_lots WHERE user_id=$1 AND source_id=$2 ORDER BY id FOR UPDATE",
      [userId, orderId],
    )
  ).rows;
  if (!lots.length || lots.some((l) => l.original_units !== l.available_units))
    throw new ApiError(
      "REFUND_INELIGIBLE",
      "本次充值的积分已消费、预留或冻结。",
      409,
    );
  const total = BigInt(order.paid_units) + BigInt(order.bonus_units),
    refundId = randomUUID();
  await tx.query(
    "UPDATE credit_lots SET frozen_units=available_units,available_units=0 WHERE user_id=$1 AND source_id=$2",
    [userId, orderId],
  );
  await ledger(
    tx,
    userId,
    "refund-freeze:" + refundId,
    "refund_freeze",
    refundId,
    -total,
    0n,
    total,
    0n,
  );
  const refund = (
    await tx.query(
      "INSERT INTO refunds(id,order_id,user_id,amount_fen,units,status,reason) VALUES($1,$2,$3,$4,$5,'funds_frozen',$6) RETURNING *",
      [refundId, orderId, userId, order.amount_fen, String(total), reason],
    )
  ).rows[0];
  await outbox(tx, "refund.requested", refundId);
  await audit(tx, userId, "refund.request", refundId);
  return refundView(refund);
}
export function refundView(row: Record<string, any>) {
  return {
    id: row.id,
    refundId: row.id,
    orderId: row.order_id,
    amountFen: row.amount_fen,
    unitsToRevoke: row.units,
    status: row.status,
    createdAt: iso(row.created_at),
  };
}
export async function completeRefund(
  tx: Tx,
  refundId: string,
  providerRefundId: string,
  orderId: string,
) {
  const refund = (
    await tx.query("SELECT * FROM refunds WHERE id=$1 FOR UPDATE", [refundId])
  ).rows[0];
  if (!refund || refund.order_id !== orderId || !providerRefundId)
    throw new ApiError("REFUND_MISMATCH", "退款单不匹配。", 409);
  if (refund.status === "refunded") return refundView(refund);
  if (!["provider_pending", "funds_frozen"].includes(refund.status))
    throw new ApiError("REFUND_STATE_INVALID", "退款状态不允许入账。", 409);
  await wallet(tx, refund.user_id, true);
  await tx.query(
    "UPDATE credit_lots SET revoked_units=revoked_units+frozen_units,frozen_units=0 WHERE user_id=$1 AND source_id=$2",
    [refund.user_id, refund.order_id],
  );
  await ledger(
    tx,
    refund.user_id,
    "refund:" + refundId,
    "refund",
    refundId,
    0n,
    0n,
    -BigInt(refund.units),
    BigInt(refund.units),
  );
  const updated = (
    await tx.query(
      "UPDATE refunds SET status='refunded',provider_refund_id=$2 WHERE id=$1 RETURNING *",
      [refundId, providerRefundId],
    )
  ).rows[0];
  await tx.query("UPDATE recharge_orders SET status='refunded' WHERE id=$1", [
    refund.order_id,
  ]);
  await audit(tx, "payment", "refund.completed", refundId);
  return refundView(updated);
}
export async function releaseRefund(tx: Tx, refundId: string, reason: string) {
  const refund = (
    await tx.query("SELECT * FROM refunds WHERE id=$1 FOR UPDATE", [refundId])
  ).rows[0];
  if (!refund) throw new ApiError("NOT_FOUND", "退款不存在。", 404);
  if (refund.status === "released") return refundView(refund);
  if (refund.status === "refunded")
    throw new ApiError("REFUND_STATE_INVALID", "已完成的退款不能释放。", 409);
  await wallet(tx, refund.user_id, true);
  await tx.query(
    "UPDATE credit_lots SET available_units=available_units+frozen_units,frozen_units=0 WHERE user_id=$1 AND source_id=$2",
    [refund.user_id, refund.order_id],
  );
  await ledger(
    tx,
    refund.user_id,
    "refund-release:" + refundId,
    "refund_release",
    refundId,
    BigInt(refund.units),
    0n,
    -BigInt(refund.units),
    0n,
  );
  const updated = (
    await tx.query(
      "UPDATE refunds SET status='released' WHERE id=$1 RETURNING *",
      [refundId],
    )
  ).rows[0];
  await tx.query(
    "UPDATE recharge_orders SET status='credited' WHERE id=$1 AND status='refund_pending'",
    [refund.order_id],
  );
  await audit(tx, "payment", "refund.released", refundId, { reason });
  return refundView(updated);
}
export async function reconcilePayments(
  pool: pg.Pool,
  config: PlatformConfig,
  pay: WechatPay,
) {
  if (!pay.enabled()) return;
  const orders = (
    await pool.query(
      "SELECT id FROM recharge_orders WHERE provider='wechat' AND status IN('created','payment_pending','expired') AND created_at>now()-interval '7 days' ORDER BY created_at LIMIT 50",
    )
  ).rows;
  for (const order of orders) {
    try {
      const result = await pay.query(order.id);
      if (result)
        await transaction(pool, (tx) =>
          acceptPayment(tx, config, "wechat", result),
        );
    } catch {
      await transaction(pool, (tx) =>
        audit(tx, "reconciler", "payment.query-pending", order.id),
      );
    }
  }
  const refunds = (
    await pool.query(
      "SELECT r.*,o.provider FROM refunds r JOIN recharge_orders o ON o.id=r.order_id WHERE o.provider='wechat' AND r.status IN('funds_frozen','provider_pending') LIMIT 50",
    )
  ).rows;
  for (const refund of refunds) {
    try {
      const claim = await pool.query(
        "UPDATE refunds SET status='provider_pending' WHERE id=$1 AND status='funds_frozen' RETURNING *",
        [refund.id],
      );
      let result;
      if (claim.rowCount) {
        const order = (
          await pool.query("SELECT * FROM recharge_orders WHERE id=$1", [
            refund.order_id,
          ])
        ).rows[0];
        result = await pay.refund(refund, order);
      } else result = await pay.queryRefund(refund.id);
      if (
        result.out_refund_no !== refund.id ||
        result.out_trade_no !== refund.order_id ||
        String(result.amount?.refund) !== refund.amount_fen ||
        result.amount?.currency !== "CNY"
      )
        throw new ApiError(
          "REFUND_MISMATCH",
          "退款查询结果与原单不匹配。",
          409,
        );
      if (result.status === "SUCCESS")
        await transaction(pool, (tx) =>
          completeRefund(tx, refund.id, result.refund_id, refund.order_id),
        );
      else if (result.status === "CLOSED")
        await transaction(pool, (tx) =>
          releaseRefund(
            tx,
            refund.id,
            "Verified provider query confirmed closed refund",
          ),
        );
    } catch {
      await transaction(pool, (tx) =>
        audit(tx, "reconciler", "refund.query-pending", refund.id),
      );
    }
  }
}
