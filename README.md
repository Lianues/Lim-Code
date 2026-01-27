# LimCode

<p align="center">
  <img src="resources/icon.png" alt="LimCode Logo" width="128">
</p>

<p align="center">
  <strong>一个强大的 VS Code AI 编程助手</strong>
</p>

<p align="center">
  支持多渠道 AI 模型 | 智能工具调用 | 模块化架构
</p>

## ✨ 特性

### 🤖 多渠道支持
- **Gemini** - 原生支持 Google Gemini API，包括 Function Calling
- **OpenAI** - 兼容 OpenAI 格式的 API（ChatGPT、Azure OpenAI 等）
- **Anthropic** - 支持 Claude 系列模型
- **自定义格式** - XML 工具调用格式，适用于更多模型

### 🛠️ 智能工具系统
内置丰富的工具，让 AI 能够直接操作您的代码：

| 类别 | 工具 | 说明 |
|------|------|------|
| 📁 文件 | `read_file` | 读取文件内容（支持多模态） |
| | `write_file` | 写入文件内容 |
| | `apply_diff` | 应用差异修改 |
| | `list_files` | 列出目录文件 |
| | `delete_file` | 删除文件 |
| | `create_directory` | 创建目录 |
| 🔍 搜索 | `find_files` | 按名称搜索文件 |
| | `search_in_files` | 在文件内容中搜索 |
| 🖥️ 终端 | `execute_command` | 执行终端命令 |
| 🎨 媒体 | `generate_image` | AI 图像生成 |
| | `remove_background` | 移除图片背景 |
| | `crop_image` | 裁剪图片 |
| | `resize_image` | 调整图片尺寸 |
| | `rotate_image` | 旋转图片 |

### 🔌 MCP 协议支持
- 支持 Model Context Protocol (MCP)
- 可连接外部 MCP 服务器扩展工具能力
- 支持 Stdio 和 HTTP 两种连接方式

### 📝 智能上下文
- **工作区文件树** - 自动发送项目结构
- **打开的标签页** - 感知当前正在编辑的文件
- **固定文件** - 重要文件始终包含在上下文中
- **自定义提示词模板** - 使用 `{{$VARIABLE}}` 变量自定义系统提示词

### 💾 会话管理
- **对话历史** - 自动保存所有对话
- **存档点** - 自动创建代码备份，支持一键恢复
- **上下文总结** - 自动压缩长对话，节省 Token

## 📦 安装

### 从插件商店下载
1.搜索`LimCode`进行安装

### 从 VSIX 安装
1. 下载最新的 `limcode-x.x.x.vsix` 文件
2. 在 VS Code 中打开命令面板 (`Ctrl+Shift+P`)
3. 搜索 "从 VSIX 安装..."
4. 选择下载的文件

### 从源码构建
```bash
# 克隆仓库
git clone https://github.com/Lianues/Lim-Code.git
cd Lim-Code

# 安装依赖
npm install
cd frontend && npm install

# 构建前后端
npm run build

# 打包
npx @vscode/vsce package
```

## 🚀 快速开始

1. 点击侧边栏的 LimCode 图标打开面板
2. 进入设置，配置 AI 渠道：
   - 选择渠道类型（Gemini/OpenAI/Anthropic）
   - 填入 API URL 和 API Key
   - 添加可用模型
3. 开始对话！

## ⚙️ 配置说明

### Settings Sync（配置同步）
- LimCode 的大部分“设置类配置”（工具选项 / 提示词 / UI 偏好 / Token 计数 / 图像工具配置等）已迁移到 VS Code Settings（`limcode.*`），在开启 VS Code Settings Sync 时会自动同步到其他设备。
- `limcode.proxy` 与 `limcode.storagePath` 为 **machine scope**：按机器保存，不参与同步（避免不同机器代理端口、存储路径冲突）。
- 从旧版本升级时，会在首次启动自动从 `globalStorage/settings/settings.json` 迁移，并备份旧文件为 `settings.json.bak`。

### 渠道配置
每个渠道可以独立配置：
- **API URL** - API 端点地址
- **API Key** - 认证密钥
- **模型列表** - 可用模型
- **代理设置** - HTTP 代理支持
- **超时时间** - 请求超时设置
- **重试次数** - 失败自动重试

### 工具配置
- **启用/禁用** - 控制每个工具的可用性
- **自动执行** - 信任的工具可自动执行
- **多模态支持** - 启用图片/文档读取能力

### 高级配置
- **系统提示词模板** - 自定义 AI 角色和行为
- **上下文感知** - 控制发送的上下文信息
- **存档点** - 配置自动备份策略

## 🏗️ 架构

LimCode 采用模块化架构：

```
limcode/
├── backend/           # 后端模块
│   ├── core/          # 核心服务
│   ├── modules/       # 功能模块
│   │   ├── channel/   # AI 渠道管理
│   │   ├── config/    # 配置管理
│   │   ├── conversation/ # 对话管理
│   │   ├── mcp/       # MCP 协议
│   │   ├── prompt/    # 提示词管理
│   │   └── settings/  # 设置管理
│   └── tools/         # 工具系统
├── frontend/          # Vue 前端
│   ├── components/    # UI 组件
│   ├── composables/   # 组合式函数
│   └── stores/        # 状态管理
└── webview/           # Webview 集成
```

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 🤝 贡献

欢迎贡献代码！

---

<p align="center">
  Made with ❤️ by LimCode Team
</p>