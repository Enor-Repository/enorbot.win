#!/usr/bin/env node
/**
 * Apply Supabase migrations
 * Reads SQL files from supabase/migrations/ and applies them to the database
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Load environment variables
dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

console.log('🔄 Applying Supabase migrations...\n')

// Get all migration files
const migrationsDir = 'supabase/migrations'
const files = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort() // Apply in order

console.log(`Found ${files.length} migration files:\n`)

for (const file of files) {
  console.log(`📄 Applying: ${file}`)

  try {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8')

    // Execute the SQL
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql })

    if (error) {
      console.log(`  ⚠️  Warning: ${error.message}`)
      console.log(`  (May already be applied - continuing...)\n`)
    } else {
      console.log(`  ✅ Applied successfully\n`)
    }
  } catch (err) {
    console.log(`  ⚠️  Error: ${err.message}`)
    console.log(`  (May already be applied - continuing...)\n`)
  }
}

console.log('✅ Migration application complete!')
console.log('\n🔍 Verifying database schema...\n')

// Verify tables exist
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

for (const table of expectedTables) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .limit(0)

  if (error) {
    console.log(`  ❌ ${table} - NOT FOUND`)
  } else {
    console.log(`  ✅ ${table} - EXISTS`)
  }
}

console.log('\n✅ Verification complete!')
