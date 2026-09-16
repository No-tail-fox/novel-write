-- Run as the migration owner after creating a separate LOGIN role named storydream_runtime.
-- Keep migration ownership and this account separate. The owner must never be the API login.
GRANT USAGE ON SCHEMA public TO storydream_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO storydream_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO storydream_runtime;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON ledger_transactions,ledger_postings,usage_records FROM storydream_runtime;
REVOKE UPDATE,DELETE,TRUNCATE ON audit_events FROM storydream_runtime;
REVOKE UPDATE,DELETE,TRUNCATE ON wallets FROM storydream_runtime;
REVOKE ALL ON schema_migrations FROM storydream_runtime;
GRANT EXECUTE ON FUNCTION post_ledger(uuid,uuid,text,text,text,bigint,bigint,bigint,bigint) TO storydream_runtime;
GRANT EXECUTE ON FUNCTION rebuild_wallet_projection(uuid) TO storydream_runtime;
-- usage records are append-only and have their own immutable trigger.
GRANT INSERT ON usage_records TO storydream_runtime;
