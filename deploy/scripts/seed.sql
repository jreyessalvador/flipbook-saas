-- seed.sql -- Datos iniciales Flipbook SaaS
-- Origen: K3s EC2 t3.small, exportado 2026-05-29
-- Uso: psql -U flipbook -d flipbook < deploy/scripts/seed.sql

INSERT INTO public.tenants
  (id,name,subdomain,schema_name,plan,status,max_publications,max_storage_mb,created_at)
VALUES (
  'e0d426a6-e676-4c7d-8c8c-20f43f31fb93',
  'Default Organization','default','tenant_default',
  'pro','active',50,10240,'2026-02-11 20:59:32+00'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users
  (id,email,password_hash,full_name,role,is_active,tenant_id,created_at)
VALUES
  ('0490d2a8-81c0-43a7-a219-cdf171883336',
   'admin@flipbook.local',
   '$2b$12$KMXDpsjApBjDptCaM10hy.aZa6CLyMvDQD6z5bZdVbW2IaR7VWXpe',
   'Administrator','admin',true,
   'e0d426a6-e676-4c7d-8c8c-20f43f31fb93','2026-02-12 07:49:15+00'),
  ('b5c149cd-0514-40c3-95f0-3474e840e245',
   'admin@flipbook.app',
   '$2b$12$8ptCK7LSZvxe28nZfyqEdesqEmytlqHZdlldGJ0yc70iF8orKjhiG',
   'Administrator','admin',true,
   'e0d426a6-e676-4c7d-8c8c-20f43f31fb93','2026-02-12 12:09:25+00')
ON CONFLICT (id) DO NOTHING;
