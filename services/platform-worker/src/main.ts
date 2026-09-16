import { setTimeout } from "node:timers/promises";
import { loadConfig } from "../../platform-api/src/config.js";
import { poolFor, migrate } from "../../platform-api/src/db.js";
import { runOne, runMaintenance } from "./worker.js";
const config = loadConfig(),
  pool = poolFor(config.databaseUrl);
if (config.environment !== "production") await migrate(pool);
let stopping = false,
  maintenanceAt = 0;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });
process.stdout.write("StoryDream platform worker running.\n");
while (!stopping) {
  try {
    if (Date.now() > maintenanceAt) {
      await runMaintenance(pool, config);
      maintenanceAt = Date.now() + 60000;
    }
    if (!(await runOne(pool, config))) await setTimeout(1000);
  } catch {
    process.stderr.write(
      "Worker cycle failed; persisted jobs retained for recovery.\n",
    );
    await setTimeout(3000);
  }
}
await pool.end();
