import { loadConfig } from "./config.js";
import { poolFor, migrate } from "./db.js";
import { buildApp } from "./app.js";
const config = loadConfig(),
  pool = poolFor(config.databaseUrl);
if (config.environment !== "production") await migrate(pool);
else await pool.query("SELECT 1 FROM wallets LIMIT 0");
const app = buildApp(config, pool);
await app.listen({ host: config.host, port: config.port });
process.stdout.write(
  `StoryDream platform API listening on ${config.host}:${config.port} (${config.environment}${config.fixtureMode ? ", development fixtures enabled" : ""}).\n`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
