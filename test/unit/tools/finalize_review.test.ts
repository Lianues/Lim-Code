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

import { appendReviewMilestone, buildInitialReviewDocument } from '../../../backend/tools/review/reviewDocumentSection'
import { createFinalizeReviewTool } from '../../../backend/tools/review/finalize_review'

describe('finalize_review tool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllWorkspaces.mockReturnValue([{ name: 'workspace' }])
    mockResolveUriWithInfo.mockReturnValue({
      uri: { fsPath: 'D:/workspace/.limcode/review/workspace-review.md' },
      error: undefined
    })
  })

  it('finalizes a V4 review document and updates reviewSession state', async () => {
    const initialContent = buildInitialReviewDocument({
      title: 'Workspace Review',
      overview: 'End-to-end review',
      review: 'Initial scope'
    })
    const withMilestones = appendReviewMilestone(initialContent, {
      milestoneTitle: 'Review tools module',
      summary: 'Checked review tool registration.',
      status: 'in_progress',
      reviewedModules: ['tools'],
      structuredFindings: [
        {
          severity: 'medium',
          category: 'maintainability',
          title: 'Need backend review tools.'
        }
      ]
    }).content

    mockReadFile.mockResolvedValueOnce(new TextEncoder().encode(withMilestones))

    const tool = createFinalizeReviewTool()
    const setCustomMetadata = jest.fn().mockResolvedValue(undefined)
    const result = await tool.handler({
      path: '.limcode/review/workspace-review.md',
      conclusion: 'Static review passed with one medium-risk follow-up item.',
      overallDecision: 'conditionally_accepted',
      recommendedNextAction: 'Fix the medium-risk item and run manual browser validation.',
      reviewedModules: ['integration']
    }, {
      conversationId: 'conversation-1',
      conversationStore: {
        getCustomMetadata: jest.fn().mockResolvedValue({
          reviewRunId: 'review-1',
          reviewPath: '.limcode/review/workspace-review.md',
          status: 'in_progress',
          createdAt: '2026-03-17T00:00:00.000Z',
          finalizedAt: null
        }),
        setCustomMetadata
      }
    } as any)

    expect(result.success).toBe(true)
    expect((result.data as any).reviewSnapshot.status).toBe('completed')
    expect((result.data as any).reviewSnapshot.finalizedAt).toBeTruthy()
    expect((result.data as any).reviewSnapshot.render.locale).toBe('zh-CN')
    expect((result.data as any).reviewDelta).toMatchObject({ type: 'finalized' })
    expect((result.data as any).status).toBe('completed')
    expect((result.data as any).overallDecision).toBe('conditionally_accepted')
    expect((result.data as any).totalMilestones).toBe(1)
    expect((result.data as any).totalFindings).toBe(1)
    expect((result.data as any).reviewedModules).toEqual(['tools', 'integration'])
    expect((result.data as any).content).toContain('## 最终结论')
    expect((result.data as any).content).toContain('Static review passed with one medium-risk follow-up item.')
    expect((result.data as any).content).toContain('## 评审快照')

    expect(setCustomMetadata).toHaveBeenCalledWith(
      'conversation-1',
      'reviewSession',
      expect.objectContaining({
        reviewPath: '.limcode/review/workspace-review.md',
        status: 'completed'
      })
    )
    expect(mockSyncProgressFromReviewArtifact).toHaveBeenCalledWith({
      reviewPath: '.limcode/review/workspace-review.md',
      title: 'Workspace Review',
      latestConclusion: 'Static review passed with one medium-risk follow-up item.',
      nextAction: 'Fix the medium-risk item and run manual browser validation.',
      eventMessage: '同步审查结论：.limcode/review/workspace-review.md'
    })
  })

  it('rejects invalid review paths', async () => {
    const tool = createFinalizeReviewTool()
    const result = await tool.handler({
      path: '.limcode/design/not-allowed.md',
      conclusion: 'Should fail.'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('.limcode/review/**.md')
    expect(mockResolveUriWithInfo).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
