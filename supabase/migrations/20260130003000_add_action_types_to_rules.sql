-- Add action type system to rules table
-- Allows trigger patterns to execute different actions beyond simple text responses

-- Add action_type column (defaults to text_response for existing records)
ALTER TABLE rules
ADD COLUMN IF NOT EXISTS action_type TEXT DEFAULT 'text_response' NOT NULL;

-- Add action_params column for action-specific parameters
ALTER TABLE rules
ADD COLUMN IF NOT EXISTS action_params JSONB DEFAULT '{}'::jsonb NOT NULL;

-- Add check constraint for valid action types
ALTER TABLE rules
ADD CONSTRAINT rules_action_type_check
CHECK (action_type IN (
  'text_response',           -- Simple text template response
  'usdt_quote',              -- Get USDT/BRL price quote
  'commercial_dollar_quote', -- Get commercial dollar quote
  'ai_prompt',               -- Trigger AI with custom prompt
  'custom'                   -- Reserved for future extensions
));

-- Create index for action type filtering
CREATE INDEX IF NOT EXISTS idx_rules_action_type ON rules(action_type);

-- Add comment explaining the action type system
COMMENT ON COLUMN rules.action_type IS 'Type of action to execute when pattern triggers: text_response (simple text), usdt_quote (price quote), commercial_dollar_quote, ai_prompt (AI with custom prompt), custom (future use)';
COMMENT ON COLUMN rules.action_params IS 'JSON parameters specific to the action type. Schema varies by action_type.';

-- Migration complete
