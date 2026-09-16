import { randomUUID } from "node:crypto";
import type { PlatformConfig } from "../../platform-api/src/config.js";
import { poolFor, transaction, audit } from "../../platform-api/src/db.js";
import { finalizeJob, terminalStates } from "../../platform-api/src/wallet.js";
import {
  putObject,
  getObject,
  downloadMedia,
  validMedia,
} from "../../platform-api/src/artifacts.js";
import {
  WechatPay,
  reconcilePayments,
} from "../../platform-api/src/payments.js";
import {
  adapterRun,
  SubmissionError,
  type WorkJob,
  type AdapterResult,
  type Output,
} from "./adapters.js";
type Pool = ReturnType<typeof poolFor>;

export async function recoverExpiredLeases(pool: Pool) {
  await transaction(pool, async (tx) => {
    const rows = (
      await tx.query(
        "UPDATE generation_jobs SET state='submission_unknown',failure_code='SUBMISSION_UNKNOWN',lease_until=NULL,lease_owner=NULL,updated_at=now() WHERE state='submitting' AND lease_until<now() RETURNING id",
      )
    ).rows;
    for (const row of rows)
      await audit(tx, "worker", "job.submission-unknown", row.id);
    await tx.query(
      "UPDATE generation_jobs SET lease_until=NULL,lease_owner=NULL WHERE state IN('running','awaiting_delivery') AND lease_until<now()",
    );
    await tx.query(
      "DELETE FROM request_nonces WHERE created_at<now()-interval '10 minutes'",
    );
  });
}
export async function claimJob(pool: Pool, workerId: string) {
  return transaction(pool, async (tx) => {
    const job = (
      await tx.query(
        "SELECT * FROM generation_jobs WHERE state IN('reserved','running','awaiting_delivery') AND (lease_until IS NULL OR lease_until<now()) AND next_poll_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!job) return undefined;
    const quote = (
      await tx.query("SELECT * FROM quotes WHERE id=$1", [job.quote_id])
    ).rows[0];
    if (job.state === "reserved") {
      const route = (
        await tx.query("SELECT enabled FROM provider_routes WHERE id=$1", [
          quote.route_snapshot.id,
        ])
      ).rows[0];
      if (!route?.enabled) {
        await finalizeJob(
          tx,
          job.id,
          0n,
          "failed_released",
          "MODEL_UNAVAILABLE",
        );
        return undefined;
      }
    }
    await tx.query(
      "UPDATE generation_jobs SET state=CASE WHEN state='reserved' THEN 'submitting' ELSE state END,lease_owner=$2,lease_until=now()+interval '5 minutes',attempt_started_at=COALESCE(attempt_started_at,now()),updated_at=now() WHERE id=$1",
      [job.id, workerId],
    );
    await tx.query(
      "UPDATE outbox_events SET processed_at=now() WHERE kind='job.reserved' AND reference_id=$1 AND processed_at IS NULL",
      [job.id],
    );
    return {
      ...job,
      ...quote,
      id: job.id,
      user_id: job.user_id,
      state: job.state,
      upstream_id: job.upstream_id,
      submission_key: job.submission_key,
      result: job.result,
    } as WorkJob & {
      state: string;
      result: any;
      reserved_units: string;
      quantity: string;
    };
  });
}
async function durableResult(
  config: PlatformConfig,
  job: WorkJob,
  result: AdapterResult,
) {
  const outputs: Output[] = [];
  for (let index = 0; index < (result.outputs || []).length; index++) {
    const output = result.outputs![index];
    if (output.bytes) {
      if (!validMedia(output.bytes, output.mime))
        throw new Error("Invalid delivered content");
      const key = job.user_id + "/" + job.id + "." + index,
        metadata = await putObject(config, key, output.bytes);
      outputs.push({
        name: output.name,
        mime: output.mime,
        objectKey: key,
        ...metadata,
      });
    } else outputs.push(output);
  }
  return { ...result, outputs };
}
async function deliver(
  pool: Pool,
  config: PlatformConfig,
  job: WorkJob,
  result: AdapterResult,
  workerId: string,
) {
  const outputs: Output[] = [];
  for (let index = 0; index < (result.outputs || []).length; index++) {
    const output = result.outputs![index];
    if (output.objectKey) {
      const bytes = await getObject(config, output.objectKey);
      if (!validMedia(bytes, output.mime))
        throw new Error("Stored artifact invalid");
      outputs.push(output);
      continue;
    }
    if (!output.url) throw new Error("No delivery source");
    const bytes = await downloadMedia(config, output.url, output.mime),
      key = job.user_id + "/" + job.id + "." + index,
      metadata = await putObject(config, key, bytes);
    outputs.push({
      name: output.name,
      mime: output.mime,
      objectKey: key,
      ...metadata,
    });
  }
  const minimum = job.route_snapshot.minimumSuccess || 1;
  if (outputs.length < minimum) throw new Error("Delivery threshold not met");
  await transaction(pool, async (tx) => {
    const current = (
      await tx.query("SELECT * FROM generation_jobs WHERE id=$1 FOR UPDATE", [
        job.id,
      ])
    ).rows[0];
    if (
      terminalStates.includes(current.state) ||
      current.lease_owner !== workerId
    )
      return;
    for (const output of outputs)
      await tx.query(
        "INSERT INTO artifacts(id,user_id,job_id,object_key,sha256,size,mime,label) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(job_id,object_key) DO NOTHING",
        [
          randomUUID(),
          job.user_id,
          job.id,
          output.objectKey,
          output.sha256,
          output.size,
          output.mime,
          output.name.slice(0, 200),
        ],
      );
    const unit = job.route_snapshot.unit,
      quantity =
        unit === "request"
          ? 1n
          : unit === "image"
            ? BigInt(outputs.length)
            : BigInt(result.quantity || 0),
      charge = quantity * BigInt(job.route_snapshot.unitsPerQuantity);
    if (quantity <= 0n) throw new Error("Invalid measured quantity");
    // A provider overrun is absorbed by the platform; the confirmed quote is the absolute user cap.
    const capped =
      charge > BigInt(current.reserved_units)
        ? BigInt(current.reserved_units)
        : charge;
    if (capped !== charge)
      await audit(tx, "worker", "usage.quote-cap", job.id, {
        measured: String(charge),
        charged: String(capped),
      });
    await tx.query(
      "INSERT INTO usage_records(job_id,user_id,quantity,unit,measured_units,settled_units) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(job_id) DO NOTHING",
      [
        job.id,
        job.user_id,
        String(quantity),
        unit,
        String(charge),
        String(capped),
      ],
    );
    await finalizeJob(tx, job.id, capped, "succeeded_settled");
  });
}
export async function runOne(
  pool: Pool,
  config: PlatformConfig,
  options: { workerId?: string; runAdapter?: typeof adapterRun } = {},
) {
  const workerId = options.workerId || randomUUID(),
    job = await claimJob(pool, workerId);
  if (!job) return false;
  try {
    if (job.state === "awaiting_delivery") {
      await deliver(pool, config, job, job.result, workerId);
      return true;
    }
    const result = await (options.runAdapter || adapterRun)(
      config,
      job,
      async (id) => {
        const asset = (
          await pool.query(
            "SELECT * FROM upload_assets WHERE id=$1 AND user_id=$2 AND verified=true AND expires_at>now()",
            [id, job.user_id],
          )
        ).rows[0];
        if (!asset) throw new SubmissionError(true, "ASSET_INVALID");
        return {
          bytes: await getObject(config, asset.object_key),
          mime: asset.mime,
        };
      },
    );
    if (result.state === "failed") {
      await transaction(pool, (tx) =>
        finalizeJob(tx, job.id, 0n, "failed_released", result.message),
      );
      return true;
    }
    if (result.state === "running") {
      if (!result.upstreamId)
        throw new SubmissionError(false, "SUBMISSION_UNKNOWN");
      await pool.query(
        "UPDATE generation_jobs SET state='running',upstream_id=$2,lease_until=NULL,lease_owner=NULL,next_poll_at=now()+interval '5 seconds',updated_at=now() WHERE id=$1 AND lease_owner=$3 AND state IN('submitting','running')",
        [job.id, result.upstreamId, workerId],
      );
      return true;
    }
    const durable = await durableResult(config, job, result);
    const updated = await pool.query(
      "UPDATE generation_jobs SET state='awaiting_delivery',result=$2,upstream_id=COALESCE($3,upstream_id),updated_at=now() WHERE id=$1 AND lease_owner=$4 AND state IN('submitting','running') RETURNING id",
      [job.id, JSON.stringify(durable), result.upstreamId || null, workerId],
    );
    if (updated.rowCount) await deliver(pool, config, job, durable, workerId);
  } catch (error) {
    const current = (
      await pool.query(
        "SELECT state,lease_owner FROM generation_jobs WHERE id=$1",
        [job.id],
      )
    ).rows[0];
    if (
      current?.lease_owner !== workerId ||
      terminalStates.includes(current.state)
    )
      return true;
    if (current.state === "submitting") {
      if (error instanceof SubmissionError && error.definitive)
        await transaction(pool, (tx) =>
          finalizeJob(tx, job.id, 0n, "failed_released", error.message),
        );
      else
        await pool.query(
          "UPDATE generation_jobs SET state='submission_unknown',failure_code='SUBMISSION_UNKNOWN',lease_until=NULL,lease_owner=NULL,updated_at=now() WHERE id=$1 AND lease_owner=$2",
          [job.id, workerId],
        );
    } else
      await pool.query(
        "UPDATE generation_jobs SET failure_code='DELIVERY_OR_QUERY_PENDING',lease_until=NULL,lease_owner=NULL,next_poll_at=now()+interval '30 seconds',updated_at=now() WHERE id=$1 AND lease_owner=$2",
        [job.id, workerId],
      );
    await transaction(pool, (tx) =>
      audit(tx, "worker", "job.recovery-pending", job.id, {
        state: current.state,
      }),
    );
  }
  return true;
}
export async function runMaintenance(pool: Pool, config: PlatformConfig) {
  await recoverExpiredLeases(pool);
  await reconcilePayments(pool, config, new WechatPay(config));
  await pool.query(
    "UPDATE generation_jobs SET state='delivery_review',failure_code='DELIVERY_REVIEW' WHERE state='awaiting_delivery' AND lease_owner IS NULL AND created_at<now()-interval '24 hours'",
  );
}
