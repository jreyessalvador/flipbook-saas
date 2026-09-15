-- Compatibilidad: ningún tenant existente queda sin cuota tras activar billing.
BEGIN;
INSERT INTO plans(code,name,currency,unit_amount,billing_interval,max_seats,max_active_publications,max_storage_bytes,is_sellable,is_active)
VALUES ('legacy','Legacy / migrado','MXN',0,'monthly',NULL,NULL,NULL,FALSE,TRUE)
ON CONFLICT(code) DO NOTHING;
INSERT INTO tenant_subscriptions(tenant_id,plan_id,status,currency,unit_amount,billing_interval,tax_included,limits_snapshot,source)
SELECT t.id,p.id,'active','MXN',0,'monthly',FALSE,jsonb_build_object('max_seats',NULL,'max_active_publications',t.max_publications,'max_storage_bytes',t.max_storage_mb::bigint*1024*1024),'migration'
FROM tenants t CROSS JOIN plans p
WHERE p.code='legacy' AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions s WHERE s.tenant_id=t.id AND s.status IN ('trial','active','grace','past_due','suspended'));
COMMIT;
