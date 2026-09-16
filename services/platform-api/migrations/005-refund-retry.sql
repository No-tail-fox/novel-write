ALTER TABLE refunds DROP CONSTRAINT refunds_order_id_key;
CREATE UNIQUE INDEX one_active_refund_per_order ON refunds(order_id) WHERE status IN('funds_frozen','provider_pending','refunded');
INSERT INTO schema_migrations(version) VALUES('005-refund-retry');
