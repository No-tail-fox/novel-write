import { loadConfig } from "./config.js";
import { poolFor, migrate } from "./db.js";
const pool = poolFor(loadConfig().databaseUrl);
try {
  await migrate(pool);
  process.stdout.write("Platform database migrations applied.\n");
} finally {
  await pool.end();
}
