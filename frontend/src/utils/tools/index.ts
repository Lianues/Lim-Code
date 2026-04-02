/**
 * 工具注册统一入口
 *
 * 所有工具都在这里注册
 */

// 文件工具
import './file/read_file'
import './file/write_file'
import './file/list_files'
import './file/delete_file'
import './file/apply_diff'
import './file/create_directory'
import './file/insert_code'
import './file/delete_code'

// 搜索工具
import './search/find_files'
import './search/search_in_files'

// 终端工具
import './terminal/execute_command'

// 媒体工具
import './media/generate_image'
import './media/remove_background'
import './media/crop_image'
import './media/resize_image'
import './media/rotate_image'

// LSP 工具
import './lsp/get_symbols'
import './lsp/goto_definition'
import './lsp/find_references'

// Skills 工具
import './skills/read_skill'

// SubAgents 工具
import './subagents/subagents'

// TODO 工具
import './todo/todo_write'
import './todo/todo_update'

// Design 工具
import './design/create_design'
import './design/update_design'

// Plan 工具
import './plan/create_plan'
import './plan/update_plan'

// Review 工具
import './review/create_review'
import './review/record_review_milestone'
import './review/finalize_review'
import './review/validate_review_document'
import './review/reopen_review'
import './review/compare_review_documents'

// History 工具
import './history/history_search'

// 导出工具注册表
export { toolRegistry, registerTool, getToolConfig, type ToolConfig } from '../toolRegistry'

// 导出 MCP 工具注册函数
export {
  createMcpToolConfig,
  registerMcpTool,
  ensureMcpToolRegistered
} from './mcp/mcp_tool'
