#!/usr/bin/env node
/**
 * Check current Supabase schema for message history tables
 */
import dotenv from 'dotenv'

dotenv.config()

const SUPABASE_PROJECT_REF = 'jhkpgltugjurvzqpaunw'
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

console.log('🔍 Checking Supabase schema...\n')

// Get table schema
const query = `
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('contacts', 'groups', 'messages')
ORDER BY table_name, ordinal_position;
`

const url = `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ query })
})

const result = await response.json()

if (result.length > 0) {
  console.log('📊 Existing tables found:\n')

  let currentTable = ''
  for (const row of result) {
    if (row.table_name !== currentTable) {
      console.log(`\n${row.table_name}:`)
      currentTable = row.table_name
    }
    console.log(`  - ${row.column_name}: ${row.data_type}${row.is_nullable === 'YES' ? ' (nullable)' : ''}`)
  }
} else {
  console.log('ℹ️  No message history tables found')
}

// Check if RPC functions exist
console.log('\n\n🔧 Checking RPC functions...\n')

const rpcQuery = `
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('upsert_contact', 'upsert_group')
ORDER BY routine_name;
`

const rpcResponse = await fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ query: rpcQuery })
})

const rpcResult = await rpcResponse.json()

if (rpcResult.length > 0) {
  for (const row of rpcResult) {
    console.log(`  ✅ ${row.routine_name} (${row.routine_type})`)
  }
} else {
  console.log('  ℹ️  No RPC functions found')
}

console.log('\n')
