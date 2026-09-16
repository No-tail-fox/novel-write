import { z } from "zod";
import { loadConfig } from "./config.js";
import { poolFor, transaction, audit } from "./db.js";
const [command, userId, role] = process.argv.slice(2);
if (command !== "grant-role")
  throw new Error(
    "Usage: tsx src/operator-cli.ts grant-role <verified user UUID> <support|finance|admin>",
  );
z.uuid().parse(userId);
z.enum(["support", "finance", "admin"]).parse(role);
const pool = poolFor(loadConfig().databaseUrl);
try {
  await transaction(pool, async (tx) => {
    if (
      !(await tx.query("SELECT 1 FROM identities WHERE user_id=$1", [userId]))
        .rowCount
    )
      throw new Error("User must first complete verified login.");
    await tx.query(
      "INSERT INTO operator_users(user_id,role) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role,enabled=true",
      [userId, role],
    );
    await audit(tx, "operator-cli", "operator.grant-role", userId, { role });
  });
  process.stdout.write("Operator role assigned with audit entry.\n");
} finally {
  await pool.end();
}
