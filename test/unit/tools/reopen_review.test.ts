const mockReadFile = jest.fn()
const mockWriteFile = jest.fn().mockResolvedValue(undefined)
const mockGetAllWorkspaces = jest.fn()
const mockResolveUriWithInfo = jest.fn()
const mockNormalizeLineEndingsToLF = jest.fn((input: string) => input.replace(/\r\n?/g, '\n'))
const mockSyncProgressFromReviewArtifact = jest.fn().mockResolvedValue([])

jest.mock('vscode', () => ({
  workspace: {
    fs: {
      readFile: mockReadFile,
      writeFile: mockWriteFile
    }
  }
}))

jest.mock('../../../backend/tools/utils', () => {
  // WP13b：集中构造 tools/utils mock；escapeRegExp 通过 jest.requireActual 复用真实实现，不在 mock 中复制。
  const { createBackendToolsUtilsMock } = require('../../../backend/__tests__/helpers/backendToolsUtilsMock')
  return createBackendToolsUtilsMock({
    getAllWorkspaces: (...args: any[]) => mockGetAllWorkspaces(...args),
    resolveUriWithInfo: (...args: any[]) => mockResolveUriWithInfo(...args),
    normalizeLineEndingsToLF: (input: string) => mockNormalizeLineEndingsToLF(input)
  })
})

jest.mock('../../../backend/tools/progress/autoSync', () => ({
  syncProgressFromReviewArtifact: (...args: any[]) => mockSyncProgressFromReviewArtifact(...args)
}))

import {
  appendReviewMilestone,
  buildInitialReviewDocument,
  finalizeReviewDocument
} from '../../../backend/tools/review/reviewDocumentSection'
import { createReopenReviewTool } from '../../../backend/tools/review/reopen_review'

describe('reopen_review tool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllWorkspaces.mockReturnValue([{ name: 'workspace' }])
    mockResolveUriWithInfo.mockReturnValue({
      uri: { fsPath: 'D:/workspace/.limcode/review/workspace-review.md' },
      error: undefined
    })
  })

  it('reopens a completed V4 review document and updates reviewSession state', async () => {
    const initialContent = buildInitialReviewDocument({
      title: 'Workspace Review',
      overview: 'End-to-end review',
      review: 'Initial scope'
    })
    const withMilestone = appendReviewMilestone(initialContent, {
      milestoneTitle: 'Review tools module',
      summary: 'Checked review tools.',
      status: 'completed',
      reviewedModules: ['backend/tools/review']
    }).content
    const finalizedContent = finalizeReviewDocument(withMilestone, {
      conclusion: 'Follow-up work is still required.',
      overallDecision: 'needs_follow_up'
    }).content

    mockReadFile.mockResolvedValueOnce(new TextEncoder().encode(finalizedContent))

    const tool = createReopenReviewTool()
    const setCustomMetadata = jest.fn().mockResolvedValue(undefined)
    const result = await tool.handler({
      path: '.limcode/review/workspace-review.md'
    }, {
      conversationId: 'conversation-1',
      conversationStore: {
        getCustomMetadata: jest.fn().mockResolvedValue({
          reviewRunId: 'review-1',
          reviewPath: '.limcode/review/workspace-review.md',
          status: 'completed',
          createdAt: '2026-03-17T00:00:00.000Z',
          finalizedAt: '2026-03-17T01:00:00.000Z'
        }),
        setCustomMetadata
      }
    } as any)

    expect(result.success).toBe(true)
    expect((result.data as any).reviewSnapshot.status).toBe('in_progress')
    expect((result.data as any).reviewSnapshot.finalizedAt).toBeNull()
    expect((result.data as any).reviewSnapshot.render.locale).toBe('zh-CN')
    expect((result.data as any).overallDecision).toBeNull()
    expect((result.data as any).reviewDelta).toMatchObject({ type: 'reopened' })
    expect((result.data as any).content).toContain('- 状态: 进行中')
    expect((result.data as any).content).toContain('- 总体结论: 待定')

    expect(setCustomMetadata).toHaveBeenCalledWith(
      'conversation-1',
      'reviewSession',
      expect.objectContaining({
        reviewPath: '.limcode/review/workspace-review.md',
        status: 'in_progress',
        finalizedAt: null
      })
    )
    expect(mockSyncProgressFromReviewArtifact).toHaveBeenCalledWith({
      reviewPath: '.limcode/review/workspace-review.md',
      title: 'Workspace Review',
      eventMessage: '重新打开审查：.limcode/review/workspace-review.md'
    })
  })

  it('rejects reopen when another active review session already exists', async () => {
    const tool = createReopenReviewTool()
    const result = await tool.handler({
      path: '.limcode/review/workspace-review.md'
    }, {
      conversationId: 'conversation-1',
      conversationStore: {
        getCustomMetadata: jest.fn().mockResolvedValue({
          reviewRunId: 'review-2',
          reviewPath: '.limcode/review/other-review.md',
          status: 'in_progress',
          createdAt: '2026-03-17T00:00:00.000Z',
          finalizedAt: null
        }),
        setCustomMetadata: jest.fn()
      }
    } as any)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Another active review session already exists')
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('rejects invalid review paths', async () => {
    const tool = createReopenReviewTool()
    const result = await tool.handler({
      path: '.limcode/design/not-allowed.md'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('.limcode/review/**.md')
    expect(mockResolveUriWithInfo).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
