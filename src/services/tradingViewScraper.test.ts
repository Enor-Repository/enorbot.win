import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock data lake to prevent bronze tick side effects during tests
vi.mock('./dataLake.js', () => ({
  emitPriceTick: vi.fn(),
}))

import {
  parsePriceFromTitle,
  isScraperStale,
  getScraperStatus,
  _resetForTesting,
} from './tradingViewScraper.js'

describe('parsePriceFromTitle', () => {
  it('parses Brazilian-format price with comma decimal', () => {
    expect(parsePriceFromTitle('USDBRL 5,2169 ▼ −1.05%')).toBeCloseTo(5.2169)
  })

  it('parses price with period decimal', () => {
    expect(parsePriceFromTitle('USDBRL 5.2169 ▲ +0.5%')).toBeCloseTo(5.2169)
  })

  it('parses price without percentage change', () => {
    expect(parsePriceFromTitle('USDBRL 5,3200')).toBeCloseTo(5.32)
  })

  it('parses price with more decimal places', () => {
    expect(parsePriceFromTitle('USDBRL 5,21690 ▼ −1.05%')).toBeCloseTo(5.2169)
  })

  it('returns null for title without USDBRL', () => {
    expect(parsePriceFromTitle('EURUSD 1,0850 ▲ +0.3%')).toBeNull()
  })

  it('returns null for empty title', () => {
    expect(parsePriceFromTitle('')).toBeNull()
  })

  it('returns null for Chart Not Found title', () => {
    expect(parsePriceFromTitle('Chart Not Found — TradingView')).toBeNull()
  })

  it('returns null for price outside USD/BRL sanity range (< 3)', () => {
    expect(parsePriceFromTitle('USDBRL 2,5000 ▼ −50%')).toBeNull()
  })

  it('returns null for price outside USD/BRL sanity range (> 10)', () => {
    expect(parsePriceFromTitle('USDBRL 15,0000 ▲ +200%')).toBeNull()
  })

  it('handles title with extra whitespace', () => {
    expect(parsePriceFromTitle('USDBRL  5,2169  ▼ −1.05%')).toBeCloseTo(5.2169)
  })
})

describe('isScraperStale', () => {
  beforeEach(async () => {
    await _resetForTesting()
  })

  it('returns true when scraper has never read a price', () => {
    expect(isScraperStale()).toBe(true)
  })
})

describe('getScraperStatus', () => {
  beforeEach(async () => {
    await _resetForTesting()
  })

  it('returns stopped status after reset', () => {
    const status = getScraperStatus()
    expect(status.status).toBe('stopped')
    expect(status.currentPrice).toBeNull()
    expect(status.lastSuccessfulRead).toBeNull()
    expect(status.lastPriceChange).toBeNull()
    expect(status.stale).toBe(true)
  })

  it('status shape includes all expected fields', () => {
    const status = getScraperStatus()
    expect(status).toHaveProperty('status')
    expect(status).toHaveProperty('currentPrice')
    expect(status).toHaveProperty('lastSuccessfulRead')
    expect(status).toHaveProperty('lastPriceChange')
    expect(status).toHaveProperty('stale')
  })
})
