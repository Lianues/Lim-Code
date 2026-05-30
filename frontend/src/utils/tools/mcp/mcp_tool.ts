/**
 * MCP 工具注册
 *
 * 为所有 MCP 工具提供统一的显示配置
 * MCP 工具名称格式：mcp__<serverId>__<toolName>
 * 使用双下划线分隔，因为 Gemini API 不允许函数名中包含多个冒号
 *
 * WP12：所有 MCP 工具名编解码统一通过 mcpToolNameCodec，
 * 不再手写 startsWith('mcp__') 或 split('__')。
 */

import { toolRegistry, type ToolConfig } from '../../toolRegistry'
import McpToolComponent from '../../../components/tools/mcp/mcp_tool.vue'
// WP12：统一使用 codec 编解码 MCP 工具名
import { isMcpToolName, decodeMcpToolName } from './mcpToolNameCodec'

/**
 * 解析 MCP 工具名称
 * 格式：mcp__<serverId>__<toolName>
 *
 * WP12：改用 decodeMcpToolName，用 indexOf 而非 split('__')，
 * 正确处理 toolName 含下划线或双下划线的情况。
 */
function parseMcpToolName(toolName: string): { serverId: string; originalName: string } | null {
  // WP12：使用 codec 统一解码
  const decoded = decodeMcpToolName(toolName)
  if (!decoded) {
    return null
  }
  return {
    serverId: decoded.serverId,
    originalName: decoded.toolName
  }
}

/**
 * 创建 MCP 工具配置
 */
export function createMcpToolConfig(toolName: string): ToolConfig {
  const mcpInfo = parseMcpToolName(toolName)
  
  return {
    name: toolName,
    label: mcpInfo?.originalName || toolName,
    icon: 'codicon-plug',
    
    // 描述生成器 - 显示 MCP 服务器信息
    descriptionFormatter: (args) => {
      const serverInfo = mcpInfo ? `MCP: ${mcpInfo.serverId}` : 'MCP 工具'
      const argCount = Object.keys(args || {}).length
      return `${serverInfo} | ${argCount} 个参数`
    },
    
    // 使用自定义组件显示内容
    contentComponent: McpToolComponent
  }
}

/**
 * 动态注册 MCP 工具
 *
 * 由于 MCP 工具名称是动态的，需要在运行时注册
 */
export function registerMcpTool(toolName: string): void {
  // WP12：使用 codec 统一判断
  if (!isMcpToolName(toolName)) {
    return
  }
  
  // 如果已注册则跳过
  if (toolRegistry.has(toolName)) {
    return
  }
  
  const config = createMcpToolConfig(toolName)
  toolRegistry.register(toolName, config)
}

/**
 * 检查并注册 MCP 工具
 *
 * 在工具消息渲染时调用，确保 MCP 工具有正确的配置
 */
export function ensureMcpToolRegistered(toolName: string): void {
  // WP12：使用 codec 统一判断
  if (isMcpToolName(toolName) && !toolRegistry.has(toolName)) {
    registerMcpTool(toolName)
  }
}
