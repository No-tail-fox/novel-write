import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  randomUUID,
  randomBytes,
  sign,
  createCipheriv,
  createSign,
  type KeyObject,
} from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, type PlatformConfig } from "../src/config.js";
import { poolFor, migrate, transaction, type Tx } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { seedDevelopment } from "../src/fixture.js";
import { hash, digest } from "../src/crypto.js";
import { grant, finalizeJob, reconcileWallets } from "../src/wallet.js";
import {
  acceptPayment,
  WechatPay,
  createRefund,
  completeRefund,
  releaseRefund,
} from "../src/payments.js";
import {
  recoverExpiredLeases,
  runOne,
  claimJob,
} from "../../platform-worker/src/worker.js";
import { adapterRun } from "../../platform-worker/src/adapters.js";

const url = process.env.PLATFORM_TEST_DATABASE_URL;
let config: PlatformConfig,
  pool: ReturnType<typeof poolFor>,
  admin: ReturnType<typeof poolFor>,
  app: ReturnType<typeof buildApp>,
  artifactDir: string,
  dbName: string,
  fixture: Awaited<ReturnType<typeof seedDevelopment>>;
let phoneCounter = 0;
interface Client {
  token: string;
  refreshToken: string;
  userId: string;
  deviceId: string;
  installationId: string;
  keys: { publicKey: KeyObject; privateKey: KeyObject };
  phone: string;
}
function proof(
  client: Pick<Client, "installationId" | "keys">,
  path: string,
  method: string,
  body?: unknown,
  nonce = randomUUID(),
) {
  const raw = body === undefined ? "" : JSON.stringify(body),
    timestamp = String(Date.now()),
    payload = `${method}\n${path}\n${timestamp}\n${nonce}\n${hash(raw)}`;
  return {
    "X-Device-Id": client.installationId,
    "X-Device-Timestamp": timestamp,
    "X-Device-Nonce": nonce,
    "X-Device-Signature": sign(
      null,
      Buffer.from(payload),
      client.keys.privateKey,
    ).toString("base64"),
  };
}
async function req(
  client: Client,
  path: string,
  method = "GET",
  body?: unknown,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: path,
    headers: {
      ...proof(client, path, method, body),
      Authorization: "Bearer " + client.token,
      "Idempotency-Key": key,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function login(
  phone?: string,
  identity?: Pick<Client, "installationId" | "keys">,
): Promise<Client> {
  phone ||= "138003" + String(++phoneCounter).padStart(5, "0");
  const device = identity || {
    installationId: randomUUID(),
    keys: generateKeyPairSync("ed25519"),
  };
  const challenge = await app.inject({
    method: "POST",
    url: "/v1/auth/challenges",
    payload: { phone },
    remoteAddress: "127.0.1." + phoneCounter,
  });
  assert.equal(challenge.statusCode, 200, challenge.body);
  const body = {
    challengeId: challenge.json().challengeId,
    code: config.fixtureOtp,
    device: {
      installationId: device.installationId,
      publicKey: device.keys.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      name: "Test device",
    },
  };
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/verify",
    headers: {
      ...proof(device, "/v1/auth/verify", "POST", body),
      "Content-Type": "application/json",
    },
    payload: JSON.stringify(body),
  });
  assert.equal(response.statusCode, 200, response.body);
  return {
    ...device,
    phone,
    token: response.json().accessToken,
    refreshToken: response.json().refreshToken,
    userId: response.json().userId,
    deviceId: response.json().deviceId,
  };
}
async function entitled(units = 100000n) {
  const client = await login();
  await transaction(pool, async (tx) => {
    const id = randomUUID();
    await tx.query(
      "INSERT INTO entitlements(id,user_id,product_id,product_version,kind,features,device_limit) VALUES($1,$2,'test','1','perpetual','[\"platform\"]',2)",
      [id, client.userId],
    );
    await tx.query(
      "INSERT INTO device_bindings(device_id,entitlement_id) VALUES($1,$2)",
      [client.deviceId, id],
    );
    if (units) await grant(tx, client.userId, randomUUID(), units, 0n, "grant");
  });
  return client;
}
async function quote(
  client: Client,
  params: Record<string, unknown> = { description: "test song" },
) {
  const r = await req(client, "/v1/quotes", "POST", {
    modelId: "platform.music.development",
    operation: "music.generate",
    params,
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function submit(
  client: Client,
  quoteId: string,
  operationId = randomUUID(),
  key = randomUUID(),
) {
  return req(client, "/v1/jobs", "POST", { quoteId, operationId }, key);
}

before(async () => {
  if (!url) return;
  admin = poolFor(url);
  dbName = "storydream_test_" + randomBytes(6).toString("hex");
  await admin.query('CREATE DATABASE "' + dbName + '"');
  const dbUrl = new URL(url);
  dbUrl.pathname = "/" + dbName;
  artifactDir = await mkdtemp(join(tmpdir(), "storydream-platform-test-"));
  const key = generateKeyPairSync("ed25519");
  config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: dbUrl.href,
    PLATFORM_DEV_FIXTURES: "1",
    PLATFORM_HOST: "127.0.0.1",
    PLATFORM_PUBLIC_URL: "http://127.0.0.1:4318",
    PLATFORM_TOKEN_SECRET: randomBytes(32).toString("hex"),
    PLATFORM_PEPPER: randomBytes(32).toString("hex"),
    PLATFORM_LICENSE_PRIVATE_KEY: key.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    PLATFORM_ARTIFACT_DIRECTORY: artifactDir,
  });
  pool = poolFor(config.databaseUrl);
  await migrate(pool);
  fixture = await seedDevelopment(pool, config);
  app = buildApp(config, pool);
  await app.ready();
});
afterEach(async () => {
  if (!pool) return;
  await transaction(pool, async (tx) => {
    for (const job of (
      await tx.query(
        "SELECT id FROM generation_jobs WHERE state='reserved' ORDER BY id FOR UPDATE",
      )
    ).rows)
      await finalizeJob(tx, job.id, 0n, "cancelled_released");
  });
});
after(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (admin) {
    await admin.query('DROP DATABASE "' + dbName + '"');
    await admin.end();
  }
  if (artifactDir) await rm(artifactDir, { recursive: true, force: true });
});
const pgTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !url }, fn);

test("production refuses local fixtures and missing signing secrets", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://localhost/test",
        PLATFORM_DEV_FIXTURES: "1",
      }),
    /loopback/,
  );
  assert.throws(
    () => loadConfig({ DATABASE_URL: "postgres://localhost/test" }),
    /TOKEN_SECRET/,
  );
});
pgTest(
  "login requires a device signature and exposes no balance write authority",
  async () => {
    const client = await login();
    const result = await req(client, "/v1/me/snapshot");
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().wallet.availableUnits, "0");
    assert.equal(result.json().user.id, client.userId);
    assert.equal(result.json().license, null);
    const changed = await req(client, "/v1/me", "PATCH", {
      displayName: "test",
      balance: 999999,
    });
    assert.equal(changed.statusCode, 400);
    const unsigned = await app.inject({
      method: "GET",
      url: "/v1/wallet",
      headers: { Authorization: "Bearer " + client.token },
    });
    assert.equal(unsigned.statusCode, 401);
    const nonce = randomUUID(),
      headers = {
        ...proof(client, "/v1/wallet", "GET", undefined, nonce),
        Authorization: "Bearer " + client.token,
      };
    assert.equal(
      (await app.inject({ method: "GET", url: "/v1/wallet", headers }))
        .statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: "GET", url: "/v1/wallet", headers }))
        .statusCode,
      409,
    );
  },
);
pgTest(
  "failed OTP attempts persist and a consumed challenge cannot login twice",
  async () => {
    const phone = "13800999990",
      device = {
        installationId: randomUUID(),
        keys: generateKeyPairSync("ed25519"),
      };
    const c = await app.inject({
      method: "POST",
      url: "/v1/auth/challenges",
      payload: { phone },
      remoteAddress: "127.9.1.1",
    });
    assert.equal(c.statusCode, 200);
    const body = {
      challengeId: c.json().challengeId,
      code: "000000",
      device: {
        installationId: device.installationId,
        publicKey: device.keys.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
        name: "OTP test",
      },
    };
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/v1/auth/verify",
        headers: {
          ...proof(device, "/v1/auth/verify", "POST", body),
          "Content-Type": "application/json",
        },
        payload: JSON.stringify(body),
      });
      assert.equal(r.statusCode, 401);
    }
    body.code = config.fixtureOtp;
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      headers: {
        ...proof(device, "/v1/auth/verify", "POST", body),
        "Content-Type": "application/json",
      },
      payload: JSON.stringify(body),
    });
    assert.equal(r.statusCode, 401);
    assert.equal(
      (
        await pool.query(
          "SELECT attempt_count FROM auth_challenges WHERE id=$1",
          [body.challengeId],
        )
      ).rows[0].attempt_count,
      5,
    );
  },
);
pgTest(
  "refresh rotates once, retries return same successor, reuse revokes family",
  async () => {
    const client = await login(),
      body = { refreshToken: client.refreshToken },
      key = randomUUID();
    const first = await req(client, "/v1/auth/refresh", "POST", body, key),
      retry = await req(client, "/v1/auth/refresh", "POST", body, key);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(retry.statusCode, 200);
    assert.equal(first.json().refreshToken, retry.json().refreshToken);
    const reuse = await req(client, "/v1/auth/refresh", "POST", body);
    assert.equal(reuse.statusCode, 401);
    client.token = first.json().accessToken;
    assert.equal((await req(client, "/v1/wallet")).statusCode, 401);
  },
);
pgTest(
  "20 concurrent reservations against one job budget admit exactly one",
  async () => {
    const client = await entitled(),
      quotes = await Promise.all(
        Array.from({ length: 20 }, () => quote(client)),
      );
    const results = await Promise.all(quotes.map((q) => submit(client, q.id)));
    assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
    assert.equal(
      results.filter((r) => r.json().error?.code === "INSUFFICIENT_CREDITS")
        .length,
      19,
    );
    const snapshot = (await req(client, "/v1/wallet")).json();
    assert.equal(snapshot.availableUnits, "0");
    assert.equal(snapshot.reservedUnits, "100000");
    assert.deepEqual(await transaction(pool, reconcileWallets), []);
  },
);
pgTest(
  "duplicate submit is one job and one reservation; conflicting idempotency is rejected",
  async () => {
    const client = await entitled(300000n),
      q = await quote(client),
      key = randomUUID(),
      operationId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => submit(client, q.id, operationId, key)),
    );
    assert.ok(
      results.every((r) => r.statusCode === 200),
      results.map((r) => r.body).join("\n"),
    );
    assert.equal(new Set(results.map((r) => r.json().id)).size, 1);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM ledger_transactions WHERE user_id=$1 AND kind='reserve'",
          [client.userId],
        )
      ).rows[0].count,
      1,
    );
    const q2 = await quote(client);
    assert.equal(
      (await submit(client, q2.id, randomUUID(), key)).statusCode,
      409,
    );
  },
);
pgTest(
  "Max mode freezes twice the ordinary price and settles one request for two candidates",
  async () => {
    const client = await entitled(500000n),
      normal = await quote(client),
      max = await quote(client, { description: "test max", maxMode: true });
    assert.equal(normal.reservedUnits, "100000");
    assert.equal(max.reservedUnits, "200000");
    const created = await submit(client, max.id);
    assert.equal(created.statusCode, 200, created.body);
    await runOne(pool, config);
    const job = (await req(client, "/v1/jobs/" + created.json().id)).json();
    assert.equal(job.state, "succeeded_settled");
    assert.equal(job.settledUnits, "200000");
    assert.equal(job.artifacts.length, 2);
    assert.equal(
      (await req(client, "/v1/wallet")).json().availableUnits,
      "300000",
    );
    const bytes = await req(client, "/v1/artifacts/" + job.artifacts[0].id);
    assert.equal(bytes.statusCode, 200);
    assert.equal(bytes.rawPayload.subarray(0, 4).toString(), "RIFF");
  },
);
pgTest(
  "a different account cannot read another job, order or artifact",
  async () => {
    const client = await entitled(),
      other = await login(),
      q = await quote(client),
      created = await submit(client, q.id);
    await runOne(pool, config);
    const job = (await req(client, "/v1/jobs/" + created.json().id)).json();
    assert.equal((await req(other, "/v1/jobs/" + job.id)).statusCode, 404);
    assert.equal(
      (await req(other, "/v1/artifacts/" + job.artifacts[0].id)).statusCode,
      404,
    );
    const order = await req(client, "/v1/recharge/orders", "POST", {
      productId: "development-30",
      version: "1",
    });
    assert.equal(
      (await req(other, "/v1/recharge/orders/" + order.json().id)).statusCode,
      404,
    );
  },
);
pgTest("provider failure releases the full reservation", async () => {
  const client = await entitled(),
    q = await quote(client, { description: "[fixture:fail]" }),
    created = await submit(client, q.id);
  await runOne(pool, config);
  const job = (await req(client, "/v1/jobs/" + created.json().id)).json();
  assert.equal(job.state, "failed_released");
  assert.equal(job.settledUnits, "0");
  assert.equal(
    (await req(client, "/v1/wallet")).json().availableUnits,
    "100000",
  );
});
pgTest(
  "unknown submission is never blindly submitted again after worker recovery",
  async () => {
    const client = await entitled(),
      q = await quote(client, { description: "[fixture:unknown]" }),
      created = await submit(client, q.id);
    let submissions = 0;
    await runOne(pool, config, {
      runAdapter: async (...args) => {
        submissions++;
        return adapterRun(...args);
      },
    });
    await recoverExpiredLeases(pool);
    assert.equal(
      await runOne(pool, config, {
        runAdapter: async (...args) => {
          submissions++;
          return adapterRun(...args);
        },
      }),
      false,
    );
    assert.equal(submissions, 1);
    assert.equal(
      (await req(client, "/v1/jobs/" + created.json().id)).json().state,
      "submission_unknown",
    );
  },
);
pgTest(
  "expired submitting lease becomes unknown, rather than another submission",
  async () => {
    const client = await entitled(),
      q = await quote(client),
      created = await submit(client, q.id);
    await claimJob(pool, randomUUID());
    await pool.query(
      "UPDATE generation_jobs SET lease_until=now()-interval '1 minute' WHERE id=$1",
      [created.json().id],
    );
    await recoverExpiredLeases(pool);
    assert.equal(
      (await req(client, "/v1/jobs/" + created.json().id)).json().state,
      "submission_unknown",
    );
    assert.equal(await runOne(pool, config), false);
  },
);
pgTest(
  "settlement and release race has exactly one terminal ledger transaction",
  async () => {
    const client = await entitled(),
      q = await quote(client),
      created = await submit(client, q.id),
      id = created.json().id;
    const result = await Promise.all([
      transaction(pool, (tx) =>
        finalizeJob(tx, id, 50000n, "succeeded_settled"),
      ),
      transaction(pool, (tx) => finalizeJob(tx, id, 0n, "cancelled_released")),
    ]);
    assert.equal(result[0].state, result[1].state);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM ledger_transactions WHERE business_key=$1",
          ["finalize:" + id],
        )
      ).rows[0].count,
      1,
    );
    assert.deepEqual(await transaction(pool, reconcileWallets), []);
  },
);
pgTest(
  "activation is single use across concurrent accounts and device seats are atomic",
  async () => {
    const clients = await Promise.all([login(), login()]),
      code = "SD-TEST-" + randomBytes(20).toString("hex").toUpperCase();
    await pool.query(
      "INSERT INTO activation_codes(id,digest,suffix,product_id,product_version) VALUES($1,$2,$3,'development-personal','1')",
      [randomUUID(), digest(code, config.pepper), code.slice(-6)],
    );
    const results = await Promise.all(
      clients.map((c) => req(c, "/v1/licenses/redeem", "POST", { code })),
    );
    assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
    const winner = clients[results.findIndex((r) => r.statusCode === 200)];
    const entitlementId = results.find((r) => r.statusCode === 200)!.json().id;
    const now = Date.now();
    await pool.query(
      "UPDATE auth_challenges SET created_at=now()-interval '2 minutes' WHERE target=$1",
      ["+86" + winner.phone],
    );
    const second = await login(winner.phone);
    await pool.query(
      "UPDATE auth_challenges SET created_at=now()-interval '2 minutes' WHERE target=$1",
      ["+86" + winner.phone],
    );
    const third = await login(winner.phone);
    const snapshots = await Promise.all([
      req(second, "/v1/me/snapshot"),
      req(third, "/v1/me/snapshot"),
    ]);
    assert.equal(
      snapshots.filter((r) => r.json().license.status === "active").length,
      1,
    );
    assert.equal(
      snapshots.filter((r) => r.json().license.status === "inactive").length,
      1,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM device_bindings WHERE entitlement_id=$1 AND revoked_at IS NULL",
          [entitlementId],
        )
      ).rows[0].count,
      2,
    );
  },
);
pgTest(
  "catalog returns one latest version for each public model id",
  async () => {
    const row = (
      await pool.query(
        "SELECT * FROM model_entries WHERE id='platform.music.development'",
      )
    ).rows[0];
    await pool.query(
      "INSERT INTO model_entries(id,version,capability,operation,display_name,route_id,parameter_schema,enabled) VALUES($1,'development-2',$2,$3,'新版测试', $4,$5,true)",
      [
        row.id,
        row.capability,
        row.operation,
        row.route_id,
        JSON.stringify(row.parameter_schema),
      ],
    );
    await pool.query(
      "INSERT INTO rate_versions(id,model_id,model_version,unit,units_per_quantity,max_quantity) VALUES($1,$2,'development-2','request',100000,1)",
      [randomUUID(), row.id],
    );
    const result = await app.inject({
      method: "GET",
      url: "/v1/models/catalog",
    });
    const models = result.json().filter((m: any) => m.id === row.id);
    assert.equal(models.length, 1);
    assert.equal(models[0].version, "development-2");
  },
);
pgTest(
  "duplicate valid payment callbacks credit once; mismatches never credit",
  async () => {
    const client = await entitled(0n),
      r = await req(client, "/v1/recharge/orders", "POST", {
        productId: "development-30",
        version: "1",
      }),
      id = r.json().id;
    assert.equal(r.statusCode, 200, r.body);
    const event = {
      eventId: "event-" + id,
      orderId: id,
      tradeId: "trade-" + id,
      merchantId: "development",
      appId: "development",
      amountFen: "3000",
      currency: "CNY",
      state: "SUCCESS" as const,
    };
    await assert.rejects(
      transaction(pool, (tx) =>
        acceptPayment(tx, config, "fixture", { ...event, amountFen: "1" }),
      ),
      /不匹配/,
    );
    assert.equal((await req(client, "/v1/wallet")).json().availableUnits, "0");
    await Promise.all(
      Array.from({ length: 10 }, () =>
        transaction(pool, (tx) => acceptPayment(tx, config, "fixture", event)),
      ),
    );
    assert.equal(
      (await req(client, "/v1/wallet")).json().availableUnits,
      "3000000",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM ledger_transactions WHERE business_key=$1",
          ["recharge:" + id],
        )
      ).rows[0].count,
      1,
    );
  },
);
pgTest(
  "refund freeze excludes the same credits from a concurrent generation reservation",
  async () => {
    const client = await entitled(0n),
      order = (
        await req(client, "/v1/recharge/orders", "POST", {
          productId: "development-30",
          version: "1",
        })
      ).json();
    await transaction(pool, (tx) =>
      acceptPayment(tx, config, "fixture", {
        eventId: "event-" + order.id,
        orderId: order.id,
        tradeId: "trade-" + order.id,
        merchantId: "development",
        appId: "development",
        amountFen: "3000",
        currency: "CNY",
        state: "SUCCESS",
      }),
    );
    const q = await quote(client);
    const results = await Promise.allSettled([
      transaction(pool, (tx) =>
        createRefund(tx, client.userId, order.id, "integration test"),
      ),
      submit(client, q.id),
    ]);
    const refund = results[0],
      submission = results[1];
    assert.equal(submission.status, "fulfilled");
    if (refund.status === "fulfilled") {
      assert.equal(
        submission.status === "fulfilled" && submission.value.statusCode,
        409,
      );
      assert.equal(
        (await req(client, "/v1/wallet")).json().frozenUnits,
        "3000000",
      );
      await transaction(pool, (tx) =>
        completeRefund(tx, refund.value.id, "refund-" + order.id, order.id),
      );
      assert.equal((await req(client, "/v1/wallet")).json().frozenUnits, "0");
    } else
      assert.equal(
        submission.status === "fulfilled" && submission.value.statusCode,
        200,
      );
    assert.deepEqual(await transaction(pool, reconcileWallets), []);
  },
);
pgTest(
  "immutable ledger rejects editing and deferred constraints reject unbalanced postings",
  async () => {
    const client = await entitled();
    const txId = (
      await pool.query("SELECT id FROM ledger_transactions WHERE user_id=$1", [
        client.userId,
      ])
    ).rows[0].id;
    await assert.rejects(
      pool.query("UPDATE ledger_transactions SET kind='forged' WHERE id=$1", [
        txId,
      ]),
      /immutable ledger/,
    );
    await assert.rejects(
      transaction(pool, async (tx) => {
        const id = randomUUID();
        await tx.query(
          "INSERT INTO ledger_transactions(id,user_id,business_key,kind,reference_id) VALUES($1,$2,$3,'test','test')",
          [id, client.userId, randomUUID()],
        );
        await tx.query(
          "INSERT INTO ledger_postings(transaction_id,account,units) VALUES($1,'unbalanced',1)",
          [id],
        );
      }),
      /unbalanced ledger/,
    );
    assert.deepEqual(await transaction(pool, reconcileWallets), []);
  },
);
pgTest(
  "production configuration exposes no test payment or fixture mutation route",
  async () => {
    const production = {
      ...config,
      fixtureMode: false,
      environment: "production" as const,
      publicUrl: "https://platform.example.test",
      otpUrl: undefined,
      otpToken: undefined,
    };
    const prod = buildApp(production, pool);
    try {
      const publicConfig = await prod.inject({ url: "/v1/public/config" });
      assert.equal(publicConfig.json().paymentAvailable, false);
      assert.ok(
        publicConfig.json().catalog.every((m: any) => m.status !== "available"),
      );
      assert.equal(
        (
          await prod.inject({
            method: "POST",
            url: "/v1/auth/challenges",
            payload: { phone: "13800138000" },
          })
        ).statusCode,
        503,
      );
      assert.equal(
        (
          await prod.inject({
            method: "POST",
            url: "/v1/operator/dev/orders/" + randomUUID() + "/pay",
            payload: {},
          })
        ).statusCode,
        404,
      );
    } finally {
      await prod.close();
    }
  },
);

pgTest(
  "operator mutations require role and activation-code retries stay encrypted at rest",
  async () => {
    const ordinary = await login();
    assert.equal(
      (await req(ordinary, "/v1/operator/overview")).statusCode,
      403,
    );
    const operator = await login(fixture.phone),
      key = randomUUID(),
      body = { productId: "development-personal", version: "1", count: 2 };
    const issued = await req(
      operator,
      "/v1/operator/activation-codes",
      "POST",
      body,
      key,
    );
    assert.equal(issued.statusCode, 200, issued.body);
    assert.equal(issued.json().codes.length, 2);
    const replay = await req(
      operator,
      "/v1/operator/activation-codes",
      "POST",
      body,
      key,
    );
    assert.deepEqual(replay.json(), issued.json());
    const stored = (
      await pool.query(
        "SELECT response FROM idempotency_requests WHERE key=$1",
        [key],
      )
    ).rows[0];
    assert.ok(stored.response.ciphertext);
    assert.ok(!JSON.stringify(stored).includes(issued.json().codes[0].code));
    const target = await entitled(123000n);
    await pool.query(
      "UPDATE wallets SET available_units=available_units+1 WHERE user_id=$1",
      [target.userId],
    );
    assert.ok(
      (await transaction(pool, reconcileWallets)).some(
        (row) => row.user_id === target.userId,
      ),
    );
    const repair = await req(
      operator,
      "/v1/operator/wallets/" + target.userId + "/rebuild",
      "POST",
      {
        reason:
          "Verified integration test projection corruption and immutable source ledger",
      },
    );
    assert.equal(repair.statusCode, 200, repair.body);
    assert.equal(repair.json().availableUnits, "123000");
    assert.deepEqual(await transaction(pool, reconcileWallets), []);
    const keys = generateKeyPairSync("ed25519");
    config.updatePublicKeys["release-test"] = keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    config.updateOrigins = ["https://downloads.example.test"];
    const payload = {
      version: "2.0.0",
      platform: "win32",
      arch: "x64",
      channel: "stable",
      publishedAt: new Date().toISOString(),
      releaseNotes: "Signed release test",
      url: "https://downloads.example.test/app.zip",
      sha256: "a".repeat(64),
      size: 1024,
      minAppVersion: "1.0.0",
      keyId: "release-test",
    };
    const { canonical } = await import("../src/crypto.js");
    const manifest = {
      ...payload,
      signature: sign(
        null,
        Buffer.from(canonical(payload)),
        keys.privateKey,
      ).toString("base64"),
    };
    const release = await req(operator, "/v1/operator/releases", "POST", {
      manifest,
      build: "1",
      rollout: 100,
      enabled: true,
    });
    assert.equal(release.statusCode, 200, release.body);
    const check = await app.inject({
      url: "/v1/updates/check?version=1.0.0&platform=win32&arch=x64&channel=stable",
    });
    assert.deepEqual(check.json(), manifest);
    const forged = await req(operator, "/v1/operator/releases", "POST", {
      manifest: {
        ...manifest,
        url: "https://downloads.example.test/changed.zip",
      },
      build: "2",
      rollout: 100,
      enabled: true,
    });
    assert.equal(forged.statusCode, 400);
    assert.equal(
      (
        await req(
          operator,
          "/v1/operator/releases/" + release.json().id + "/rollout",
          "POST",
          { enabled: false, rollout: 0, reason: "Withdraw test release" },
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          url: "/v1/updates/check?version=1.0.0&platform=win32&arch=x64&channel=stable",
        })
      ).json(),
      null,
    );
  },
);
pgTest(
  "a verified closed refund releases frozen credits and permits a fresh refund request",
  async () => {
    const client = await entitled(0n),
      order = (
        await req(client, "/v1/recharge/orders", "POST", {
          productId: "development-30",
          version: "1",
        })
      ).json();
    await transaction(pool, (tx) =>
      acceptPayment(tx, config, "fixture", {
        eventId: "paid-" + order.id,
        orderId: order.id,
        tradeId: "trade-" + order.id,
        merchantId: "development",
        appId: "development",
        amountFen: "3000",
        currency: "CNY",
        state: "SUCCESS",
      }),
    );
    const first = await transaction(pool, (tx) =>
      createRefund(tx, client.userId, order.id, "first refund attempt"),
    );
    assert.equal(first.status, "funds_frozen");
    await transaction(pool, (tx) =>
      releaseRefund(tx, first.id, "Verified refund closed"),
    );
    assert.equal(
      (await req(client, "/v1/wallet")).json().availableUnits,
      "3000000",
    );
    const second = await transaction(pool, (tx) =>
      createRefund(
        tx,
        client.userId,
        order.id,
        "new refund attempt after closed",
      ),
    );
    assert.notEqual(first.id, second.id);
    assert.equal(second.status, "funds_frozen");
    await transaction(pool, (tx) =>
      completeRefund(tx, second.id, "refund-" + second.id, order.id),
    );
    assert.equal((await req(client, "/v1/wallet")).json().availableUnits, "0");
    assert.equal((await req(client, "/v1/wallet")).json().frozenUnits, "0");
  },
);

test("WeChat callback verifies signature, timestamp, AES-GCM and rejects tampering", () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    apiKey = randomBytes(32).toString("hex").slice(0, 32),
    merchantId = "merchant-test",
    appId = "app-test",
    certificate = pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
  const paymentConfig = {
    payment: {
      merchantId,
      appId,
      apiKey,
      platformCertificates: { SERIAL: certificate },
    },
  } as unknown as PlatformConfig;
  const pay = new WechatPay(paymentConfig);
  const payload = {
      mchid: merchantId,
      appid: appId,
      out_trade_no: randomUUID(),
      transaction_id: "trade123",
      trade_state: "SUCCESS",
      amount: { total: 3000, currency: "CNY" },
    },
    nonce = "123456789012",
    aad = "transaction",
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(apiKey),
      Buffer.from(nonce),
    );
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const raw = JSON.stringify({
      id: "event123",
      event_type: "TRANSACTION.SUCCESS",
      resource: {
        algorithm: "AEAD_AES_256_GCM",
        nonce,
        associated_data: aad,
        ciphertext: encrypted.toString("base64"),
      },
    }),
    timestamp = String(Math.floor(Date.now() / 1000)),
    headerNonce = "nonce-test";
  const signer = createSign("RSA-SHA256");
  signer.update(`${timestamp}\n${headerNonce}\n${raw}\n`);
  const headers = {
    "wechatpay-timestamp": timestamp,
    "wechatpay-nonce": headerNonce,
    "wechatpay-serial": "SERIAL",
    "wechatpay-signature": signer.sign(pair.privateKey, "base64"),
  };
  const result = pay.webhook(headers, raw);
  assert.ok("amountFen" in result);
  if ("amountFen" in result) assert.equal(result.amountFen, "3000");
  assert.throws(() => pay.webhook(headers, raw + " "), /签名/);
  assert.throws(
    () => pay.webhook({ ...headers, "wechatpay-serial": "UNKNOWN" }, raw),
    /签名/,
  );
  assert.throws(
    () => pay.webhook({ ...headers, "wechatpay-timestamp": "1" }, raw),
    /签名/,
  );
});
