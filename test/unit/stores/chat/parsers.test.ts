import type { Content } from '../../../../frontend/src/types'
import {
  contentToMessageEnhanced,
  isOnlyFunctionResponse
} from '../../../../frontend/src/stores/chat/parsers'

describe('chat parsers function response visibility', () => {
  it('does not treat empty parts as a pure functionResponse message', () => {
    const content: Content = {
      role: 'model',
      parts: []
    }

    expect(isOnlyFunctionResponse(content)).toBe(false)
    expect(contentToMessageEnhanced(content).isFunctionResponse).toBe(false)
  })

  it('treats non-empty pure functionResponse parts as hidden function responses', () => {
    const content: Content = {
      role: 'model',
      parts: [
        {
          functionResponse: {
            id: 'tool-1',
            name: 'create_plan',
            response: { success: true }
          }
        }
      ]
    }

    expect(isOnlyFunctionResponse(content)).toBe(true)
    expect(contentToMessageEnhanced(content).isFunctionResponse).toBe(true)
  })

  it('keeps mixed text and functionResponse parts visible', () => {
    const content: Content = {
      role: 'model',
      parts: [
        { text: 'visible text' },
        {
          functionResponse: {
            id: 'tool-2',
            name: 'update_plan',
            response: { success: true }
          }
        }
      ]
    }

    expect(isOnlyFunctionResponse(content)).toBe(false)
    expect(contentToMessageEnhanced(content).isFunctionResponse).toBe(false)
  })

  it('still respects an explicit backend isFunctionResponse flag', () => {
    const content: Content = {
      role: 'model',
      parts: [],
      isFunctionResponse: true
    }

    expect(contentToMessageEnhanced(content).isFunctionResponse).toBe(true)
  })
})
