-- Rollback: Volatility Protection Feature
-- Run this to undo the 20260205_002_volatility_protection.sql migration

DROP TABLE IF EXISTS volatility_escalations;
DROP TABLE IF EXISTS group_volatility_config;
-- Note: Don't drop update_updated_at() as other tables may use it
