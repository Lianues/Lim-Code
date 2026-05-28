const mockCreateDirectory = jest.fn().mockResolvedValue(undefined)
const mockWriteFile = jest.fn().mockResolvedValue(undefined)
const mockGetAllWorkspaces = jest.fn()
const mockResolveUriWithInfo = jest.fn()
const mockSyncProgressFromReviewArtifact = jest.fn().mockResolvedValue([])

jest.mock('vscode', () => ({
  workspace: {
    fs: {
      createDirectory: mockCreateDirectory,
      writeFile: mockWriteFile
    }
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath })
  }
}))

jest.mock('../../../backend/tools/utils', () => {
  // WP13b：集中构造 tools/utils mock；escapeRegExp 通过 jest.requireActual 复用真实实现，不在 mock 中复制。
  const { createBackendToolsUtilsMock } = require('../../../backend/__tests__/helpers/backendToolsUtilsMock')
  return createBackendToolsUtilsMock({
    getAllWorkspaces: (...args: any[]) => mockGetAllWorkspaces(...args),
    resolveUriWithInfo: (...args: any[]) => mockResolveUriWithInfo(...args),
    createDirectory: mockCreateDirectory
  })
})

jest.mock('../../../backend/tools/progress/autoSync', () => ({
  syncProgressFromReviewArtifact: (...args: any[]) => mockSyncProgressFromReviewArtifact(...args)
}))

import { createCreateReviewTool } from '../../../backend/tools/review/create_review'

describe('create_review tool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllWorkspaces.mockReturnValue([{ name: 'workspace' }])
    mockResolveUriWithInfo.mockReturnValue({
      uri: { fsPath: 'D:/workspace/.limcode/review/workspace-review.md' },
      error: undefined
    })
  })

  it('writes a V4 review markdown document and returns snapshot-driven summary fields', async () => {
    const tool = createCreateReviewTool()
    const setCustomMetadata = jest.fn().mockResolvedValue(undefined)
    const result = await tool.handler({
      title: 'Workspace Review',
      overview: 'Review the current workspace end-to-end',
      review: 'Initial review scope'
    }, {
      conversationId: 'conversation-1',
      conversationStore: {
        getCustomMetadata: jest.fn().mockResolvedValue(null),
        setCustomMetadata
      }
    } as any)

    expect(result.success).toBe(true)
    expect(result.requiresUserConfirmation).toBeUndefined()
    expect((result.data as any).path).toBe('.limcode/review/workspace-review.md')
    expect((result.data as any).content).toContain('# Workspace Review')
    expect((result.data as any).content).toContain('## 评审快照')
    expect((result.data as any).content).toContain('```json')
    expect((result.data as any).content).toContain('"formatVersion": 4')
    expect((result.data as any).reviewSnapshot.formatVersion).toBe(4)
    expect((result.data as any).reviewSnapshot.render.locale).toBe('zh-CN')
    expect((result.data as any).reviewValidation.detectedFormat).toBe('v4')
    expect((result.data as any).reviewDelta).toMatchObject({ type: 'created' })
    expect((result.data as any).title).toBe('Workspace Review')
    expect((result.data as any).status).toBe('in_progress')
    expect((result.data as any).totalMilestones).toBe(0)
    expect((result.data as any).totalFindings).toBe(0)

    expect(setCustomMetadata).toHaveBeenCalledWith(
      'conversation-1',
      'reviewSession',
      expect.objectContaining({
        reviewPath: '.limcode/review/workspace-review.md',
        status: 'in_progress'
      })
    )
    expect(mockCreateDirectory).toHaveBeenCalledWith({
      fsPath: 'D:/workspace/.limcode/review'
    })
    expect(mockResolveUriWithInfo).toHaveBeenCalledWith('.limcode/review/workspace-review.md')
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    expect(mockSyncProgressFromReviewArtifact).toHaveBeenCalledWith({
      reviewPath: '.limcode/review/workspace-review.md',
      title: 'Workspace Review',
      eventMessage: '同步审查文档：.limcode/review/workspace-review.md'
    })
  })

  it('rejects create_review when the conversation already has an active review session', async () => {
    const tool = createCreateReviewTool()
    const result = await tool.handler({
      review: '# Review'
    }, {
      conversationId: 'conversation-1',
      conversationStore: {
        getCustomMetadata: jest.fn().mockResolvedValue({
          reviewRunId: 'review-1',
          reviewPath: '.limcode/review/existing.md',
          status: 'in_progress',
          createdAt: '2026-03-17T00:00:00.000Z',
          finalizedAt: null
        }),
        setCustomMetadata: jest.fn()
      }
    } as any)

    expect(result.success).toBe(false)
    expect(result.error).toContain('active review session already exists')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('rejects paths outside .limcode/review', async () => {
    const tool = createCreateReviewTool()
    const result = await tool.handler({
      review: '# Invalid',
      path: '.limcode/plans/not-allowed.md'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('.limcode/review/**.md')
    expect(mockResolveUriWithInfo).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
