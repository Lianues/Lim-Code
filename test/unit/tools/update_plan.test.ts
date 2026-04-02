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

jest.mock('../../../backend/tools/utils', () => ({
  getAllWorkspaces: (...args: any[]) => mockGetAllWorkspaces(...args),
  resolveUriWithInfo: (...args: any[]) => mockResolveUriWithInfo(...args),
  normalizeLineEndingsToLF: (input: string) => mockNormalizeLineEndingsToLF(input)
}))

import { createUpdatePlanTool } from '../../../backend/tools/plan/update_plan'

describe('update_plan tool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllWorkspaces.mockReturnValue([{ name: 'workspace' }])
    mockResolveUriWithInfo.mockImplementation((targetPath: string) => ({
      uri: { fsPath: `D:/workspace/${targetPath}` },
      error: undefined
    }))
    mockReadFile.mockResolvedValue(new TextEncoder().encode('# Existing Plan'))
  })

  it('rewrites an existing plan markdown document with normalized TODO section and requires confirmation in revision mode', async () => {
    const tool = createUpdatePlanTool()
    const result = await tool.handler({
      path: '.limcode/plans/api.plan.md',
      plan: '# Revised Plan\r\n\r\n- update flow',
      todos: [
        { id: 'api-1', content: '更新流程', status: 'in_progress' },
        { id: 'api-2', content: '补充测试', status: 'pending' }
      ],
      changeSummary: '调整执行顺序'
    })

    expect(result.success).toBe(true)
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.data).toEqual({
      path: '.limcode/plans/api.plan.md',
      content: expect.stringContaining('# Revised Plan\n\n- update flow'),
      todos: [
        { id: 'api-1', content: '更新流程', status: 'in_progress' },
        { id: 'api-2', content: '补充测试', status: 'pending' }
      ],
      updateMode: 'revision',
      changeSummary: '调整执行顺序'
    })
    expect(mockReadFile).toHaveBeenCalledWith({ fsPath: 'D:/workspace/.limcode/plans/api.plan.md' })
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
  })

  it('syncs only the TODO section in progress_sync mode and does not require confirmation', async () => {
    mockReadFile.mockResolvedValue(new TextEncoder().encode([
      '<!-- LIMCODE_SOURCE_ARTIFACT_START -->',
      '{"type":"design","path":".limcode/design/api.md","contentHash":"sha256:test"}',
      '<!-- LIMCODE_SOURCE_ARTIFACT_END -->',
      '',
      '## TODO LIST',
      '',
      '<!-- LIMCODE_TODO_LIST_START -->',
      '- [ ] 旧任务  `#old-1`',
      '<!-- LIMCODE_TODO_LIST_END -->',
      '',
      '# Existing Plan',
      '',
      '- keep body'
    ].join('\n')))

    const tool = createUpdatePlanTool()
    const result = await tool.handler({
      path: '.limcode/plans/api.plan.md',
      todos: [
        { id: 'api-1', content: '同步状态', status: 'completed' }
      ],
      updateMode: 'progress_sync'
    })

    expect(result.success).toBe(true)
    expect(result.requiresUserConfirmation).toBe(false)
    expect(result.data).toEqual({
      path: '.limcode/plans/api.plan.md',
      content: expect.stringContaining('# Existing Plan\n\n- keep body'),
      todos: [
        { id: 'api-1', content: '同步状态', status: 'completed' }
      ],
      updateMode: 'progress_sync',
      changeSummary: undefined
    })
    expect((result.data as any).content).toContain('<!-- LIMCODE_SOURCE_ARTIFACT_START -->')
    expect((result.data as any).content).toContain('`#api-1`')
    expect((result.data as any).content).not.toContain('`#old-1`')
  })

  it('rejects update_plan when the target plan file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('File not found'))

    const tool = createUpdatePlanTool()
    const result = await tool.handler({
      path: '.limcode/plans/api.plan.md',
      plan: '# Revised Plan',
      todos: [{ id: 'api-1', content: '更新流程', status: 'pending' }]
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('File not found')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('ignores sourceArtifact in progress_sync mode and returns a warning', async () => {
    mockReadFile.mockResolvedValue(new TextEncoder().encode([
      '<!-- LIMCODE_SOURCE_ARTIFACT_START -->',
      '{"type":"design","path":".limcode/design/api.md","contentHash":"sha256:test"}',
      '<!-- LIMCODE_SOURCE_ARTIFACT_END -->',
      '',
      '# Existing Plan',
      '',
      '正文内容'
    ].join('\n')))

    const tool = createUpdatePlanTool()
    const result = await tool.handler({
      path: '.limcode/plans/api.plan.md',
      todos: [{ id: 'api-1', content: '更新流程', status: 'pending' }],
      updateMode: 'progress_sync',
      sourceArtifact: {
        type: 'review',
        path: '.limcode/review/api.md'
      }
    })

    expect(result.success).toBe(true)
    expect(result.requiresUserConfirmation).toBe(false)
    expect((result.data as any).warnings).toEqual([
      "sourceArtifact was provided in progress_sync mode and has been ignored. Use updateMode: 'revision' if you need to change the plan source."
    ])
    expect((result.data as any).content).toContain('.limcode/design/api.md')
    expect((result.data as any).content).not.toContain('.limcode/review/api.md')
    expect(mockReadFile).toHaveBeenCalledTimes(1)
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
  })

  it('uses strict schema to reduce unexpected continuation carry-over fields', () => {
    const tool = createUpdatePlanTool()

    expect(tool.declaration.strict).toBe(true)
  })

  it('rejects paths outside .limcode/plans', async () => {
    const tool = createUpdatePlanTool()
    const result = await tool.handler({
      path: '.limcode/review/not-allowed.md',
      plan: '# Invalid',
      todos: [{ id: 'x', content: 'x', status: 'pending' }]
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('.limcode/plans/**.md')
    expect(mockResolveUriWithInfo).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
