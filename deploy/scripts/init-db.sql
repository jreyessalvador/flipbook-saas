-- init-db.sql Flipbook SaaS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE SCHEMA IF NOT EXISTS audit;
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DO $$ BEGIN RAISE NOTICE "Flipbook SaaS DB inicializada"; END $$;
