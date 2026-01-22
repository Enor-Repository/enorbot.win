-- Migration: Create receipts table (Story 6.5)
-- Purpose: Store validated PIX receipt data extracted from PDFs and images

CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  end_to_end_id VARCHAR(100) UNIQUE NOT NULL,
  valor BIGINT NOT NULL,
  data_hora TIMESTAMPTZ NOT NULL,
  tipo VARCHAR(100),
  recebedor JSONB NOT NULL,
  pagador JSONB NOT NULL,
  raw_file_url VARCHAR(500),
  source_type VARCHAR(10) NOT NULL CHECK (source_type IN ('pdf', 'image')),
  group_jid VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_receipts_end_to_end_id ON receipts(end_to_end_id);
CREATE INDEX IF NOT EXISTS idx_receipts_group_jid ON receipts(group_jid);
CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts(created_at);

-- Enable Row Level Security
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated access
CREATE POLICY "Allow all operations for authenticated users"
  ON receipts
  FOR ALL
  USING (true)
  WITH CHECK (true);
