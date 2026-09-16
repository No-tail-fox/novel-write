import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig, type PlatformConfig } from "./config.js";
import { poolFor, transaction, migrate, audit } from "./db.js";
import { digest } from "./crypto.js";
import { grant } from "./wallet.js";
import { capabilities, parameterSchemas } from "./models.js";

export async function seedDevelopment(
  pool: ReturnType<typeof poolFor>,
  config: PlatformConfig,
  phone = "+8613800138000",
) {
  if (!config.fixtureMode || config.environment === "production")
    throw new Error(
      "Fixtures are only available in an explicitly enabled loopback development environment.",
    );
  if (!/^\+[0-9]{8,15}$/.test(phone))
    throw new Error("Fixture phone must use international format.");
  return transaction(pool, async (tx) => {
    let userId = (
      await tx.query(
        "SELECT user_id FROM identities WHERE kind='phone' AND identifier=$1",
        [phone],
      )
    ).rows[0]?.user_id;
    if (!userId) {
      userId = randomUUID();
      await tx.query(
        "INSERT INTO users(id,display_name) VALUES($1,'开发测试运营账号')",
        [userId],
      );
      await tx.query(
        "INSERT INTO identities(user_id,kind,identifier) VALUES($1,'phone',$2)",
        [userId, phone],
      );
      await tx.query("INSERT INTO wallets(user_id) VALUES($1)", [userId]);
    }
    await tx.query(
      "INSERT INTO operator_users(user_id,role) VALUES($1,'admin') ON CONFLICT(user_id) DO NOTHING",
      [userId],
    );
    await grant(
      tx,
      userId,
      "development-fixture:" + userId,
      1000000n,
      0n,
      "grant",
    );
    await tx.query(
      "INSERT INTO license_products(id,version,name,kind,duration_days,device_limit,features,enabled) VALUES('development-personal','1','开发测试个人授权','subscription',30,2,'[\"platform\",\"local\"]',true) ON CONFLICT DO NOTHING",
    );
    await tx.query(
      "INSERT INTO recharge_products(id,version,name,amount_fen,paid_units,bonus_units,enabled) VALUES('development-30','1','开发测试充值（不收款）',3000,3000000,0,true) ON CONFLICT DO NOTHING",
    );
    const code = "SD-DEV-" + randomBytes(20).toString("hex").toUpperCase();
    await tx.query(
      "INSERT INTO activation_codes(id,digest,suffix,product_id,product_version) VALUES($1,$2,$3,'development-personal','1')",
      [randomUUID(), digest(code, config.pepper), code.slice(-6)],
    );
    for (const capability of capabilities) {
      const modelId = `platform.${capability}.development`,
        version = "development-1";
      if (
        (
          await tx.query(
            "SELECT 1 FROM model_entries WHERE id=$1 AND version=$2",
            [modelId, version],
          )
        ).rowCount
      )
        continue;
      const routeId = randomUUID();
      await tx.query(
        "INSERT INTO provider_routes(id,adapter,origin,credential_ref,upstream_model,enabled) VALUES($1,'fixture','http://127.0.0.1','PLATFORM_DEV_FIXTURE', $2,true)",
        [routeId, capability],
      );
      await tx.query(
        "INSERT INTO model_entries(id,version,capability,operation,display_name,route_id,parameter_schema,enabled,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,true,true)",
        [
          modelId,
          version,
          capability,
          capability + ".generate",
          `${({ text: "文本", image: "图片", video: "视频", music: "音乐", tts: "配音", speechToText: "转写", vision: "视觉" } as const)[capability]} · 本地开发测试`,
          routeId,
          JSON.stringify(parameterSchemas[capability]),
        ],
      );
      await tx.query(
        "INSERT INTO rate_versions(id,model_id,model_version,unit,units_per_quantity,max_quantity) VALUES($1,$2,$3,'request',100000,1)",
        [randomUUID(), modelId, version],
      );
    }
    await audit(tx, "development-fixture", "fixture.seed", userId, {
      phoneMasked: phone.slice(0, 5) + "****" + phone.slice(-4),
    });
    return {
      userId,
      phone,
      activationCode: code,
      developmentCode: config.fixtureOtp,
      creditUnits: "1000000",
    };
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = loadConfig(),
    pool = poolFor(config.databaseUrl);
  try {
    await migrate(pool);
    const result = await seedDevelopment(
      pool,
      config,
      process.env.PLATFORM_DEV_PHONE || "+8613800138000",
    );
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } finally {
    await pool.end();
  }
}
