import { randomUUID } from "node:crypto";
import { ApiError, type Tx, iso, outbox } from "./db.js";

export async function wallet(tx: Tx, userId: string, lock = false) {
  const row = (
    await tx.query(
      "SELECT * FROM wallets WHERE user_id=$1" + (lock ? " FOR UPDATE" : ""),
      [userId],
    )
  ).rows[0];
  if (!row) throw new ApiError("WALLET_MISSING", "积分钱包尚未建立。", 409);
  return row;
}
export function walletView(row: Record<string, any>) {
  return {
    userId: row.user_id,
    availableUnits: row.available_units,
    reservedUnits: row.reserved_units,
    frozenUnits: row.frozen_units,
    revision: row.revision,
    serverTime: new Date().toISOString(),
  };
}
export async function ledger(
  tx: Tx,
  userId: string,
  key: string,
  kind: string,
  reference: string,
  available: bigint,
  reserved: bigint,
  frozen: bigint,
  system: bigint,
) {
  return (
    await tx.query("SELECT post_ledger($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id", [
      randomUUID(),
      userId,
      key,
      kind,
      reference,
      String(available),
      String(reserved),
      String(frozen),
      String(system),
    ])
  ).rows[0].id as string;
}
export async function grant(
  tx: Tx,
  userId: string,
  sourceId: string,
  paid: bigint,
  bonus: bigint,
  kind: "recharge" | "grant" = "recharge",
) {
  await wallet(tx, userId, true);
  const total = paid + bonus;
  if (total <= 0n) throw new ApiError("INVALID_AMOUNT", "积分必须大于零。");
  if (
    (
      await tx.query(
        "SELECT id FROM ledger_transactions WHERE business_key=$1",
        [`${kind}:${sourceId}`],
      )
    ).rowCount
  )
    return;
  await ledger(
    tx,
    userId,
    `${kind}:${sourceId}`,
    kind,
    sourceId,
    total,
    0n,
    0n,
    -total,
  );
  for (const [units, sourceKind] of [
    [paid, kind === "grant" ? "grant" : "paid"],
    [bonus, "bonus"],
  ] as const) {
    if (units > 0n)
      await tx.query(
        "INSERT INTO credit_lots(id,user_id,source_id,source_kind,original_units,available_units) VALUES($1,$2,$3,$4,$5,$5)",
        [randomUUID(), userId, sourceId, sourceKind, String(units)],
      );
  }
  await outbox(tx, "wallet.changed", userId);
}
export async function reserve(
  tx: Tx,
  userId: string,
  jobId: string,
  units: bigint,
) {
  const row = await wallet(tx, userId, true);
  if (BigInt(row.available_units) < units)
    throw new ApiError(
      "INSUFFICIENT_CREDITS",
      "可用积分不足，请充值后重新确认任务。",
      409,
    );
  let remaining = units;
  const lots = (
    await tx.query(
      "SELECT * FROM credit_lots WHERE user_id=$1 AND available_units>0 ORDER BY created_at,id FOR UPDATE",
      [userId],
    )
  ).rows;
  for (const lot of lots) {
    if (!remaining) break;
    const take =
      BigInt(lot.available_units) < remaining
        ? BigInt(lot.available_units)
        : remaining;
    await tx.query(
      "UPDATE credit_lots SET available_units=available_units-$2,reserved_units=reserved_units+$2 WHERE id=$1",
      [lot.id, String(take)],
    );
    await tx.query(
      "INSERT INTO lot_allocations(job_id,lot_id,reserved_units) VALUES($1,$2,$3)",
      [jobId, lot.id, String(take)],
    );
    remaining -= take;
  }
  if (remaining)
    throw new ApiError(
      "WALLET_RECONCILIATION_REQUIRED",
      "积分来源需要核对，请联系支持。",
      409,
    );
  await ledger(
    tx,
    userId,
    "reserve:" + jobId,
    "reserve",
    jobId,
    -units,
    units,
    0n,
    0n,
  );
  await outbox(tx, "wallet.changed", userId);
}
export const terminalStates = [
  "succeeded_settled",
  "failed_released",
  "cancelled_released",
];
export async function finalizeJob(
  tx: Tx,
  jobId: string,
  settled: bigint,
  state: "succeeded_settled" | "failed_released" | "cancelled_released",
  failureCode?: string,
) {
  const job = (
    await tx.query("SELECT * FROM generation_jobs WHERE id=$1 FOR UPDATE", [
      jobId,
    ])
  ).rows[0];
  if (!job) throw new ApiError("NOT_FOUND", "任务不存在。", 404);
  if (terminalStates.includes(job.state)) return job;
  const held = BigInt(job.reserved_units);
  if (
    settled < 0n ||
    settled > held ||
    (state !== "succeeded_settled" && settled !== 0n)
  )
    throw new ApiError("SETTLEMENT_INVALID", "结算超出报价。", 409);
  await wallet(tx, job.user_id, true);
  let remaining = settled;
  const allocations = (
    await tx.query(
      "SELECT a.*,l.created_at FROM lot_allocations a JOIN credit_lots l ON l.id=a.lot_id WHERE job_id=$1 ORDER BY l.created_at,l.id FOR UPDATE OF a,l",
      [jobId],
    )
  ).rows;
  for (const allocation of allocations) {
    const reserved = BigInt(allocation.reserved_units),
      consume = reserved < remaining ? reserved : remaining,
      release = reserved - consume;
    await tx.query(
      "UPDATE credit_lots SET reserved_units=reserved_units-$2,available_units=available_units+$3,consumed_units=consumed_units+$4 WHERE id=$1",
      [allocation.lot_id, String(reserved), String(release), String(consume)],
    );
    await tx.query(
      "UPDATE lot_allocations SET consumed_units=$3,released_units=$4 WHERE job_id=$1 AND lot_id=$2",
      [jobId, allocation.lot_id, String(consume), String(release)],
    );
    remaining -= consume;
  }
  if (remaining) throw new Error("Allocation deficit");
  await ledger(
    tx,
    job.user_id,
    "finalize:" + jobId,
    settled ? "settle" : "release",
    jobId,
    held - settled,
    -held,
    0n,
    settled,
  );
  const updated = (
    await tx.query(
      "UPDATE generation_jobs SET state=$2,settled_units=$3,released_units=$4,lease_until=NULL,lease_owner=NULL,failure_code=$5,updated_at=now() WHERE id=$1 RETURNING *",
      [
        jobId,
        state,
        String(settled),
        String(held - settled),
        failureCode || null,
      ],
    )
  ).rows[0];
  await outbox(tx, "job.finalized", jobId);
  return updated;
}
export async function transactionHistory(tx: Tx, userId: string) {
  const rows = (
    await tx.query(
      "SELECT t.*, COALESCE(sum(p.units) FILTER(WHERE p.account='user:'||t.user_id||':available'),0)::text AS available_delta,COALESCE(sum(p.units) FILTER(WHERE p.account='user:'||t.user_id||':reserved'),0)::text AS reserved_delta,COALESCE(sum(p.units) FILTER(WHERE p.account='user:'||t.user_id||':frozen'),0)::text AS frozen_delta FROM ledger_transactions t JOIN ledger_postings p ON p.transaction_id=t.id WHERE t.user_id=$1 GROUP BY t.id ORDER BY t.created_at DESC,t.id LIMIT 100",
      [userId],
    )
  ).rows;
  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      referenceId: r.reference_id,
      availableDelta: r.available_delta,
      reservedDelta: r.reserved_delta,
      frozenDelta: r.frozen_delta,
      createdAt: iso(r.created_at),
    })),
  };
}
export async function reconcileWallets(tx: Tx) {
  const rows = (
    await tx.query(
      "SELECT w.user_id,w.available_units::text,w.reserved_units::text,w.frozen_units::text, COALESCE(sum(p.units) FILTER(WHERE p.account='user:'||w.user_id||':available'),0)::text AS ledger_available, COALESCE(sum(p.units) FILTER(WHERE p.account='user:'||w.user_id||':reserved'),0)::text AS ledger_reserved, COALESCE(sum(p.units) FILTER(WHERE p.account='user:'||w.user_id||':frozen'),0)::text AS ledger_frozen FROM wallets w LEFT JOIN ledger_transactions t ON t.user_id=w.user_id LEFT JOIN ledger_postings p ON p.transaction_id=t.id GROUP BY w.user_id",
    )
  ).rows;
  return rows.filter(
    (r) =>
      r.available_units !== r.ledger_available ||
      r.reserved_units !== r.ledger_reserved ||
      r.frozen_units !== r.ledger_frozen,
  );
}
