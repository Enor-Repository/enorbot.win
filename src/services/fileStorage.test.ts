import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  storeRawFile,
  fileExists,
  getFileUrl,
  getExtensionFromMimeType,
  resetStorageClient,
  setStorageClient,
} from './fileStorage.js'

// Mock getConfig
vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-key',
  })),
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { logger } from '../utils/logger.js'

// Create mock Supabase client with Storage
function createMockSupabase() {
  const mockUpload = vi.fn()
  const mockGetPublicUrl = vi.fn()
  const mockList = vi.fn()
  const mockFrom = vi.fn()

  // Default implementations
  mockUpload.mockResolvedValue({
    data: { path: 'test-id.pdf' },
    error: null,
  })

  mockGetPublicUrl.mockReturnValue({
    data: { publicUrl: 'https://storage.supabase.co/receipts/test-id.pdf' },
  })

  mockList.mockResolvedValue({
    data: [],
    error: null,
  })

  mockFrom.mockReturnValue({
    upload: mockUpload,
    getPublicUrl: mockGetPublicUrl,
    list: mockList,
  })

  return {
    storage: {
      from: mockFrom,
    },
    _mockFrom: mockFrom,
    _mockUpload: mockUpload,
    _mockGetPublicUrl: mockGetPublicUrl,
    _mockList: mockList,
  }
}

describe('getExtensionFromMimeType', () => {
  it('returns pdf for application/pdf', () => {
    expect(getExtensionFromMimeType('application/pdf')).toBe('pdf')
  })

  it('returns jpg for image/jpeg', () => {
    expect(getExtensionFromMimeType('image/jpeg')).toBe('jpg')
  })

  it('returns png for image/png', () => {
    expect(getExtensionFromMimeType('image/png')).toBe('png')
  })

  it('returns webp for image/webp', () => {
    expect(getExtensionFromMimeType('image/webp')).toBe('webp')
  })

  it('returns bin for unknown MIME types', () => {
    expect(getExtensionFromMimeType('application/octet-stream')).toBe('bin')
    expect(getExtensionFromMimeType('unknown/type')).toBe('bin')
    expect(getExtensionFromMimeType('')).toBe('bin')
  })
})

describe('storeRawFile', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    resetStorageClient()
    mockSupabase = createMockSupabase()
    setStorageClient(mockSupabase as unknown as Parameters<typeof setStorageClient>[0])
  })

  afterEach(() => {
    resetStorageClient()
  })

  describe('AC1: Upload to Supabase Storage', () => {
    it('uploads file successfully', async () => {
      const buffer = Buffer.from('fake-pdf-content')
      const result = await storeRawFile(buffer, 'test-id-123', 'application/pdf')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toContain('https://storage.supabase.co')
      }
    })

    it('calls storage.from with receipts bucket', async () => {
      const buffer = Buffer.from('fake-content')
      await storeRawFile(buffer, 'test-id', 'application/pdf')

      expect(mockSupabase.storage.from).toHaveBeenCalledWith('receipts')
    })

    it('uploads with correct content type', async () => {
      const buffer = Buffer.from('fake-content')
      await storeRawFile(buffer, 'test-id', 'image/jpeg')

      expect(mockSupabase._mockUpload).toHaveBeenCalledWith(
        'test-id.jpg',
        buffer,
        expect.objectContaining({
          contentType: 'image/jpeg',
        })
      )
    })

    it('uses upsert: false to prevent overwrites', async () => {
      const buffer = Buffer.from('fake-content')
      await storeRawFile(buffer, 'test-id', 'application/pdf')

      expect(mockSupabase._mockUpload).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({
          upsert: false,
        })
      )
    })
  })

  describe('AC2: Return public URL', () => {
    it('returns public URL on success', async () => {
      const expectedUrl = 'https://storage.supabase.co/receipts/abc123.pdf'
      mockSupabase._mockGetPublicUrl.mockReturnValue({
        data: { publicUrl: expectedUrl },
      })

      const buffer = Buffer.from('fake-content')
      const result = await storeRawFile(buffer, 'abc123', 'application/pdf')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe(expectedUrl)
      }
    })

    it('logs successful upload with details', async () => {
      const buffer = Buffer.from('fake-content')
      await storeRawFile(buffer, 'test-id', 'application/pdf')

      expect(logger.info).toHaveBeenCalledWith(
        'File uploaded successfully',
        expect.objectContaining({
          event: 'file_uploaded',
          filename: 'test-id.pdf',
          mimeType: 'application/pdf',
          sizeBytes: buffer.length,
        })
      )
    })
  })

  describe('AC3: Handle upload failures gracefully', () => {
    it('returns error when upload fails', async () => {
      mockSupabase._mockUpload.mockResolvedValue({
        data: null,
        error: { message: 'Storage bucket not found' },
      })

      const buffer = Buffer.from('fake-content')
      const result = await storeRawFile(buffer, 'test-id', 'application/pdf')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Upload failed')
      }
    })

    it('logs upload failure', async () => {
      mockSupabase._mockUpload.mockResolvedValue({
        data: null,
        error: { message: 'Network error' },
      })

      const buffer = Buffer.from('fake-content')
      await storeRawFile(buffer, 'test-id', 'application/pdf')

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to upload file',
        expect.objectContaining({
          event: 'file_upload_error',
          errorMessage: 'Network error',
        })
      )
    })

    it('handles duplicate file gracefully', async () => {
      mockSupabase._mockUpload.mockResolvedValue({
        data: null,
        error: { message: 'The resource already exists' },
      })

      const expectedUrl = 'https://storage.supabase.co/receipts/existing.pdf'
      mockSupabase._mockGetPublicUrl.mockReturnValue({
        data: { publicUrl: expectedUrl },
      })

      const buffer = Buffer.from('fake-content')
      const result = await storeRawFile(buffer, 'existing', 'application/pdf')

      // Should return success with existing URL
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe(expectedUrl)
      }
    })

    it('returns error when Supabase not initialized', async () => {
      resetStorageClient()
      vi.mocked(await import('../config.js')).getConfig.mockImplementation(() => {
        throw new Error('Config not available')
      })

      const buffer = Buffer.from('fake-content')
      const result = await storeRawFile(buffer, 'test-id', 'application/pdf')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Supabase not initialized')
      }
    })

    it('handles unexpected exceptions', async () => {
      mockSupabase._mockUpload.mockRejectedValue(new Error('Connection timeout'))

      const buffer = Buffer.from('fake-content')
      const result = await storeRawFile(buffer, 'test-id', 'application/pdf')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Unexpected error')
      }
    })
  })

  describe('AC4: Filename format', () => {
    it('generates PDF filename correctly', async () => {
      const buffer = Buffer.from('fake-content')
      await storeRawFile(buffer, '7c005681-9f98-4ea5-a12e-45a7a71345e2', 'application/pdf')

      expect(mockSupabase._mockUpload).toHaveBeenCalledWith(
        '7c005681-9f98-4ea5-a12e-45a7a71345e2.pdf',
        expect.any(Buffer),
        expect.any(Object)
      )
    })

    it('generates JPEG filename correctly', async () => {
      const buffer = Buffer.from('fake-content')
      await storeRawFile(buffer, 'abc-123', 'image/jpeg')

      expect(mockSupabase._mockUpload).toHaveBeenCalledWith(
        'abc-123.jpg',
        expect.any(Buffer),
        expect.any(Object)
      )
    })

    it('generates PNG filename correctly', async () => {
      const buffer = Buffer.from('fake-content')
      await storeRawFile(buffer, 'xyz-789', 'image/png')

      expect(mockSupabase._mockUpload).toHaveBeenCalledWith(
        'xyz-789.png',
        expect.any(Buffer),
        expect.any(Object)
      )
    })

    it('generates WebP filename correctly', async () => {
      const buffer = Buffer.from('fake-content')
      await storeRawFile(buffer, 'webp-test', 'image/webp')

      expect(mockSupabase._mockUpload).toHaveBeenCalledWith(
        'webp-test.webp',
        expect.any(Buffer),
        expect.any(Object)
      )
    })

    it('uses .bin for unknown MIME types', async () => {
      const buffer = Buffer.from('fake-content')
      await storeRawFile(buffer, 'unknown-type', 'application/unknown')

      expect(mockSupabase._mockUpload).toHaveBeenCalledWith(
        'unknown-type.bin',
        expect.any(Buffer),
        expect.any(Object)
      )
    })
  })

  describe('Result pattern compliance', () => {
    it('never throws, always returns Result', async () => {
      const errorScenarios = [
        () => mockSupabase._mockUpload.mockRejectedValue(new Error('error')),
        () => mockSupabase._mockUpload.mockRejectedValue(null),
        () => mockSupabase._mockUpload.mockResolvedValue({ data: null, error: { message: 'err' } }),
      ]

      for (const setup of errorScenarios) {
        setup()
        const buffer = Buffer.from('fake-content')
        const result = await storeRawFile(buffer, 'test-id', 'application/pdf')

        expect(result).toHaveProperty('ok')
        if (!result.ok) {
          expect(result).toHaveProperty('error')
          expect(typeof result.error).toBe('string')
        }
      }
    })
  })
})

describe('fileExists', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    resetStorageClient()
    mockSupabase = createMockSupabase()
    setStorageClient(mockSupabase as unknown as Parameters<typeof setStorageClient>[0])
  })

  afterEach(() => {
    resetStorageClient()
  })

  it('returns true when file exists', async () => {
    mockSupabase._mockList.mockResolvedValue({
      data: [{ name: 'test-id.pdf' }],
      error: null,
    })

    const result = await fileExists('test-id', 'pdf')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toBe(true)
    }
  })

  it('returns false when file does not exist', async () => {
    mockSupabase._mockList.mockResolvedValue({
      data: [],
      error: null,
    })

    const result = await fileExists('nonexistent', 'pdf')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toBe(false)
    }
  })

  it('returns error on storage failure', async () => {
    mockSupabase._mockList.mockResolvedValue({
      data: null,
      error: { message: 'Storage error' },
    })

    const result = await fileExists('test-id', 'pdf')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Storage error')
    }
  })

  it('returns error when Supabase not initialized', async () => {
    resetStorageClient()
    vi.mocked(await import('../config.js')).getConfig.mockImplementation(() => {
      throw new Error('Config not available')
    })

    const result = await fileExists('test-id', 'pdf')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Supabase not initialized')
    }
  })
})

describe('getFileUrl', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    resetStorageClient()
    mockSupabase = createMockSupabase()
    setStorageClient(mockSupabase as unknown as Parameters<typeof setStorageClient>[0])
  })

  afterEach(() => {
    resetStorageClient()
  })

  it('returns public URL for file', () => {
    const expectedUrl = 'https://storage.supabase.co/receipts/abc.pdf'
    mockSupabase._mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: expectedUrl },
    })

    const url = getFileUrl('abc', 'pdf')

    expect(url).toBe(expectedUrl)
  })

  it('returns null when Supabase not initialized', async () => {
    resetStorageClient()

    // Mock getConfig to throw
    vi.mocked(await import('../config.js')).getConfig.mockImplementation(() => {
      throw new Error('Config not available')
    })

    const url = getFileUrl('test', 'pdf')

    expect(url).toBe(null)
  })

  it('constructs correct filename', () => {
    getFileUrl('my-end-to-end-id', 'jpg')

    expect(mockSupabase.storage.from).toHaveBeenCalledWith('receipts')
    expect(mockSupabase._mockGetPublicUrl).toHaveBeenCalledWith('my-end-to-end-id.jpg')
  })
})
