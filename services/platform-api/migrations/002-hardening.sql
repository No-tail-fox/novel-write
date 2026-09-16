CREATE TABLE IF NOT EXISTS request_nonces(device_id text NOT NULL,nonce text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(device_id,nonce));
CREATE TABLE IF NOT EXISTS upload_assets(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users,object_key text NOT NULL,size bigint NOT NULL CHECK(size BETWEEN 1 AND 52428800),mime text NOT NULL,sha256 text NOT NULL,verified boolean NOT NULL DEFAULT false,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE rate_versions ADD COLUMN IF NOT EXISTS multipliers jsonb NOT NULL DEFAULT '{}';
CREATE FUNCTION immutable_published_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'enabled'-'is_default') IS DISTINCT FROM (to_jsonb(OLD)-'enabled'-'is_default') THEN RAISE EXCEPTION 'published version is immutable; publish a new version'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_recharge_products BEFORE UPDATE OR DELETE ON recharge_products FOR EACH ROW EXECUTE FUNCTION immutable_published_version();
CREATE TRIGGER immutable_license_products BEFORE UPDATE OR DELETE ON license_products FOR EACH ROW EXECUTE FUNCTION immutable_published_version();
CREATE TRIGGER immutable_model_entries BEFORE UPDATE OR DELETE ON model_entries FOR EACH ROW EXECUTE FUNCTION immutable_published_version();
CREATE TRIGGER immutable_provider_routes BEFORE UPDATE OR DELETE ON provider_routes FOR EACH ROW EXECUTE FUNCTION immutable_published_version();
CREATE TRIGGER immutable_quotes BEFORE UPDATE OR DELETE ON quotes FOR EACH ROW EXECUTE FUNCTION deny_ledger_mutation();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_ledger_mutation();
INSERT INTO schema_migrations(version) VALUES('002-hardening');
