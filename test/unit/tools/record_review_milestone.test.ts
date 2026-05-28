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

import { buildInitialReviewDocument } from '../../../backend/tools/review/reviewDocumentSection'
import { createRecordReviewMilestoneTool } from '../../../backend/tools/review/record_review_milestone'

describe('record_review_milestone tool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllWorkspaces.mockReturnValue([{ name: 'workspace' }])
    mockResolveUriWithInfo.mockReturnValue({
      uri: { fsPath: 'D:/workspace/.limcode/review/workspace-review.md' },
      error: undefined
    })
  })

  it('appends milestones to a V4 review document and returns snapshot-driven result fields', async () => {
    const initialContent = buildInitialReviewDocument({
      title: 'Workspace Review',
      overview: 'End-to-end review',
      review: 'Initial scope'
    })

    mockReadFile.mockResolvedValueOnce(new TextEncoder().encode(initialContent))

    const tool = createRecordReviewMilestoneTool()
    const setCustomMetadata = jest.fn().mockResolvedValue(undefined)

    const result = await tool.handler({
      path: '.limcode/review/workspace-review.md',
      milestoneTitle: 'Review settings module',
      summary: 'Checked mode config and sync logic.',
      status: 'completed',
      conclusion: 'Settings review completed',
      evidenceFiles: ['backend/modules/settings/types.ts'],
      reviewedModules: ['settings'],
      recommendedNextAction: 'Review backend tools next.',
      findings: ['Review mode is missing.'],
      structuredFindings: [{
        title: 'Selection context action lacks evidence details.',
        category: 'maintainability',
        severity: 'medium',
        evidence: [{ path: 'frontend/src/App.vue', lineStart: 10, lineEnd: 12, symbol: 'renderApp' }]
      }]
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
    expect((result.data as any).milestoneId).toBe('M1')
    expect((result.data as any).reviewSnapshot.formatVersion).toBe(4)
    expect((result.data as any).reviewDelta).toMatchObject({
      type: 'milestone_recorded',
      milestoneId: 'M1'
    })
    expect((result.data as any).totalMilestones).toBe(1)
    expect((result.data as any).completedMilestones).toBe(1)
    expect((result.data as any).totalFindings).toBe(2)
    expect((result.data as any).findingsBySeverity).toEqual({ high: 0, medium: 1, low: 1 })
    expect((result.data as any).reviewedModules).toEqual(['settings'])
    expect((result.data as any).reviewSnapshot.render.locale).toBe('zh-CN')
    expect((result.data as any).content).toContain('## 评审快照')
    expect((result.data as any).content).toContain('### M1 · Review settings module')
    expect((result.data as any).content).toContain('### Review mode is missing.')
    expect((result.data as any).content).toContain('- ID: F-review-mode-is-missing')
    expect((result.data as any).content).toContain('frontend/src/App.vue:10-12#renderApp')

    expect(setCustomMetadata).toHaveBeenCalledWith(
      'conversation-1',
      'reviewSession',
      expect.objectContaining({
        reviewPath: '.limcode/review/workspace-review.md',
        status: 'in_progress'
      })
    )
    expect(mockSyncProgressFromReviewArtifact).toHaveBeenCalledWith({
      reviewPath: '.limcode/review/workspace-review.md',
      title: 'Workspace Review',
      latestConclusion: 'Settings review completed',
      nextAction: 'Review backend tools next.',
      eventMessage: '同步审查里程碑：M1'
    })
  })

  it('upgrades legacy review documents to V4 before writing milestones', async () => {
    mockReadFile.mockResolvedValueOnce(new TextEncoder().encode([
      '# Review',
      '- Date: 2025-01-01',
      '- Overview: Manual review',
      '- Status: in_progress',
      '',
      '## Review Plan',
      'Inspect frontend output.',
      '',
      '## Findings',
      '- Existing loose note',
      ''
    ].join('\n')))

    const tool = createRecordReviewMilestoneTool()
    const result = await tool.handler({
      path: '.limcode/review/workspace-review.md',
      milestoneTitle: 'Review legacy document',
      summary: 'Backfilled structured sections.'
    })

    expect(result.success).toBe(true)
    expect((result.data as any).reviewSnapshot.formatVersion).toBe(4)
    expect((result.data as any).reviewValidation.detectedFormat).toBe('v4')
    expect((result.data as any).content).toContain('## 评审范围')
    expect((result.data as any).content).toContain('Inspect frontend output.')
    expect((result.data as any).content).toContain('## 评审快照')
    expect((result.data as any).content).not.toContain('## Review Plan')
  })

  it('rejects writes to finalized review documents', async () => {
    const finalizedContent = buildInitialReviewDocument({
      title: 'Workspace Review',
      overview: 'End-to-end review',
      review: 'Initial scope'
    }).replace('"status": "in_progress"', '"status": "completed"')
      .replace('"finalizedAt": null', '"finalizedAt": "2025-01-01T01:00:00.000Z"')
      .replace('"latestConclusion": null', '"latestConclusion": "Done"')
      .replace('- Status: In Progress', '- Status: Completed')
      .replace('- Overall decision: Pending', '- Overall decision: Accepted')

    mockReadFile.mockResolvedValueOnce(new TextEncoder().encode(finalizedContent))

    const tool = createRecordReviewMilestoneTool()
    const result = await tool.handler({
      path: '.limcode/review/workspace-review.md',
      milestoneTitle: 'Should fail',
      summary: 'Should fail.'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('finalized review document')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('rejects path mismatches against the active review session', async () => {
    const tool = createRecordReviewMilestoneTool()
    const result = await tool.handler({
      path: '.limcode/review/workspace-review.md',
      milestoneTitle: 'Invalid session path',
      summary: 'Should fail.'
    }, {
      conversationId: 'conversation-1',
      conversationStore: {
        getCustomMetadata: jest.fn().mockResolvedValue({
          reviewRunId: 'review-1',
          reviewPath: '.limcode/review/other-review.md',
          status: 'in_progress',
          createdAt: '2026-03-17T00:00:00.000Z',
          finalizedAt: null
        }),
        setCustomMetadata: jest.fn()
      }
    } as any)

    expect(result.success).toBe(false)
    expect(result.error).toContain('path mismatch')
    expect(mockReadFile).not.toHaveBeenCalled()
  })
})
