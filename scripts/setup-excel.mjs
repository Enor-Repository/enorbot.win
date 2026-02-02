#!/usr/bin/env node
/**
 * Setup Excel worksheets for eNorBOT observations
 * Creates Observations and Liqd worksheets with proper 18-column structure
 */
import dotenv from 'dotenv'
import { ensureValidToken } from '../dist/services/graph.js'
import { getConfig } from '../dist/config.js'

// Load environment variables
dotenv.config()

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'

// 18-column headers for observation logging
const OBSERVATION_HEADERS = [
  'Timestamp',
  'Group_ID',
  'Group_Name',
  'Player_JID',
  'Player_Name',
  'Player_Role',
  'Message_Type',
  'Trigger_Pattern',
  'Conversation_Thread',
  'Volume_BRL',
  'Volume_USDT',
  'Content_Preview',
  'Response_Required',
  'Response_Given',
  'Response_Time_ms',
  'Hour_of_Day',
  'Day_of_Week',
  'AI_Used'
]

/**
 * Check if a worksheet exists
 */
async function worksheetExists(token, siteId, driveId, fileId, worksheetName) {
  const url = `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets/${worksheetName}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  })

  return response.ok
}

/**
 * Create a new worksheet
 */
async function createWorksheet(token, siteId, driveId, fileId, worksheetName) {
  const url = `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: worksheetName })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create worksheet: ${error}`)
  }

  return await response.json()
}

/**
 * Add headers to a worksheet and create a table
 */
async function setupWorksheetTable(token, siteId, driveId, fileId, worksheetName, tableName) {
  // 1. Add headers to row 1
  const rangeUrl = `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets/${worksheetName}/range(address='A1:R1')`

  const rangeResponse = await fetch(rangeUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [OBSERVATION_HEADERS]
    })
  })

  if (!rangeResponse.ok) {
    const error = await rangeResponse.text()
    throw new Error(`Failed to add headers: ${error}`)
  }

  console.log(`  ✅ Headers added to ${worksheetName}`)

  // 2. Create table from the range
  const tableUrl = `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets/${worksheetName}/tables/add`

  const tableResponse = await fetch(tableUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      address: 'A1:R1',
      hasHeaders: true,
      name: tableName
    })
  })

  if (!tableResponse.ok) {
    const error = await tableResponse.text()
    throw new Error(`Failed to create table: ${error}`)
  }

  console.log(`  ✅ Table "${tableName}" created in ${worksheetName}`)
}

/**
 * Main setup function
 */
async function setupExcelWorksheets() {
  console.log('📊 Setting up Excel worksheets for eNorBOT observations\n')

  // Get configuration
  const config = getConfig()
  const { EXCEL_SITE_ID, EXCEL_DRIVE_ID, EXCEL_FILE_ID } = config

  // Get auth token
  console.log('🔐 Getting MS Graph auth token...')
  const tokenResult = await ensureValidToken()
  if (!tokenResult.ok) {
    throw new Error(`Auth failed: ${tokenResult.error}`)
  }
  const token = tokenResult.data
  console.log('✅ Auth token obtained\n')

  // Setup Observations worksheet
  console.log('📝 Setting up Observations worksheet...')
  const observationsExists = await worksheetExists(token, EXCEL_SITE_ID, EXCEL_DRIVE_ID, EXCEL_FILE_ID, 'Observations')

  if (observationsExists) {
    console.log('  ℹ️  Observations worksheet already exists')
  } else {
    await createWorksheet(token, EXCEL_SITE_ID, EXCEL_DRIVE_ID, EXCEL_FILE_ID, 'Observations')
    console.log('  ✅ Observations worksheet created')
    await setupWorksheetTable(token, EXCEL_SITE_ID, EXCEL_DRIVE_ID, EXCEL_FILE_ID, 'Observations', 'ObservationsTable')
  }

  console.log('')

  // Setup Liqd worksheet
  console.log('📝 Setting up Liqd worksheet...')
  const liqdExists = await worksheetExists(token, EXCEL_SITE_ID, EXCEL_DRIVE_ID, EXCEL_FILE_ID, 'Liqd')

  if (liqdExists) {
    console.log('  ℹ️  Liqd worksheet already exists')
  } else {
    await createWorksheet(token, EXCEL_SITE_ID, EXCEL_DRIVE_ID, EXCEL_FILE_ID, 'Liqd')
    console.log('  ✅ Liqd worksheet created')
    await setupWorksheetTable(token, EXCEL_SITE_ID, EXCEL_DRIVE_ID, EXCEL_FILE_ID, 'Liqd', 'LiqdTable')
  }

  console.log('\n✅ Excel worksheets setup complete!')
  console.log('\nWorksheets created:')
  console.log('  • Observations (ObservationsTable) - 18 columns')
  console.log('  • Liqd (LiqdTable) - 18 columns')
}

// Run setup
setupExcelWorksheets().catch(error => {
  console.error('❌ Setup failed:', error.message)
  process.exit(1)
})
