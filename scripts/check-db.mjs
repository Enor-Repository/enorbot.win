#!/usr/bin/env node
/**
 * Check Supabase database schema and verify tables exist
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

console.log('🔍 Checking Supabase database schema...\n')

// Check which tables exist
async function checkTables() {
  const expectedTables = [
    'sessions',
    'log_queue',
    'receipts',
    'group_config',
    'observation_queue',
    'contacts',
    'groups',
    'messages'
  ]

  console.log('Expected tables:')
  for (const table of expectedTables) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(0)

    if (error) {
      console.log(`  ❌ ${table} - NOT FOUND (${error.message})`)
    } else {
      console.log(`  ✅ ${table} - EXISTS`)
    }
  }
}

await checkTables()

console.log('\n✅ Database check complete')
