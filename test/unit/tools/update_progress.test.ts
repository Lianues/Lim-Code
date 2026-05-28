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
import { createUpdateProgressTool } from '../../../backend/tools/progress/update_progress'

describe('update_progress tool', () => {
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
      phase: 'plan',
      currentFocus: '旧焦点',
      nextAction: '继续整理方案',
      activeArtifacts: {
        plan: '.limcode/plans/project-progress-document-tools-and-summary-card.plan.md'
      },
      todos: [
        { id: 'progress-01', content: '实现后端基础层', status: 'pending' }
      ],
      risks: [],
      milestones: [],
      log: []
    }).content

    mockReadFile.mockResolvedValue(new TextEncoder().encode(existing))
  })

  it('updates summary fields, artifact snapshot, and recent logs', async () => {
    const tool = createUpdateProgressTool()
    const result = await tool.handler({
      phase: 'implementation',
      currentFocus: '实现后端 Progress 工具',
      latestConclusion: '后端结构已经开始实现。',
      nextAction: '继续补齐路径校验与工具注册。',
      appendLog: [
        { type: 'updated', message: '切换到实现阶段' }
      ]
    })

    expect(result.success).toBe(true)
    expect((result.data as any).progressSnapshot).toMatchObject({
      path: '.limcode/progress.md',
      phase: 'implementation',
      currentFocus: '实现后端 Progress 工具',
      latestConclusion: '后端结构已经开始实现。',
      nextAction: '继续补齐路径校验与工具注册。'
    })
    expect((result.data as any).progressDelta).toMatchObject({
      type: 'updated'
    })

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const writtenContent = Buffer.from(mockWriteFile.mock.calls[0][1]).toString('utf-8')
    expect(writtenContent).toContain('实现后端 Progress 工具')
    expect(writtenContent).toContain('后端结构已经开始实现。')
    expect(writtenContent).toContain('切换到实现阶段')
  })

  it('rejects when the target progress file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('File not found'))

    const tool = createUpdateProgressTool()
    const result = await tool.handler({
      currentFocus: '更新失败场景'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('File not found')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('rejects invalid progress path values', async () => {
    const tool = createUpdateProgressTool()
    const result = await tool.handler({
      path: '.limcode/plans/not-allowed.md',
      currentFocus: '非法路径'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('.limcode/progress.md')
    expect(mockResolveUriWithInfo).not.toHaveBeenCalled()
  })
})
