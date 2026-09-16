import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { canonical, hash } from "./crypto.js";
export type Tx = pg.PoolClient;
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryable = false,
  ) {
    super(message);
  }
}
export function poolFor(databaseUrl: string) {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 20,
    statement_timeout: 20000,
  });
}
export async function transaction<T>(
  pool: pg.Pool,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
export async function migrate(pool: pg.Pool) {
  const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
  await transaction(pool, async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtext('storydream-platform-migrations'))",
    );
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir(dir))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        (
          await tx.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
            name.slice(0, -4),
          ])
        ).rowCount
      )
        continue;
      await tx.query(
        await readFile(
          new URL("../migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
    }
  });
}
export async function idempotent<T>(
  tx: Tx,
  scope: string,
  key: string,
  body: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  if (!key || key.length < 8 || key.length > 180)
    throw new ApiError("IDEMPOTENCY_REQUIRED", "请使用稳定的幂等请求标识。");
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    scope + ":" + key,
  ]);
  const requestHash = hash(canonical(body));
  const row = (
    await tx.query(
      "SELECT request_hash,response FROM idempotency_requests WHERE scope=$1 AND key=$2",
      [scope, key],
    )
  ).rows[0];
  if (row) {
    if (row.request_hash !== requestHash)
      throw new ApiError(
        "IDEMPOTENCY_CONFLICT",
        "同一请求标识的内容已改变。",
        409,
      );
    return row.response as T;
  }
  const result = await fn();
  await tx.query(
    "INSERT INTO idempotency_requests(scope,key,request_hash,response) VALUES($1,$2,$3,$4)",
    [scope, key, requestHash, JSON.stringify(result)],
  );
  return result;
}
export async function audit(
  tx: Tx,
  actor: string,
  action: string,
  reference: string,
  details: object = {},
) {
  await tx.query(
    "INSERT INTO audit_events(id,actor,action,reference_id,details) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), actor, action, reference, JSON.stringify(details)],
  );
}
export async function outbox(
  tx: Tx,
  kind: string,
  reference: string,
  payload: object = {},
) {
  await tx.query(
    "INSERT INTO outbox_events(id,kind,reference_id,payload) VALUES($1,$2,$3,$4)",
    [randomUUID(), kind, reference, JSON.stringify(payload)],
  );
}
export const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : undefined;
