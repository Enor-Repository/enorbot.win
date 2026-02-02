-- Migration: Create message history tables and RPC functions
-- Story 7: Message History Service
-- Date: 2026-01-30

-- =============================================================================
-- Story 7.1: Contacts Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS contacts (
  jid TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  push_name TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_message_count ON contacts(message_count DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_last_seen ON contacts(last_seen_at DESC);

-- =============================================================================
-- Story 7.2: Groups Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS groups (
  jid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_control_group BOOLEAN NOT NULL DEFAULT FALSE,
  message_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_groups_is_control ON groups(is_control_group);
CREATE INDEX IF NOT EXISTS idx_groups_message_count ON groups(message_count DESC);
CREATE INDEX IF NOT EXISTS idx_groups_last_seen ON groups(last_seen_at DESC);

-- =============================================================================
-- Story 7.3: Messages Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  message_id TEXT,
  group_jid TEXT NOT NULL REFERENCES groups(jid) ON DELETE CASCADE,
  sender_jid TEXT NOT NULL,
  is_control_group BOOLEAN NOT NULL DEFAULT FALSE,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  is_from_bot BOOLEAN NOT NULL DEFAULT FALSE,
  is_trigger BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_group_jid ON messages(group_jid);
CREATE INDEX IF NOT EXISTS idx_messages_sender_jid ON messages(sender_jid);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_is_trigger ON messages(is_trigger) WHERE is_trigger = TRUE;
CREATE INDEX IF NOT EXISTS idx_messages_is_from_bot ON messages(is_from_bot) WHERE is_from_bot = TRUE;
CREATE INDEX IF NOT EXISTS idx_messages_group_created ON messages(group_jid, created_at DESC);

-- =============================================================================
-- Story 7.1: RPC Function - upsert_contact
-- Atomic upsert with message_count increment
-- =============================================================================

CREATE OR REPLACE FUNCTION upsert_contact(
  p_jid TEXT,
  p_phone TEXT,
  p_push_name TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO contacts (jid, phone, push_name, message_count, first_seen_at, last_seen_at)
  VALUES (p_jid, p_phone, p_push_name, 1, NOW(), NOW())
  ON CONFLICT (jid) DO UPDATE SET
    -- Use COALESCE to preserve existing push_name if new one is NULL
    push_name = COALESCE(NULLIF(EXCLUDED.push_name, ''), contacts.push_name),
    message_count = contacts.message_count + 1,
    last_seen_at = NOW();
END;
$$;

-- =============================================================================
-- Story 7.2: RPC Function - upsert_group
-- Atomic upsert with message_count increment
-- =============================================================================

CREATE OR REPLACE FUNCTION upsert_group(
  p_jid TEXT,
  p_name TEXT,
  p_is_control_group BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO groups (jid, name, is_control_group, message_count, first_seen_at, last_seen_at)
  VALUES (p_jid, p_name, p_is_control_group, 1, NOW(), NOW())
  ON CONFLICT (jid) DO UPDATE SET
    -- Use COALESCE to preserve existing name if new one is empty
    name = COALESCE(NULLIF(EXCLUDED.name, ''), groups.name),
    message_count = groups.message_count + 1,
    last_seen_at = NOW();
END;
$$;

-- =============================================================================
-- Comments for documentation
-- =============================================================================

COMMENT ON TABLE contacts IS 'Story 7.1: Tracks all WhatsApp contacts with message counts';
COMMENT ON TABLE groups IS 'Story 7.2: Tracks all WhatsApp groups with control flag';
COMMENT ON TABLE messages IS 'Story 7.3: Logs all messages (incoming and outgoing) for history';
COMMENT ON FUNCTION upsert_contact IS 'Story 7.1: Atomic upsert with message_count increment';
COMMENT ON FUNCTION upsert_group IS 'Story 7.2: Atomic upsert with message_count increment';
