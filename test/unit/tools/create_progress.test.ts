const mockCreateDirectory = jest.fn().mockResolvedValue(undefined)
const mockReadFile = jest.fn()
const mockWriteFile = jest.fn().mockResolvedValue(undefined)
const mockGetAllWorkspaces = jest.fn()
const mockResolveUriWithInfo = jest.fn()
const mockNormalizeLineEndingsToLF = jest.fn((input: string) => input.replace(/\r\n?/g, '\n'))

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
import { createCreateProgressTool } from '../../../backend/tools/progress/create_progress'

describe('create_progress tool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllWorkspaces.mockReturnValue([{ name: 'workspace' }])
    mockResolveUriWithInfo.mockImplementation((targetPath: string) => ({
      uri: { fsPath: `D:/workspace/${targetPath}` },
      error: undefined
    }))
    mockReadFile.mockRejectedValue(new Error('File not found'))
  })

  it('creates the progress document and returns a lightweight snapshot', async () => {
    const tool = createCreateProgressTool()
    const result = await tool.handler({
      projectName: 'Workspace',
      phase: 'plan',
      currentFocus: '整理项目实现范围',
      latestConclusion: '已确认需要新增 Progress 能力。',
      nextAction: '开始实现后端基础结构。',
      activeArtifacts: {
        plan: '.limcode/plans/project-progress-document-tools-and-summary-card.plan.md'
      },
      todos: [
        { id: 'progress-01', content: '实现后端基础层', status: 'pending' }
      ],
      risks: [
        { id: 'risk-01', title: '范围控制', status: 'active', description: '需要避免无关范围膨胀' }
      ]
    })

    expect(result.success).toBe(true)
    expect(result.requiresUserConfirmation).toBeUndefined()
    expect(result.data).toMatchObject({
      path: '.limcode/progress.md',
      status: 'active',
      phase: 'plan',
      currentFocus: '整理项目实现范围',
      latestConclusion: '已确认需要新增 Progress 能力。',
      nextAction: '开始实现后端基础结构。'
    })
    expect((result.data as any).progressSnapshot).toMatchObject({
      path: '.limcode/progress.md',
      projectName: 'Workspace',
      status: 'active',
      phase: 'plan',
      currentFocus: '整理项目实现范围',
      currentProgress: '尚无里程碑记录'
    })

    expect(mockCreateDirectory).toHaveBeenCalledWith({
      fsPath: 'D:/workspace/.limcode'
    })
    expect(mockWriteFile).toHaveBeenCalledTimes(1)

    const writtenContent = Buffer.from(mockWriteFile.mock.calls[0][1]).toString('utf-8')
    expect(writtenContent).toContain('# 项目进度')
    expect(writtenContent).toContain('## 当前摘要')
    expect(writtenContent).toContain('## 关联文档')
    expect(writtenContent).toContain('## 当前 TODO 快照')
    expect(writtenContent).toContain('## 项目里程碑')
    expect(writtenContent).toContain('## 风险与阻塞')
    expect(writtenContent).toContain('## 最近更新')
    expect(writtenContent).toContain('<!-- LIMCODE_PROGRESS_METADATA_START -->')
  })

  it('returns the existing snapshot when the progress document already exists and is valid', async () => {
    const existing = buildProgressDocument({
      projectId: 'workspace',
      projectName: 'Workspace',
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
      status: 'active',
      phase: 'design',
      activeArtifacts: {},
      todos: [],
      milestones: [],
      risks: [],
      log: []
    }).content
    mockReadFile.mockResolvedValue(new TextEncoder().encode(existing))

    const tool = createCreateProgressTool()
    const result = await tool.handler({ projectName: 'Workspace' })

    expect(result.success).toBe(true)
    expect((result.data as any).progressSnapshot).toMatchObject({ path: '.limcode/progress.md', projectName: 'Workspace' })
    expect((result.data as any).warnings).toEqual([
      'Progress document already exists at .limcode/progress.md. Returned the existing snapshot instead of creating a second file.'
    ])
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('rejects invalid paths outside .limcode/progress.md', async () => {
    const tool = createCreateProgressTool()
    const result = await tool.handler({
      path: '.limcode/review/not-allowed.md'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('.limcode/progress.md')
    expect(mockResolveUriWithInfo).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
