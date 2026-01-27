-- Migration: Create group_config table for per-group learning system
-- This table stores per-group modes, triggers, roles, and configuration
-- Part of Epic: Group Modes - Story 1

-- Create the group_config table
CREATE TABLE group_config (
  -- Identity
  group_jid TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,

  -- Mode (the learning lifecycle stage)
  mode TEXT NOT NULL DEFAULT 'learning'
    CHECK (mode IN ('learning', 'assisted', 'active', 'paused')),

  -- Custom trigger patterns learned/configured for this group
  -- Example: ["compro usdt", "vendo btc", "cotacao"]
  trigger_patterns JSONB DEFAULT '[]'::jsonb,

  -- Response templates mapped to triggers
  -- Example: {"compro usdt": "USDT/BRL: {price}", "default": "Cotacao: {pair} {price}"}
  response_templates JSONB DEFAULT '{}'::jsonb,

  -- Player role mappings (learned from observation)
  -- Example: {"5511999999999@s.whatsapp.net": "operator", "5521888888888@s.whatsapp.net": "client"}
  player_roles JSONB DEFAULT '{}'::jsonb,

  -- AI usage threshold (0-100)
  -- 0 = never use AI (rules only)
  -- 50 = use AI when rules don't match (default)
  -- 100 = always use AI (expensive but flexible)
  ai_threshold INTEGER NOT NULL DEFAULT 50
    CHECK (ai_threshold >= 0 AND ai_threshold <= 100),

  -- Learning timestamps
  learning_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  activated_at TIMESTAMP WITH TIME ZONE, -- NULL until mode='active'

  -- Audit
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT -- sender JID who last changed config
);

-- Indexes for common queries
CREATE INDEX idx_group_config_mode ON group_config(mode);
CREATE INDEX idx_group_config_updated ON group_config(updated_at);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_group_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER group_config_timestamp
  BEFORE UPDATE ON group_config
  FOR EACH ROW
  EXECUTE FUNCTION update_group_config_timestamp();
