import { describe, it, expect } from 'vitest'
import { createMockSocket } from './simulatorSocket.js'

describe('createMockSocket', () => {
  const GROUP_ID = '120363000000000000@g.us'
  const GROUP_NAME = 'Test Group'

  it('returns a socket with _simulatorMode flag', () => {
    const { sock } = createMockSocket(GROUP_ID, GROUP_NAME)
    expect((sock as any)._simulatorMode).toBe(true)
  })

  it('captures sendMessage calls', async () => {
    const { sock, getCapturedMessages } = createMockSocket(GROUP_ID, GROUP_NAME)

    await sock.sendMessage(GROUP_ID, { text: 'Hello' })
    await sock.sendMessage(GROUP_ID, { text: 'World', mentions: ['5511999@s.whatsapp.net'] })

    const captured = getCapturedMessages()
    expect(captured).toHaveLength(2)
    expect(captured[0].text).toBe('Hello')
    expect(captured[0].jid).toBe(GROUP_ID)
    expect(captured[0].mentions).toEqual([])
    expect(captured[1].text).toBe('World')
    expect(captured[1].mentions).toEqual(['5511999@s.whatsapp.net'])
  })

  it('handles empty text payload gracefully', async () => {
    const { sock, getCapturedMessages } = createMockSocket(GROUP_ID, GROUP_NAME)

    await sock.sendMessage(GROUP_ID, { text: '' } as any)

    const captured = getCapturedMessages()
    expect(captured).toHaveLength(1)
    expect(captured[0].text).toBe('')
  })

  it('sendPresenceUpdate is a no-op', async () => {
    const { sock } = createMockSocket(GROUP_ID, GROUP_NAME)
    // Should not throw
    await sock.sendPresenceUpdate('composing', GROUP_ID)
    await sock.sendPresenceUpdate('paused', GROUP_ID)
  })

  it('groupMetadata returns correct subject for known group', async () => {
    const { sock } = createMockSocket(GROUP_ID, GROUP_NAME)
    const meta = await sock.groupMetadata(GROUP_ID)
    expect(meta.subject).toBe(GROUP_NAME)
  })

  it('groupMetadata returns Unknown Group for other groups', async () => {
    const { sock } = createMockSocket(GROUP_ID, GROUP_NAME)
    const meta = await sock.groupMetadata('other-group@g.us')
    expect(meta.subject).toBe('Unknown Group')
  })

  it('starts with empty captured messages', () => {
    const { getCapturedMessages } = createMockSocket(GROUP_ID, GROUP_NAME)
    expect(getCapturedMessages()).toEqual([])
  })

  it('timestamps are monotonically increasing', async () => {
    const { sock, getCapturedMessages } = createMockSocket(GROUP_ID, GROUP_NAME)

    await sock.sendMessage(GROUP_ID, { text: 'first' })
    await sock.sendMessage(GROUP_ID, { text: 'second' })

    const captured = getCapturedMessages()
    expect(captured[1].timestamp).toBeGreaterThanOrEqual(captured[0].timestamp)
  })
})
