#!/usr/bin/env node
/**
 * Apply message_history migration to Supabase
 * Uses Supabase Management API to execute SQL directly
 */
import dotenv from 'dotenv'
import { readFileSync } from 'fs'

// Load environment variables
dotenv.config()

const SUPABASE_PROJECT_REF = 'jhkpgltugjurvzqpaunw'
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!SUPABASE_ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN not found in .env')
  process.exit(1)
}

console.log('🔄 Applying message_history migration to Supabase...\n')

// Read the migration file
const sql = readFileSync('supabase/migrations/20260130_001_create_message_history_tables.sql', 'utf-8')

console.log('📄 Migration file: 20260130_001_create_message_history_tables.sql')
console.log('📊 Creating tables: contacts, groups, messages')
console.log('🔧 Creating RPC functions: upsert_contact, upsert_group\n')

// Execute SQL via Supabase Management API
const url = `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('❌ Migration failed:', error)
    process.exit(1)
  }

  const result = await response.json()
  console.log('✅ Migration applied successfully!\n')

  // Check if tables were created
  console.log('🔍 Verifying tables created...\n')

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  )

  const tables = ['contacts', 'groups', 'messages']

  for (const table of tables) {
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

  console.log('\n✅ Message history migration complete!')

} catch (error) {
  console.error('❌ Error:', error.message)
  process.exit(1)
}
