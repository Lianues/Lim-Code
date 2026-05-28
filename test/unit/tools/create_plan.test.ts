const mockCreateDirectory = jest.fn().mockResolvedValue(undefined)
const mockReadFile = jest.fn()
const mockWriteFile = jest.fn().mockResolvedValue(undefined)
const mockGetAllWorkspaces = jest.fn()
const mockResolveUriWithInfo = jest.fn()
const mockNormalizeLineEndingsToLF = jest.fn((input: string) => input.replace(/\r\n?/g, '\n'))
const mockSyncProgressFromPlanArtifact = jest.fn().mockResolvedValue([])

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

jest.mock('../../../backend/tools/progress/autoSync', () => ({
  syncProgressFromPlanArtifact: (...args: any[]) => mockSyncProgressFromPlanArtifact(...args)
}))

import { createCreatePlanTool } from '../../../backend/tools/plan/create_plan'

describe('create_plan tool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllWorkspaces.mockReturnValue([{ name: 'workspace' }])
    mockResolveUriWithInfo.mockImplementation((targetPath: string) => ({
      uri: { fsPath: `D:/workspace/${targetPath}` },
      error: undefined
    }))
    mockReadFile.mockResolvedValue(new TextEncoder().encode('# Source Document'))
  })

  it('writes a normalized plan markdown document with TODO section and requires confirmation', async () => {
    const tool = createCreatePlanTool()
    const result = await tool.handler({
      title: 'API Plan',
      plan: '# API Plan\r\n\r\n- implement endpoint',
      todos: [
        { id: 'api-1', content: '实现接口', status: 'pending' },
        { id: 'api-2', content: '补充测试', status: 'completed' }
      ]
    })

    expect(result.success).toBe(true)
    expect(result.requiresUserConfirmation).toBe(true)
    expect(result.data).toEqual({
      path: '.limcode/plans/api-plan.plan.md',
      content: expect.stringContaining('# API Plan\n\n- implement endpoint'),
      todos: [
        { id: 'api-1', content: '实现接口', status: 'pending' },
        { id: 'api-2', content: '补充测试', status: 'completed' }
      ],
      sourceArtifact: undefined
    })
    expect((result.data as any).content).toContain('## TODO LIST')
    expect((result.data as any).content).toContain('`#api-1`')
    expect((result.data as any).content).toContain('`#api-2`')

    expect(mockCreateDirectory).toHaveBeenCalledWith({
      fsPath: 'D:/workspace/.limcode/plans'
    })
    expect(mockResolveUriWithInfo).toHaveBeenCalledWith('.limcode/plans/api-plan.plan.md')
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    expect(mockSyncProgressFromPlanArtifact).toHaveBeenCalledWith({
      planPath: '.limcode/plans/api-plan.plan.md',
      title: 'API Plan',
      todos: [
        { id: 'api-1', content: '实现接口', status: 'pending' },
        { id: 'api-2', content: '补充测试', status: 'completed' }
      ],
      updateMode: 'revision'
    })
  })

  it('writes tracked source artifact metadata when sourceArtifact is provided', async () => {
    const tool = createCreatePlanTool()
    const result = await tool.handler({
      title: 'Tracked Plan',
      plan: '# Tracked Plan\n\n- step',
      todos: [
        { id: 'tracked-1', content: '执行步骤', status: 'pending' }
      ],
      sourceArtifact: {
        type: 'design',
        path: '.limcode/design/tracked.md'
      }
    })

    expect(result.success).toBe(true)
    expect((result.data as any).sourceArtifact).toEqual({
      type: 'design',
      path: '.limcode/design/tracked.md',
      contentHash: expect.stringMatching(/^sha256:/)
    })
    expect((result.data as any).content).toContain('<!-- LIMCODE_SOURCE_ARTIFACT_START -->')
    expect((result.data as any).content).toContain('"type":"design"')
    expect((result.data as any).content).toContain('"path":".limcode/design/tracked.md"')
    expect(mockResolveUriWithInfo).toHaveBeenCalledWith('.limcode/design/tracked.md')
  })

  it('rejects paths outside .limcode/plans', async () => {
    const tool = createCreatePlanTool()
    const result = await tool.handler({
      plan: '# Invalid',
      todos: [{ id: 'x', content: 'x', status: 'pending' }],
      path: '.limcode/design/not-allowed.md'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('.limcode/plans/**.md')
    expect(mockResolveUriWithInfo).not.toHaveBeenCalled()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
