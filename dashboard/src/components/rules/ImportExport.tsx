/**
 * Import/Export Rules Component - Story D.8
 * Enables sharing and backup of trigger pattern rules
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Download, Upload, AlertCircle, Check, Loader2, FileJson, Copy, ArrowRightLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { API_ENDPOINTS } from '@/lib/api'

interface ExportedRule {
  trigger_phrase: string
  action_type: string
  action_params: Record<string, unknown>
  priority: number
  is_active: boolean
  scope: 'all_groups' | 'control_group_only'
}

interface ExportData {
  version: '1.0'
  exportedAt: string
  exportedFrom: string
  rules: ExportedRule[]
}

interface ImportExportProps {
  groupJid?: string
  onImportComplete?: () => void
}

type ImportMode = 'merge' | 'replace'

// Max file size: 1MB - prevents browser memory issues
const MAX_FILE_SIZE = 1024 * 1024

export function ImportExport({ groupJid = 'demo-group-id', onImportComplete }: ImportExportProps) {
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importData, setImportData] = useState<ExportData | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('merge')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [failedImports, setFailedImports] = useState<string[]>([])
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Close modal with Escape key
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && showImportModal && !importing) {
      setShowImportModal(false)
      setImportData(null)
      setError(null)
      setShowReplaceConfirm(false)
    }
  }, [showImportModal, importing])

  useEffect(() => {
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [handleEscape])

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [error])

  const handleExport = async () => {
    setExporting(true)
    setError(null)

    try {
      const response = await fetch(API_ENDPOINTS.rules)
      if (!response.ok) {
        throw new Error('Failed to fetch rules')
      }

      const data = await response.json()
      const rules = data.rules || []

      // Transform to export format (strip internal IDs, make rules global)
      const exportedRules: ExportedRule[] = rules.map((rule: Record<string, unknown>) => ({
        trigger_phrase: rule.trigger_phrase as string,
        action_type: (rule.action_type as string) || 'text_response',
        action_params: (rule.action_params as Record<string, unknown>) || { template: rule.response_template as string },
        priority: (rule.priority as number) || 0,
        is_active: rule.is_active as boolean,
        scope: ((rule.metadata as Record<string, unknown>)?.scope as 'all_groups' | 'control_group_only') || 'all_groups',
      }))

      const exportData: ExportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        exportedFrom: groupJid,
        rules: exportedRules,
      }

      // Create and download file
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `enorbot-rules-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setSuccess(`Exported ${exportedRules.length} rules successfully`)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum size is 1MB.`)
      e.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string
        const data = JSON.parse(content) as ExportData

        // Validate structure
        if (!data.version || !data.rules || !Array.isArray(data.rules)) {
          throw new Error('Invalid file format: missing version or rules array')
        }

        if (data.version !== '1.0') {
          throw new Error(`Unsupported version: ${data.version}`)
        }

        // Validate each rule
        for (let i = 0; i < data.rules.length; i++) {
          const rule = data.rules[i]
          if (!rule.trigger_phrase) {
            throw new Error(`Rule ${i + 1} is missing trigger_phrase`)
          }
          if (!rule.action_type) {
            throw new Error(`Rule ${i + 1} is missing action_type`)
          }
        }

        setImportData(data)
        setShowImportModal(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse file')
      }
    }

    reader.onerror = () => {
      setError('Failed to read file')
    }

    reader.readAsText(file)

    // Reset file input
    e.target.value = ''
  }

  const handleImport = async () => {
    if (!importData) return

    // Require confirmation for replace mode
    if (importMode === 'replace' && !showReplaceConfirm) {
      setShowReplaceConfirm(true)
      return
    }

    setImporting(true)
    setError(null)
    setFailedImports([])
    setImportProgress({ current: 0, total: importData.rules.length })

    try {
      // If replace mode, delete all existing rules first
      if (importMode === 'replace') {
        const existingResponse = await fetch(API_ENDPOINTS.rules)
        if (existingResponse.ok) {
          const existingData = await existingResponse.json()
          const existingRules = existingData.rules || []

          for (const rule of existingRules) {
            await fetch(API_ENDPOINTS.rule(rule.id), { method: 'DELETE' })
          }
        }
      }

      // Get existing rules for merge mode deduplication
      let existingTriggers: Set<string> = new Set()
      if (importMode === 'merge') {
        const existingResponse = await fetch(API_ENDPOINTS.rules)
        if (existingResponse.ok) {
          const existingData = await existingResponse.json()
          const existingRules = existingData.rules || []
          existingTriggers = new Set(existingRules.map((r: Record<string, unknown>) => (r.trigger_phrase as string).toLowerCase()))
        }
      }

      // Import rules
      let imported = 0
      let skipped = 0
      const failed: string[] = []

      for (let i = 0; i < importData.rules.length; i++) {
        const rule = importData.rules[i]
        setImportProgress({ current: i + 1, total: importData.rules.length })

        // Skip if exists in merge mode
        if (importMode === 'merge' && existingTriggers.has(rule.trigger_phrase.toLowerCase())) {
          skipped++
          continue
        }

        const response = await fetch(API_ENDPOINTS.rules, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupJid,
            triggerPhrase: rule.trigger_phrase,
            responseTemplate: rule.action_type === 'text_response' ? (rule.action_params as Record<string, string>).template || '' : '',
            action_type: rule.action_type,
            action_params: rule.action_params,
            priority: rule.priority,
            isActive: rule.is_active,
            scope: rule.scope,
          }),
        })

        if (response.ok) {
          imported++
        } else {
          failed.push(rule.trigger_phrase)
        }
      }

      setFailedImports(failed)

      if (failed.length > 0) {
        setSuccess(`Imported ${imported} rules${skipped > 0 ? `, skipped ${skipped} duplicates` : ''}, ${failed.length} failed`)
      } else {
        setSuccess(`Imported ${imported} rules${skipped > 0 ? `, skipped ${skipped} duplicates` : ''}`)
      }
      setShowImportModal(false)
      setImportData(null)
      setShowReplaceConfirm(false)
      onImportComplete?.()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      setImportProgress({ current: 0, total: 0 })
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileSelect}
        className="hidden"
      />

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
          className="gap-2 font-mono text-xs border-cyan-500/30 bg-cyan-500/5 hover:bg-cyan-500/10 text-cyan-400"
        >
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Export
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="gap-2 font-mono text-xs border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 text-purple-400"
        >
          <Upload className="h-3.5 w-3.5" />
          Import
        </Button>
      </div>

      {/* Success/Error Toast */}
      {(success || error) && (
        <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 p-4 rounded-lg border shadow-lg max-w-md ${
          success && failedImports.length === 0
            ? 'border-green-500/30 bg-green-500/10 text-green-400'
            : success && failedImports.length > 0
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
        }`}>
          {success && failedImports.length === 0 ? (
            <Check className="h-5 w-5 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
          )}
          <div className="flex-1">
            <span className="font-mono text-sm">{success || error}</span>
            {failedImports.length > 0 && (
              <div className="text-xs mt-1 opacity-70">
                Failed: {failedImports.slice(0, 3).map(t => `"${t}"`).join(', ')}
                {failedImports.length > 3 && ` +${failedImports.length - 3} more`}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              setSuccess(null)
              setError(null)
              setFailedImports([])
            }}
            className="ml-2 p-1 rounded hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && importData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-lg bg-card border border-border/50 rounded-lg shadow-2xl shadow-purple-500/10">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-500/10 via-transparent to-cyan-500/10 border-b border-border/30 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-purple-500/30 flex items-center justify-center">
                    <FileJson className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-mono font-bold bg-gradient-to-r from-purple-400 to-cyan-500 bg-clip-text text-transparent">
                      Import Rules
                    </h2>
                    <p className="text-sm text-muted-foreground font-mono mt-1">
                      {importData.rules.length} rules from {importData.exportedAt.split('T')[0]}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!importing) {
                      setShowImportModal(false)
                      setImportData(null)
                      setError(null)
                      setShowReplaceConfirm(false)
                    }
                  }}
                  disabled={importing}
                  className="h-8 w-8 rounded-lg border border-border/30 bg-muted/20 hover:bg-muted/40 disabled:opacity-50 flex items-center justify-center transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Preview */}
              <div className="space-y-3">
                <label className="block text-sm font-mono font-semibold text-foreground">
                  Rules to Import
                </label>
                <div className="max-h-48 overflow-y-auto space-y-2 p-3 rounded-lg border border-border/30 bg-black/20">
                  {importData.rules.map((rule, i) => (
                    <div key={i} className="flex items-center justify-between text-sm font-mono">
                      <span className="truncate text-foreground">"{rule.trigger_phrase}"</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {rule.action_type}
                        </Badge>
                        {!rule.is_active && (
                          <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-[10px] px-1.5 py-0">
                            OFF
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Import Mode */}
              <div className="space-y-3">
                <label className="block text-sm font-mono font-semibold text-foreground">
                  Import Mode
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setImportMode('merge')}
                    className={`
                      p-4 rounded-lg border font-mono text-sm transition-all text-left
                      ${importMode === 'merge'
                        ? 'bg-green-500/20 border-green-500/50 text-green-300 shadow-[0_0_12px_rgba(34,197,94,0.3)]'
                        : 'bg-muted/20 border-border/30 text-muted-foreground hover:bg-muted/30'
                      }
                    `}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Copy className="h-4 w-4" />
                      <span className="font-semibold">Merge</span>
                    </div>
                    <p className="text-xs opacity-70">
                      Add new rules, skip existing
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportMode('replace')}
                    className={`
                      p-4 rounded-lg border font-mono text-sm transition-all text-left
                      ${importMode === 'replace'
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                        : 'bg-muted/20 border-border/30 text-muted-foreground hover:bg-muted/30'
                      }
                    `}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowRightLeft className="h-4 w-4" />
                      <span className="font-semibold">Replace</span>
                    </div>
                    <p className="text-xs opacity-70">
                      Delete all, import fresh
                    </p>
                  </button>
                </div>

                {importMode === 'replace' && !showReplaceConfirm && (
                  <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-mono">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>This will delete all existing rules before importing</span>
                  </div>
                )}

                {/* Replace confirmation */}
                {showReplaceConfirm && (
                  <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10 space-y-3">
                    <div className="flex items-start gap-2 text-red-400">
                      <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-mono font-semibold text-sm">Confirm Destructive Action</div>
                        <div className="font-mono text-xs mt-1 opacity-80">
                          This will permanently delete ALL existing rules and replace them with the imported rules.
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => setShowReplaceConfirm(false)}
                        variant="outline"
                        size="sm"
                        className="font-mono text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleImport}
                        size="sm"
                        className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
                      >
                        Yes, Delete All & Import
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Progress */}
              {importing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-mono text-muted-foreground">
                    <span>Importing...</span>
                    <span>{importProgress.current} / {importProgress.total}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 transition-all duration-300"
                      style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-center gap-3 p-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <span className="font-mono text-sm">{error}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="border-t border-border/30 p-6 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowImportModal(false)
                  setImportData(null)
                  setError(null)
                }}
                className="font-mono"
                disabled={importing}
              >
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={importing}
                className="font-mono bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 gap-2"
              >
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import {importData.rules.length} Rules
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
