/**
 * One-time script to create the Liqd worksheet in Excel
 *
 * Creates:
 * 1. A new worksheet named "Liqd"
 * 2. A table named "LiqdTable" with the 18 observation columns
 *
 * Usage: npx tsx scripts/create-liqd-worksheet.ts
 */

import { ConfidentialClientApplication } from '@azure/msal-node'
import 'dotenv/config'

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'

// Observation columns (18 total, same as Observations worksheet)
const OBSERVATION_COLUMNS = [
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
  'AI_Used',
]

async function getAccessToken(): Promise<string> {
  const msalConfig = {
    auth: {
      clientId: process.env.MS_GRAPH_CLIENT_ID!,
      clientSecret: process.env.MS_GRAPH_CLIENT_SECRET!,
      authority: `https://login.microsoftonline.com/${process.env.MS_GRAPH_TENANT_ID}`,
    },
  }

  const client = new ConfidentialClientApplication(msalConfig)
  const result = await client.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  })

  if (!result?.accessToken) {
    throw new Error('Failed to get access token')
  }

  return result.accessToken
}

async function worksheetExists(token: string, worksheetName: string): Promise<boolean> {
  const siteId = process.env.EXCEL_SITE_ID!
  const driveId = process.env.EXCEL_DRIVE_ID!
  const fileId = process.env.EXCEL_FILE_ID!

  const url = `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets/${worksheetName}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.ok
}

async function createWorksheet(token: string, worksheetName: string): Promise<void> {
  const siteId = process.env.EXCEL_SITE_ID!
  const driveId = process.env.EXCEL_DRIVE_ID!
  const fileId = process.env.EXCEL_FILE_ID!

  const url = `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets/add`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: worksheetName }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create worksheet: ${response.status} ${error}`)
  }

  console.log(`✅ Worksheet "${worksheetName}" created`)
}

async function addHeaderRow(token: string, worksheetName: string): Promise<void> {
  const siteId = process.env.EXCEL_SITE_ID!
  const driveId = process.env.EXCEL_DRIVE_ID!
  const fileId = process.env.EXCEL_FILE_ID!

  // Write headers to row 1
  const lastColumn = String.fromCharCode(64 + OBSERVATION_COLUMNS.length) // 18 = R
  const range = `A1:${lastColumn}1`

  const url = `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets/${worksheetName}/range(address='${range}')`

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [OBSERVATION_COLUMNS],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to add headers: ${response.status} ${error}`)
  }

  console.log(`✅ Header row added (${OBSERVATION_COLUMNS.length} columns)`)
}

async function createTable(token: string, worksheetName: string, tableName: string): Promise<void> {
  const siteId = process.env.EXCEL_SITE_ID!
  const driveId = process.env.EXCEL_DRIVE_ID!
  const fileId = process.env.EXCEL_FILE_ID!

  // Create table from header row
  const lastColumn = String.fromCharCode(64 + OBSERVATION_COLUMNS.length) // 18 = R
  const tableRange = `${worksheetName}!A1:${lastColumn}1`

  const url = `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/tables/add`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address: tableRange,
      hasHeaders: true,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create table: ${response.status} ${error}`)
  }

  // Get the created table ID to rename it
  const tableData = await response.json()
  const tableId = tableData.id

  // Rename the table
  const renameUrl = `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/tables/${tableId}`

  const renameResponse = await fetch(renameUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: tableName }),
  })

  if (!renameResponse.ok) {
    console.log(`⚠️ Table created but could not be renamed to "${tableName}"`)
  } else {
    console.log(`✅ Table "${tableName}" created`)
  }
}

async function main() {
  console.log('🚀 Creating Liqd worksheet for dedicated observation logging\n')

  // Validate env vars
  const required = [
    'MS_GRAPH_CLIENT_ID',
    'MS_GRAPH_CLIENT_SECRET',
    'MS_GRAPH_TENANT_ID',
    'EXCEL_SITE_ID',
    'EXCEL_DRIVE_ID',
    'EXCEL_FILE_ID',
  ]

  for (const key of required) {
    if (!process.env[key]) {
      console.error(`❌ Missing required env var: ${key}`)
      process.exit(1)
    }
  }

  const worksheetName = 'Liqd'
  const tableName = 'LiqdTable'

  try {
    // Get access token
    console.log('🔑 Authenticating with MS Graph...')
    const token = await getAccessToken()
    console.log('✅ Authenticated\n')

    // Check if worksheet already exists
    console.log(`📋 Checking if worksheet "${worksheetName}" exists...`)
    const exists = await worksheetExists(token, worksheetName)

    if (exists) {
      console.log(`⚠️ Worksheet "${worksheetName}" already exists. Skipping creation.`)
      console.log('   If you need to recreate it, delete the existing one first.')
      return
    }

    // Create worksheet
    console.log(`📝 Creating worksheet "${worksheetName}"...`)
    await createWorksheet(token, worksheetName)

    // Add header row
    console.log('📝 Adding header row...')
    await addHeaderRow(token, worksheetName)

    // Create table
    console.log(`📊 Creating table "${tableName}"...`)
    await createTable(token, worksheetName, tableName)

    console.log('\n✅ Liqd worksheet setup complete!')
    console.log('\nNext steps:')
    console.log('1. Add EXCEL_LIQD_WORKSHEET_NAME=Liqd to .env')
    console.log('2. Add EXCEL_LIQD_TABLE_NAME=LiqdTable to .env')
    console.log('3. Deploy to VPS')
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
