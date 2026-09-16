CREATE FUNCTION rebuild_wallet_projection(p_user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a bigint;r bigint;f bigint;la bigint;lr bigint;lf bigint;
BEGIN
  PERFORM 1 FROM wallets WHERE user_id=p_user FOR UPDATE;
  SELECT COALESCE(sum(p.units) FILTER(WHERE p.account='user:'||p_user||':available'),0),COALESCE(sum(p.units) FILTER(WHERE p.account='user:'||p_user||':reserved'),0),COALESCE(sum(p.units) FILTER(WHERE p.account='user:'||p_user||':frozen'),0)
    INTO a,r,f FROM ledger_transactions t JOIN ledger_postings p ON p.transaction_id=t.id WHERE t.user_id=p_user;
  SELECT COALESCE(sum(available_units),0),COALESCE(sum(reserved_units),0),COALESCE(sum(frozen_units),0) INTO la,lr,lf FROM credit_lots WHERE user_id=p_user;
  IF a<0 OR r<0 OR f<0 OR a<>la OR r<>lr OR f<>lf THEN RAISE EXCEPTION 'ledger and source lots require manual reconciliation'; END IF;
  UPDATE wallets SET available_units=a,reserved_units=r,frozen_units=f,revision=revision+1 WHERE user_id=p_user;
END $$;
REVOKE ALL ON FUNCTION rebuild_wallet_projection(uuid) FROM PUBLIC;
INSERT INTO schema_migrations(version) VALUES('004-reconciliation');
