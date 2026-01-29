/**
 * Tests for Message Classifier Module
 * Story 8.1: Create Message Classifier Module
 */

import { describe, it, expect } from 'vitest'
import {
  classifyMessage,
  extractVolumeUsdt,
  inferPlayerRole,
  getContentPreview,
  // Constants (Issue fix: Extract magic numbers)
  DEFAULT_PREVIEW_MAX_LENGTH,
  OPERATOR_RESPONSE_RATIO_THRESHOLD,
  CLIENT_MESSAGE_RATIO_THRESHOLD,
  MIN_MESSAGES_FOR_ROLE_INFERENCE,
  type ClassificationContext,
  type OTCMessageType,
} from './messageClassifier.js'

describe('messageClassifier', () => {
  // Default context for testing
  const defaultContext: ClassificationContext = {
    isFromBot: false,
    hasReceipt: false,
    hasTronscan: false,
    hasPriceTrigger: false,
    inActiveThread: false,
  }

  describe('classifyMessage', () => {
    describe('AC1: Price requests', () => {
      it('classifies "preço" as price_request', () => {
        const result = classifyMessage('qual o preço?', defaultContext)
        expect(result.messageType).toBe('price_request')
        expect(result.confidence).toBe('high')
      })

      it('classifies "cotação" as price_request', () => {
        const result = classifyMessage('cotação do usdt', defaultContext)
        expect(result.messageType).toBe('price_request')
        expect(result.confidence).toBe('high')
      })

      it('classifies "quanto tá" as price_request', () => {
        const result = classifyMessage('quanto tá o dólar?', defaultContext)
        expect(result.messageType).toBe('price_request')
        expect(result.confidence).toBe('high')
      })

      it('classifies with hasPriceTrigger context', () => {
        const result = classifyMessage('qualquer coisa', {
          ...defaultContext,
          hasPriceTrigger: true,
        })
        expect(result.messageType).toBe('price_request')
      })
    })

    describe('AC2: BRL volume extraction', () => {
      it('extracts volume from "compro 5000"', () => {
        const result = classifyMessage('compro 5000 reais', defaultContext)
        expect(result.volumeBrl).toBe(5000)
      })

      it('extracts volume from "10k"', () => {
        const result = classifyMessage('tenho 10k pra vender', defaultContext)
        expect(result.volumeBrl).toBe(10000)
      })

      it('extracts volume from "5.000" (thousand separator)', () => {
        const result = classifyMessage('compro 5.000', defaultContext)
        expect(result.volumeBrl).toBe(5000)
      })

      it('extracts volume from "15.5k"', () => {
        const result = classifyMessage('preciso de 15.5k', defaultContext)
        expect(result.volumeBrl).toBe(15500)
      })
    })

    describe('AC3: USDT volume extraction', () => {
      it('extracts USDT from "862 usdt"', () => {
        const result = classifyMessage('compro 862 usdt', defaultContext)
        expect(result.volumeUsdt).toBe(862)
      })

      it('extracts USDT from "500u"', () => {
        const result = classifyMessage('tenho 500u', defaultContext)
        expect(result.volumeUsdt).toBe(500)
      })

      it('extracts USDT from "1000 usd"', () => {
        const result = classifyMessage('preciso 1000 usd', defaultContext)
        expect(result.volumeUsdt).toBe(1000)
      })

      it('extracts USDT from "2k usdt"', () => {
        const result = classifyMessage('vendo 2k usdt', defaultContext)
        expect(result.volumeUsdt).toBe(2000)
      })
    })

    describe('AC4: Bot messages', () => {
      it('classifies bot message as price_response', () => {
        const result = classifyMessage('USDT/BRL: 5.80', {
          ...defaultContext,
          isFromBot: true,
        })
        expect(result.messageType).toBe('price_response')
        expect(result.confidence).toBe('high')
      })

      it('bot messages have highest priority', () => {
        const result = classifyMessage('preço cotação', {
          ...defaultContext,
          isFromBot: true,
          hasPriceTrigger: true,
        })
        expect(result.messageType).toBe('price_response')
      })
    })

    describe('Receipt classification', () => {
      it('classifies receipt attachment as receipt', () => {
        const result = classifyMessage('segue comprovante', {
          ...defaultContext,
          hasReceipt: true,
        })
        expect(result.messageType).toBe('receipt')
        expect(result.confidence).toBe('high')
      })

      it('receipt has higher priority than price trigger', () => {
        const result = classifyMessage('preço do comprovante', {
          ...defaultContext,
          hasReceipt: true,
          hasPriceTrigger: true,
        })
        expect(result.messageType).toBe('receipt')
      })
    })

    describe('Tronscan classification', () => {
      it('classifies tronscan link as tronscan', () => {
        const result = classifyMessage(
          'https://tronscan.org/#/transaction/abc123',
          { ...defaultContext, hasTronscan: true }
        )
        expect(result.messageType).toBe('tronscan')
        expect(result.confidence).toBe('high')
      })

      it('detects tronscan from message content', () => {
        const result = classifyMessage(
          'https://tronscan.org/#/transaction/e779beb52ec8448f1234567890abcdef1234567890abcdef1234567890abcdef',
          defaultContext
        )
        expect(result.messageType).toBe('tronscan')
      })
    })

    describe('Volume inquiry classification', () => {
      it('classifies "compro 10k" as volume_inquiry', () => {
        const result = classifyMessage('compro 10k', defaultContext)
        expect(result.messageType).toBe('volume_inquiry')
        expect(result.confidence).toBe('medium')
      })

      it('classifies "vendo 5000 usdt" as volume_inquiry', () => {
        const result = classifyMessage('vendo 5000 usdt', defaultContext)
        expect(result.messageType).toBe('volume_inquiry')
      })

      it('classifies "tenho 2k pra vender" as volume_inquiry', () => {
        const result = classifyMessage('tenho 2k pra vender', defaultContext)
        expect(result.messageType).toBe('volume_inquiry')
      })

      // Party-mode fix: 'mil' (Portuguese thousand) support
      it('classifies "compro 5 mil" as volume_inquiry', () => {
        const result = classifyMessage('compro 5 mil', defaultContext)
        expect(result.messageType).toBe('volume_inquiry')
        expect(result.volumeBrl).toBe(5000)
      })

      it('classifies "vendo 10 mil usdt" as volume_inquiry', () => {
        const result = classifyMessage('vendo 10 mil usdt', defaultContext)
        expect(result.messageType).toBe('volume_inquiry')
        expect(result.volumeUsdt).toBe(10000)
      })

      it('classifies "preciso de 2,5 mil" as volume_inquiry', () => {
        const result = classifyMessage('preciso de 2,5 mil', defaultContext)
        expect(result.messageType).toBe('volume_inquiry')
        expect(result.volumeBrl).toBe(2500)
      })

      it('classifies "tenho 7.5 mil pra vender" as volume_inquiry', () => {
        const result = classifyMessage('tenho 7.5 mil pra vender', defaultContext)
        expect(result.messageType).toBe('volume_inquiry')
        expect(result.volumeBrl).toBe(7500)
      })
    })

    describe('Confirmation classification', () => {
      it('classifies "fechado" as confirmation', () => {
        const result = classifyMessage('fechado', {
          ...defaultContext,
          inActiveThread: true,
        })
        expect(result.messageType).toBe('confirmation')
      })

      it('classifies "ok, vamos" as confirmation', () => {
        const result = classifyMessage('ok, vamos', {
          ...defaultContext,
          inActiveThread: true,
        })
        expect(result.messageType).toBe('confirmation')
      })

      it('standalone confirmation has low confidence', () => {
        const result = classifyMessage('fechado', defaultContext)
        expect(result.messageType).toBe('confirmation')
        expect(result.confidence).toBe('low')
      })
    })

    describe('Negotiation classification', () => {
      it('classifies "pode ser 5.75?" as negotiation in thread', () => {
        const result = classifyMessage('pode ser 5.75?', {
          ...defaultContext,
          inActiveThread: true,
        })
        expect(result.messageType).toBe('negotiation')
      })

      it('classifies counter-offer in thread as negotiation', () => {
        const result = classifyMessage('faz por 5.70?', {
          ...defaultContext,
          inActiveThread: true,
        })
        expect(result.messageType).toBe('negotiation')
      })

      it('volume in thread classifies as negotiation', () => {
        const result = classifyMessage('5000', {
          ...defaultContext,
          inActiveThread: true,
        })
        // Has volume so it's negotiation in thread context
        expect(result.messageType).toBe('negotiation')
        expect(result.volumeBrl).toBe(5000)
      })
    })

    describe('General classification', () => {
      it('classifies unrelated message as general', () => {
        const result = classifyMessage('bom dia pessoal', defaultContext)
        expect(result.messageType).toBe('general')
        expect(result.confidence).toBe('low')
      })

      it('classifies greeting as general', () => {
        const result = classifyMessage('boa tarde', defaultContext)
        expect(result.messageType).toBe('general')
      })
    })

    // New tests for behavioral analysis patterns (2026-01-29)
    describe('Price lock classification (trava)', () => {
      it('classifies "trava 5000" as price_lock', () => {
        const result = classifyMessage('trava 5000', defaultContext)
        expect(result.messageType).toBe('price_lock')
        expect(result.confidence).toBe('high')
      })

      it('classifies "Trava 7831" as price_lock', () => {
        const result = classifyMessage('Trava 7831', defaultContext)
        expect(result.messageType).toBe('price_lock')
      })

      it('classifies "trava 5000 por favor" as price_lock', () => {
        const result = classifyMessage('trava 5000 por favor', defaultContext)
        expect(result.messageType).toBe('price_lock')
      })

      it('classifies "trava 11400.34 por favor" as price_lock', () => {
        const result = classifyMessage('trava 11400.34 por favor', defaultContext)
        expect(result.messageType).toBe('price_lock')
      })

      it('extracts volume from price lock', () => {
        const result = classifyMessage('trava 5000', defaultContext)
        expect(result.volumeBrl).toBe(5000)
      })
    })

    describe('Quote calculation classification', () => {
      it('classifies "5000 * 5.230 = 26,150.00 BRL" as quote_calculation', () => {
        const result = classifyMessage('5000 * 5.230 = 26,150.00 BRL', defaultContext)
        expect(result.messageType).toBe('quote_calculation')
        expect(result.confidence).toBe('high')
      })

      it('classifies "7831 * 5.232 = 40,971.79 BRL" as quote_calculation', () => {
        const result = classifyMessage('7831 * 5.232 = 40,971.79 BRL', defaultContext)
        expect(result.messageType).toBe('quote_calculation')
      })

      it('classifies simple calculation as quote_calculation', () => {
        const result = classifyMessage('5000 * 5.23 = 26150', defaultContext)
        expect(result.messageType).toBe('quote_calculation')
      })
    })

    describe('Bot command classification', () => {
      it('classifies "/compra" as bot_command', () => {
        const result = classifyMessage('/compra', defaultContext)
        expect(result.messageType).toBe('bot_command')
        expect(result.confidence).toBe('high')
      })

      it('classifies "/saldo" as bot_command', () => {
        const result = classifyMessage('/saldo', defaultContext)
        expect(result.messageType).toBe('bot_command')
      })

      it('classifies "/saldof" as bot_command', () => {
        const result = classifyMessage('/saldof', defaultContext)
        expect(result.messageType).toBe('bot_command')
      })
    })

    describe('Bot confirmation classification', () => {
      it('classifies "Compra Registrada..." as bot_confirmation', () => {
        const result = classifyMessage('Compra Registrada 5000 USDT> 5.2300 > R$26150.00 BRL', defaultContext)
        expect(result.messageType).toBe('bot_confirmation')
        expect(result.confidence).toBe('high')
      })
    })

    describe('Balance report classification', () => {
      it('classifies "Saldo Atual 60917.25 BRL" as balance_report', () => {
        const result = classifyMessage('Saldo Atual 60917.25 BRL', defaultContext)
        expect(result.messageType).toBe('balance_report')
        expect(result.confidence).toBe('high')
      })
    })

    describe('English price requests', () => {
      it('classifies "price?" as price_request', () => {
        const result = classifyMessage('price?', defaultContext)
        expect(result.messageType).toBe('price_request')
      })

      it('classifies "price？" (fullwidth) as price_request', () => {
        const result = classifyMessage('price？', defaultContext)
        expect(result.messageType).toBe('price_request')
      })

      it('classifies "tx pls" as price_request', () => {
        const result = classifyMessage('tx pls', defaultContext)
        expect(result.messageType).toBe('price_request')
      })

      it('classifies "Tx please" as price_request', () => {
        const result = classifyMessage('Tx please', defaultContext)
        expect(result.messageType).toBe('price_request')
      })
    })

    describe('Enhanced confirmation patterns', () => {
      it('classifies "Fecha" as confirmation', () => {
        const result = classifyMessage('Fecha', defaultContext)
        expect(result.messageType).toBe('confirmation')
      })

      it('classifies "Fecha?" as confirmation', () => {
        const result = classifyMessage('Fecha?', defaultContext)
        expect(result.messageType).toBe('confirmation')
      })

      it('classifies "fechar agora" as confirmation', () => {
        const result = classifyMessage('fechar agora', defaultContext)
        expect(result.messageType).toBe('confirmation')
      })

      it('classifies "Ok obg" as confirmation', () => {
        const result = classifyMessage('Ok obg', defaultContext)
        expect(result.messageType).toBe('confirmation')
      })
    })

    describe('Priority order', () => {
      it('bot > receipt > tronscan > price > volume', () => {
        // Bot has highest priority
        const botResult = classifyMessage('test', {
          isFromBot: true,
          hasReceipt: true,
          hasTronscan: true,
          hasPriceTrigger: true,
        })
        expect(botResult.messageType).toBe('price_response')

        // Receipt is second
        const receiptResult = classifyMessage('test', {
          isFromBot: false,
          hasReceipt: true,
          hasTronscan: true,
          hasPriceTrigger: true,
        })
        expect(receiptResult.messageType).toBe('receipt')

        // Tronscan is third
        const tronscanResult = classifyMessage('test', {
          isFromBot: false,
          hasReceipt: false,
          hasTronscan: true,
          hasPriceTrigger: true,
        })
        expect(tronscanResult.messageType).toBe('tronscan')

        // Price trigger is fourth
        const priceResult = classifyMessage('compro 10k', {
          isFromBot: false,
          hasReceipt: false,
          hasTronscan: false,
          hasPriceTrigger: true,
        })
        expect(priceResult.messageType).toBe('price_request')
      })
    })
  })

  describe('extractVolumeUsdt', () => {
    it('extracts from "862 usdt"', () => {
      expect(extractVolumeUsdt('862 usdt')).toBe(862)
    })

    it('extracts from "500u"', () => {
      expect(extractVolumeUsdt('500u')).toBe(500)
    })

    it('extracts from "1000 usd"', () => {
      expect(extractVolumeUsdt('1000 usd')).toBe(1000)
    })

    it('extracts from "2k usdt"', () => {
      expect(extractVolumeUsdt('2k usdt')).toBe(2000)
    })

    it('extracts from "1.5k usdt"', () => {
      expect(extractVolumeUsdt('1.5k usdt')).toBe(1500)
    })

    it('extracts from "usdt 500"', () => {
      expect(extractVolumeUsdt('usdt 500')).toBe(500)
    })

    it('returns null for no USDT amount', () => {
      expect(extractVolumeUsdt('hello world')).toBeNull()
    })

    it('returns null for BRL only', () => {
      expect(extractVolumeUsdt('5000 reais')).toBeNull()
    })

    // Party-mode fix: 'mil' (Portuguese thousand) support
    it('extracts from "5 mil usdt"', () => {
      expect(extractVolumeUsdt('5 mil usdt')).toBe(5000)
    })

    it('extracts from "2,5 mil usd"', () => {
      expect(extractVolumeUsdt('2,5 mil usd')).toBe(2500)
    })
  })

  describe('inferPlayerRole', () => {
    const createMessages = (types: OTCMessageType[]): { content: string; messageType: OTCMessageType }[] => {
      return types.map(type => ({ content: 'test', messageType: type }))
    }

    describe('AC5: Operator detection', () => {
      it('returns operator for frequent price responders', () => {
        const messages = createMessages([
          'price_response',
          'price_response',
          'price_response',
          'general',
          'general',
        ])
        const result = inferPlayerRole({
          playerJid: 'test@s.whatsapp.net',
          groupId: 'group@g.us',
          recentMessages: messages,
        })
        expect(result).toBe('operator')
      })

      it('returns operator when > 30% are price responses', () => {
        const messages = createMessages([
          'price_response',
          'price_response',
          'general',
          'general',
          'general',
          'general',
        ])
        const result = inferPlayerRole({
          playerJid: 'test@s.whatsapp.net',
          groupId: 'group@g.us',
          recentMessages: messages,
        })
        expect(result).toBe('operator')
      })

      it('returns operator for quote_calculation senders', () => {
        const messages = createMessages([
          'quote_calculation',
          'quote_calculation',
          'tronscan',
          'general',
          'general',
        ])
        const result = inferPlayerRole({
          playerJid: 'test@s.whatsapp.net',
          groupId: 'group@g.us',
          recentMessages: messages,
        })
        expect(result).toBe('operator')
      })
    })

    describe('Client detection', () => {
      it('returns client for frequent requesters', () => {
        const messages = createMessages([
          'price_request',
          'price_request',
          'volume_inquiry',
          'confirmation',
          'general',
        ])
        const result = inferPlayerRole({
          playerJid: 'test@s.whatsapp.net',
          groupId: 'group@g.us',
          recentMessages: messages,
        })
        expect(result).toBe('client')
      })

      it('returns client when > 60% are client-type messages', () => {
        const messages = createMessages([
          'price_request',
          'volume_inquiry',
          'volume_inquiry',
          'confirmation',
          'general',
        ])
        const result = inferPlayerRole({
          playerJid: 'test@s.whatsapp.net',
          groupId: 'group@g.us',
          recentMessages: messages,
        })
        expect(result).toBe('client')
      })

      it('returns client for price_lock and bot_command senders', () => {
        const messages = createMessages([
          'price_lock',
          'price_lock',
          'bot_command',
          'confirmation',
          'general',
        ])
        const result = inferPlayerRole({
          playerJid: 'test@s.whatsapp.net',
          groupId: 'group@g.us',
          recentMessages: messages,
        })
        expect(result).toBe('client')
      })
    })

    describe('Unknown detection', () => {
      it('returns unknown for insufficient data', () => {
        const messages = createMessages(['general', 'general', 'general'])
        const result = inferPlayerRole({
          playerJid: 'test@s.whatsapp.net',
          groupId: 'group@g.us',
          recentMessages: messages,
        })
        expect(result).toBe('unknown')
      })

      it('returns unknown for mixed behavior', () => {
        const messages = createMessages([
          'general',
          'general',
          'general',
          'general',
          'general',
        ])
        const result = inferPlayerRole({
          playerJid: 'test@s.whatsapp.net',
          groupId: 'group@g.us',
          recentMessages: messages,
        })
        expect(result).toBe('unknown')
      })
    })
  })

  describe('getContentPreview', () => {
    it('returns full content if under limit', () => {
      const content = 'short message'
      expect(getContentPreview(content, 100)).toBe(content)
    })

    it('truncates at word boundary', () => {
      const content = 'this is a longer message that needs to be truncated at a reasonable point'
      const preview = getContentPreview(content, 50)
      expect(preview.length).toBeLessThanOrEqual(53) // 50 + '...'
      expect(preview).toContain('...')
    })

    it('truncates long word correctly', () => {
      const content = 'a'.repeat(150)
      const preview = getContentPreview(content, 100)
      expect(preview).toBe('a'.repeat(100) + '...')
    })

    it('uses default max length of 100', () => {
      const content = 'a'.repeat(150)
      const preview = getContentPreview(content)
      expect(preview.length).toBe(103) // 100 + '...'
    })
  })

  describe('exported constants', () => {
    it('DEFAULT_PREVIEW_MAX_LENGTH is 100', () => {
      expect(DEFAULT_PREVIEW_MAX_LENGTH).toBe(100)
    })

    it('OPERATOR_RESPONSE_RATIO_THRESHOLD is 0.3', () => {
      expect(OPERATOR_RESPONSE_RATIO_THRESHOLD).toBe(0.3)
    })

    it('CLIENT_MESSAGE_RATIO_THRESHOLD is 0.6', () => {
      expect(CLIENT_MESSAGE_RATIO_THRESHOLD).toBe(0.6)
    })

    it('MIN_MESSAGES_FOR_ROLE_INFERENCE is 5', () => {
      expect(MIN_MESSAGES_FOR_ROLE_INFERENCE).toBe(5)
    })
  })
})
