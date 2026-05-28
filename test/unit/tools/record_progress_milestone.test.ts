const mockCreateDirectory = jest.fn().mockResolvedValue(undefined)
const mockReadFile = jest.fn()
const mockWriteFile = jest.fn().mockResolvedValue(undefined)
const mockResolveUriWithInfo = jest.fn()
const mockNormalizeLineEndingsToLF = jest.fn((input: string) => input.replace(/\r\n?/g, '\n'))
const mockGetAllWorkspaces = jest.fn()

jest.mock('vscode', () => ({
  workspace: {
    fs: {
      createDirectory: mockCreateDirectory,
      readFile: mockReadFile,
      writeFile: mockWriteFile
    }
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath })
  }
}))

jest.mock('../../../backend/tools/utils', () => {
  // WP13b：集中构造 tools/utils mock，避免每个测试复制 ensureParentDir 实现。
  const { createBackendToolsUtilsMock } = require('../../../backend/__tests__/helpers/backendToolsUtilsMock')
  return createBackendToolsUtilsMock({
    getAllWorkspaces: (...args: any[]) => mockGetAllWorkspaces(...args),
    resolveUriWithInfo: (...args: any[]) => mockResolveUriWithInfo(...args),
    normalizeLineEndingsToLF: (input: string) => mockNormalizeLineEndingsToLF(input),
    createDirectory: mockCreateDirectory
  })
})

import { buildProgressDocument } from '../../../backend/tools/progress/documentLayout'
import { createRecordProgressMilestoneTool } from '../../../backend/tools/progress/record_progress_milestone'

describe('record_progress_milestone tool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllWorkspaces.mockReturnValue([{ name: 'workspace' }])
    mockResolveUriWithInfo.mockImplementation((targetPath: string) => ({
      uri: { fsPath: `D:/workspace/${targetPath}` },
      error: undefined
    }))

    const existing = buildProgressDocument({
      projectId: 'workspace',
      projectName: 'Workspace',
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
      status: 'active',
      phase: 'implementation',
      currentFocus: '实现 Progress 工具',
      activeArtifacts: {
        plan: '.limcode/plans/project-progress-document-tools-and-summary-card.plan.md'
      },
      todos: [
        { id: 'progress-01', content: '实现后端基础层', status: 'in_progress' }
      ],
      risks: [],
      milestones: [],
      log: []
    }).content

    mockReadFile.mockResolvedValue(new TextEncoder().encode(existing))
  })

  it('records a project milestone and returns the latest milestone snapshot', async () => {
    const tool = createRecordProgressMilestoneTool()
    const result = await tool.handler({
      title: '完成后端基础层',
      summary: '已完成 schema、documentLayout 与工具骨架。',
      status: 'completed',
      relatedTodoIds: ['progress-01'],
      latestConclusion: '后端基础层已经完成。',
      nextAction: '开始接入前端摘要卡片。'
    })

    expect(result.success).toBe(true)
    expect((result.data as any).progressDelta).toMatchObject({
      type: 'milestone_recorded',
      milestoneId: 'PG1'
    })
    expect((result.data as any).progressSnapshot).toMatchObject({
      path: '.limcode/progress.md',
      currentProgress: '1/1 个里程碑已完成；最新：PG1',
      latestConclusion: '后端基础层已经完成。',
      nextAction: '开始接入前端摘要卡片。',
      latestMilestone: {
        id: 'PG1',
        title: '完成后端基础层',
        status: 'completed'
      }
    })

    const writtenContent = Buffer.from(mockWriteFile.mock.calls[0][1]).toString('utf-8')
    expect(writtenContent).toContain('### PG1 · 完成后端基础层')
    expect(writtenContent).toContain('已完成 schema、documentLayout 与工具骨架。')
    expect(writtenContent).toContain('后端基础层已经完成。')
  })

  it('rejects duplicate milestone ids', async () => {
    const existing = buildProgressDocument({
      projectId: 'workspace',
      projectName: 'Workspace',
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
      status: 'active',
      phase: 'implementation',
      activeArtifacts: {},
      todos: [],
      risks: [],
      milestones: [{
        id: 'PG1',
        title: '已有里程碑',
        status: 'completed',
        summary: '已有摘要',
        relatedTodoIds: [],
        relatedReviewMilestoneIds: [],
        recordedAt: '2026-04-03T00:10:00.000Z',
        nextAction: null
      }],
      log: []
    }).content
    mockReadFile.mockResolvedValue(new TextEncoder().encode(existing))

    const tool = createRecordProgressMilestoneTool()
    const result = await tool.handler({
      milestoneId: 'PG1',
      title: '重复里程碑',
      summary: '不应成功'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('rejects invalid progress path values', async () => {
    const tool = createRecordProgressMilestoneTool()
    const result = await tool.handler({
      path: '.limcode/review/not-allowed.md',
      title: '非法路径',
      summary: '非法路径'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('.limcode/progress.md')
    expect(mockResolveUriWithInfo).not.toHaveBeenCalled()
  })
})
