CREATE TABLE usage_records(job_id uuid PRIMARY KEY REFERENCES generation_jobs,user_id uuid NOT NULL REFERENCES users,quantity bigint NOT NULL CHECK(quantity>0),unit text NOT NULL,measured_units bigint NOT NULL CHECK(measured_units>=0),settled_units bigint NOT NULL CHECK(settled_units>=0),created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER immutable_usage BEFORE UPDATE OR DELETE ON usage_records FOR EACH ROW EXECUTE FUNCTION deny_ledger_mutation();
INSERT INTO schema_migrations(version) VALUES('003-usage');
