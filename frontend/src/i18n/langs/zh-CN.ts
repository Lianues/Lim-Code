/**
 * LimCode - 简体中文语言包
 * 按组件目录结构组织翻译
 */

import type { LanguageMessages } from '../types';

const zhCN: LanguageMessages = {
    common: {
        save: '保存',
        cancel: '取消',
        confirm: '确认',
        delete: '删除',
        edit: '编辑',
        add: '添加',
        remove: '移除',
        enable: '启用',
        disable: '禁用',
        enabled: '已启用',
        disabled: '已禁用',
        loading: '加载中...',
        error: '错误',
        success: '成功',
        warning: '警告',
        info: '信息',
        close: '关闭',
        back: '返回',
        next: '下一步',
        done: '完成',
        yes: '是',
        no: '否',
        ok: '确定',
        copy: '复制',
        paste: '粘贴',
        reset: '重置',
        default: '默认',
        custom: '自定义',
        auto: '自动',
        manual: '手动',
        none: '无',
        all: '全部',
        select: '选择',
        search: '搜索',
        filter: '筛选',
        sort: '排序',
        refresh: '刷新',
        retry: '重试',
        settings: '设置',
        help: '帮助',
        about: '关于',
        version: '版本',
        name: '名称',
        description: '描述',
        status: '状态',
        type: '类型',
        size: '大小',
        path: '路径',
        time: '时间',
        date: '日期',
        actions: '操作',
        more: '更多',
        less: '收起',
        expand: '展开',
        collapse: '折叠',
        preview: '预览',
        download: '下载',
        upload: '上传',
        import: '导入',
        export: '导出',
        create: '创建',
        update: '更新',
        apply: '应用',
        install: '安装',
        uninstall: '卸载',
        start: '启动',
        stop: '停止',
        pause: '暂停',
        resume: '继续',
        running: '运行中',
        stopped: '已停止',
        pending: '等待中',
        completed: '已完成',
        failed: '失败',
        unknown: '未知'
    },

    components: {
        announcement: {
            title: '版本更新',
            gotIt: '知道了'
        },
        attachment: {
            preview: '预览',
            download: '下载',
            close: '关闭',
            downloadFile: '下载文件',
            unsupportedPreview: '此文件类型不支持预览',
            imageFile: '图片文件',
            videoFile: '视频文件',
            audioFile: '音频文件',
            documentFile: '文档文件',
            otherFile: '其他文件'
        },

        common: {
            confirmDialog: {
                title: '确认',
                message: '确定要执行此操作吗？',
                confirm: '确定',
                cancel: '取消'
            },
            inputDialog: {
                title: '请输入',
                confirm: '确定',
                cancel: '取消'
            },
            deleteDialog: {
                title: '删除消息',
                message: '确定要删除这条消息吗？',
                messageWithCount: '确定要删除这条消息吗？这将同时删除后续 {count} 条消息，共 {total} 条消息将被删除。',
                checkpointHint: '检测到此消息前有备份，您可以选择回档到该备份点后再删除，以恢复文件变更。',
                cancel: '取消',
                delete: '删除',
                restoreToUserMessage: '回档到用户消息前',
                restoreToAssistantMessage: '回档到助手消息前',
                restoreToToolBatch: '回档到批量工具执行前',
                restoreToTool: '回档到 {toolName} 执行前'
            },
            editDialog: {
                title: '编辑消息',
                placeholder: '输入新的消息内容...（可粘贴附件，Shift+拖拽添加路径）',
                addAttachment: '添加附件',
                checkpointHint: '检测到此消息前有工具执行的备份，您可以选择回档到工具执行前再编辑，以恢复文件变更。',
                cancel: '取消',
                save: '保存',
                restoreToUserMessage: '回档到用户消息前',
                restoreToAssistantMessage: '回档到助手消息前',
                restoreToToolBatch: '回档到批量工具执行前',
                restoreToTool: '回档到 {toolName} 执行前'
            },
            retryDialog: {
                title: '重试消息',
                message: '确定要重试此消息吗？这将删除此消息及后续消息，然后重新请求 AI 响应。',
                checkpointHint: '检测到此消息前有工具执行的备份，您可以选择回档到工具执行前再重试。',
                cancel: '取消',
                retry: '重试',
                restoreToUserMessage: '回档到用户消息前',
                restoreToAssistantMessage: '回档到助手消息前',
                restoreToToolBatch: '回档到批量工具执行前',
                restoreToTool: '回档到 {toolName} 执行前'
            },
            dependencyWarning: {
                title: '需要安装依赖',
                defaultMessage: '此功能需要安装以下依赖：',
                hint: '请前往',
                linkText: '扩展依赖'
            },
            emptyState: {
                noData: '暂无数据',
                noResults: '无搜索结果'
            },
            tooltip: {
                copied: '已复制',
                copyFailed: '复制失败'
            },
            modal: {
                close: '关闭'
            },
            markdown: {
                copyCode: '复制代码',
                copied: '已复制',
                imageLoadFailed: '图片加载失败'
            }
        },

        header: {
            newChat: '新对话',
            history: '历史记录',
            settings: '设置',
            model: '模型',
            channel: '渠道'
        },

        history: {
            title: '对话历史',
            empty: '暂无对话记录',
            deleteConfirm: '确定要删除这条对话吗？',
            searchPlaceholder: '搜索对话...',
            clearSearch: '清除搜索',
            noSearchResults: '没有匹配的对话',
            today: '今天',
            yesterday: '昨天',
            thisWeek: '本周',
            earlier: '更早',
            noTitle: '无标题',
            currentWorkspace: '当前工作区',
            allWorkspaces: '全部工作区',
            backToChat: '返回对话',
            showHistory: '显示对话历史：',
            revealInExplorer: '在文件管理器中显示',
            deleteConversation: '删除对话',
            messages: '条消息'
        },

        home: {
            welcome: '欢迎使用 LimCode',
            welcomeMessage: 'AI 编程助手，帮助您更高效地编写代码',
            welcomeHint: '在下方输入框中输入消息开始对话',
            quickStart: '快速开始',
            recentChats: '最近对话',
            noRecentChats: '暂无对话历史',
            viewAll: '查看全部'
        },

        input: {
            placeholder: '输入消息...',
            placeholderHint: '输入消息... (Enter 发送，可粘贴附件，Shift+拖拽或@添加路径)',
            send: '发送消息',
            stopGenerating: '停止生成',
            attachFile: '添加附件',
            pinnedFiles: '固定文件',
            skills: 'Skills',
            summarizeContext: '总结上下文',
            selectChannel: '选择渠道',
            selectModel: '选择模型',
            clickToPreview: '点击预览',
            remove: '移除',
            tokenUsage: '使用量',
            context: '上下文',
            fileNotExists: '文件不存在',
            mode: {
                selectMode: '选择模式',
                manageMode: '管理模式',
                search: '搜索模式...',
                noResults: '没有匹配的模式'
            },
            channelSelector: {
                placeholder: '选择配置',
                searchPlaceholder: '搜索渠道...',
                noMatch: '没有匹配的渠道'
            },
            modelSelector: {
                placeholder: '选择模型',
                searchPlaceholder: '搜索模型...',
                noMatch: '没有匹配的模型',
                addInSettings: '请在设置中添加模型'
            },
            pinnedFilesPanel: {
                title: '固定文件',
                description: '固定的文件内容会在每次对话时发送给 AI',
                loading: '加载中...',
                empty: '暂无固定文件',
                notExists: '不存在',
                dragHint: '按住 Shift 拖拽工作区内的文本文件到此处添加',
                dropHint: '释放鼠标添加文件'
            },
            skillsPanel: {
                title: 'Skills',
                description: 'Skills 是用户自定义的知识模块。勾选框：在对话中启用。开关：发送详细内容给 AI。',
                loading: '加载中...',
                empty: '暂无可用的 Skills。请在 skills 文件夹中创建。',
                notExists: '不存在',
                enableTooltip: '在当前对话中启用此 Skill',
                sendContentTooltip: '启用时发送 Skill 内容给 AI',
                hint: 'AI 也可以通过 toggle_skills 工具来决定是否发送某个 Skill 内容',
                openDirectory: '打开 Skills 存储目录'
            },
            filePicker: {
                title: '选择文件',
                subtitle: '在 @ 后输入文字筛选路径',
                loading: '搜索中...',
                empty: '未找到匹配的文件',
                navigate: '导航',
                select: '选择',
                close: '关闭'
            },
            notifications: {
                summarizeFailed: '总结失败: {error}',
                summarizeSuccess: '已成功总结 {count} 条消息',
                summarizeError: '总结失败: {error}',
                holdShiftToDrag: '请按住 Shift 键拖拽文件',
                fileNotInWorkspace: '文件不在工作区内',
                fileNotInAnyWorkspace: '文件不在任何打开的工作区内',
                fileInOtherWorkspace: '文件属于其他工作区: {workspaceName}',
                fileAdded: '已添加固定文件: {path}',
                addFailed: '添加失败: {error}',
                cannotGetFilePath: '无法获取文件路径，请从 VSCode 资源管理器或标签页拖拽',
                fileNotMatchOrNotInWorkspace: '文件不在工作区内或文件名不匹配',
                removeFailed: '移除失败: {error}'
            }
        },

        message: {
            roles: {
                user: '用户',
                tool: '工具',
                assistant: '助手'
            },
            stats: {
                responseDuration: '响应时间',
                tokenRate: 'Token 速率'
            },
            thought: {
                thinking: '正在思考...',
                thoughtProcess: '思考过程'
            },
            summary: {
                title: '上下文总结',
                compressed: '已压缩 {count} 条消息',
                deleteTitle: '删除总结'
            },
            checkpoint: {
                userMessageBefore: '用户消息前存档',
                userMessageAfter: '用户消息后存档',
                assistantMessageBefore: '助手消息前存档',
                assistantMessageAfter: '助手消息后存档',
                toolBatchBefore: '批量工具执行前存档',
                toolBatchAfter: '批量工具执行后存档',
                userMessageUnchanged: '用户消息存档 · 内容未变化',
                assistantMessageUnchanged: '助手消息存档 · 内容未变化',
                toolBatchUnchanged: '批量工具执行完成 · 内容未变化',
                toolExecutionUnchanged: '工具执行完成 · 内容未变化',
                restoreTooltip: '恢复工作区到此存档点',
                fileCount: '{count} 个文件',
                yesterday: '昨天',
                daysAgo: '{days}天前',
                restoreConfirmTitle: '恢复存档',
                restoreConfirmMessage: '确定要将工作区恢复到此存档点吗？这将覆盖当前工作区中的相应文件，此操作不可恢复。',
                restoreConfirmBtn: '恢复'
            },
            continue: {
                title: '对话等待中',
                description: '工具执行完成。您可以发送新消息，或点击"继续"让 AI 继续响应',
                button: '继续'
            },
            error: {
                title: '请求失败',
                retry: '重试',
                dismiss: '关闭'
            },
            tool: {
                parameters: '参数',
                result: '结果',
                error: '错误',
                paramCount: '{count} 个参数',
                confirmExecution: '点击确认执行',
                confirm: '确认执行',
                saveAll: '全部保存',
                rejectAll: '全部拒绝',
                reject: '拒绝',
                confirmed: '已确认',
                rejected: '已拒绝',
                viewDiff: '查看差异',
                viewDiffInVSCode: '在 VSCode 中查看差异',
                openDiffFailed: '打开 diff 预览失败'
            },
            attachment: {
                clickToPreview: '点击预览',
                removeAttachment: '移除附件'
            }
        },

        settings: {
            title: '设置',
            tabs: {
                channel: '渠道',
                tools: '工具',
                autoExec: '自动执行',
                mcp: 'MCP',
                subagents: '子代理',
                checkpoint: '存档点',
                summarize: '总结',
                imageGen: '图像生成',
                dependencies: '扩展依赖',
                context: '上下文',
                prompt: '提示词',
                tokenCount: 'Token 计数',
                appearance: '外观',
                general: '通用'
            },
            channelSettings: {
                selector: {
                    placeholder: '选择配置',
                    rename: '重命名',
                    add: '新建配置',
                    delete: '删除配置',
                    inputPlaceholder: '输入配置名称',
                    confirm: '确认',
                    cancel: '取消'
                },
                dialog: {
                    new: {
                        title: '新建配置',
                        nameLabel: '配置名称',
                        namePlaceholder: '例如：我的 Gemini',
                        typeLabel: '接口类型',
                        typePlaceholder: '选择接口类型',
                        cancel: '取消',
                        create: '创建'
                    },
                    delete: {
                        title: '删除配置',
                        message: '确定要删除配置 "{name}" 吗？此操作不可恢复。',
                        atLeastOne: '至少需要保留一个配置',
                        cancel: '取消',
                        confirm: '确定'
                    }
                },
                form: {
                    apiUrl: {
                        label: 'API URL',
                        placeholder: '输入 API URL',
                        placeholderResponses: '输入 API 基础地址，如 https://api.openai.com/v1'
                    },
                    apiKey: {
                        label: 'API Key',
                        placeholder: '输入 API Key',
                        show: '显示',
                        hide: '隐藏',
                        useAuthorization: '使用 Authorization 格式发送',
                        useAuthorizationHintGemini: '将 x-goog-api-key 转为 Authorization: Bearer 格式发送',
                        useAuthorizationHintAnthropic: '将 x-api-key 转为 Authorization: Bearer 格式发送'
                    },
                    stream: {
                        label: '流式输出'
                    },
                    channelType: {
                        label: '渠道类型',
                        gemini: 'Gemini API',
                        openai: 'OpenAI API',
                        'openai-responses': 'OpenAI Responses API',
                        anthropic: 'Anthropic API'
                    },
                    toolMode: {
                        label: '工具调用格式',
                        placeholder: '选择工具调用格式',
                        functionCall: {
                            label: 'Function Calling',
                            description: '使用原生函数调用'
                        },
                        xml: {
                            label: 'XML 提示词',
                            description: '使用 XML 格式提示词'
                        },
                        json: {
                            label: 'JSON 边界标记',
                            description: '使用 JSON 格式 + 边界标记（推荐）'
                        },
                        hint: {
                            functionCall: 'Function Calling: 使用 API 原生函数调用功能',
                            xml: 'XML 提示词: 将工具转换为 XML 格式插入系统提示词',
                            json: 'JSON 边界标记: 使用 JSON 格式 + <<<TOOL_CALL>>> 边界标记（推荐）'
                        },
                        openaiWarning: 'OpenAI Function Call 模式不支持多模态工具（如 read_file 读取图片、generate_image 生成图片、remove_background 抠图、crop_image 裁切图片、resize_image 缩放图片、rotate_image 旋转图片）。如需使用多模态功能，请切换到 XML 或 JSON 模式。'
                    },
                    multimodal: {
                        label: '启用多模态工具',
                        supportedTypes: '支持的文件类型：',
                        image: '图片',
                        imageFormats: 'PNG、JPEG、WebP',
                        document: '文档',
                        documentFormats: 'PDF',
                        capabilities: '多模态工具能力：',
                        table: {
                            channel: '渠道 / 模式',
                            readImage: '读取图片',
                            readDocument: '读取文档',
                            generateImage: '生成图片',
                            historyMultimodal: '历史多模态'
                        },
                        channels: {
                            geminiAll: 'Gemini（全部）',
                            anthropicAll: 'Anthropic（全部）',
                            openaiXmlJson: 'OpenAI（XML/JSON）',
                            openaiResponses: 'OpenAI（Responses）',
                            openaiFunction: 'OpenAI（Function Call）'
                        },
                        legend: {
                            supported: '支持',
                            notSupported: '不支持'
                        },
                        notes: {
                            requireEnable: '需要启用此选项才能使用 read_file 读取图片/文档、generate_image 生成图片、remove_background 抠图、crop_image 裁切图片、resize_image 缩放图片、rotate_image 旋转图片等多模态工具',
                            userAttachment: '用户主动发送的附件不受此配置影响，始终按渠道原生能力处理',
                            geminiAnthropic: 'Gemini / Anthropic：工具可直接返回图片和文档，支持生成图片功能',
                            openaiResponses: 'OpenAI Responses：原生支持图片、PDF 读取，支持推理过程实时显示',
                            openaiXmlJson: 'OpenAI XML/JSON：支持读取图片和生成图片，不支持文档'
                        }
                    },
                    timeout: {
                        label: '超时时间 (ms)',
                        placeholder: '30000'
                    },
                    maxContextTokens: {
                        label: '最大上下文 Tokens',
                        placeholder: '128000',
                        hint: '用于显示上下文使用量的上限值'
                    },
                    contextManagement: {
                        title: '上下文管理',
                        enableTitle: '启用上下文阈值检测',
                        threshold: {
                            label: '上下文阈值',
                            placeholder: '80% 或 100000',
                            hint: '当总 token 数超过此阈值时，自动舍弃最旧的对话回合。支持两种格式：百分比（如 80%）或绝对数值（如 100000）'
                        },
                        extraCut: {
                            label: '额外裁剪量',
                            placeholder: '0 或 10%',
                            hint: '裁剪时额外裁剪的 token 数量。实际保留 = 阈值 - 额外裁剪量。支持百分比或绝对数值，默认为 0'
                        },
                        autoSummarize: {
                            label: '自动总结（即将推出）',
                            enableTitle: '启用自动总结',
                            hint: '启用后，在舍弃旧回合前先进行总结（功能开发中）'
                        }
                    },
                    toolOptions: {
                        title: '工具配置'
                    },
                    advancedOptions: {
                        title: '高级选项'
                    },
                    customBody: {
                        title: '自定义 Body',
                        enableTitle: '启用自定义 Body'
                    },
                    customHeaders: {
                        title: '自定义标头',
                        enableTitle: '启用自定义标头'
                    },
                    autoRetry: {
                        title: '自动重试',
                        enableTitle: '启用自动重试',
                        retryCount: {
                            label: '重试次数',
                            hint: 'API 返回错误时的最大重试次数（1-10）'
                        },
                        retryInterval: {
                            label: '重试间隔 (ms)',
                            hint: '每次重试之间的等待时间（1000-60000 毫秒）'
                        }
                    },
                    enabled: {
                        label: '启用此配置'
                    }
                }
            },
            tools: {
                title: '工具设置',
                description: '管理和配置可用工具',
                enableAll: '全部启用',
                disableAll: '全部禁用',
                toolName: '工具名称',
                toolDescription: '工具描述',
                toolEnabled: '启用状态'
            },
            autoExec: {
                title: '自动执行',
                intro: {
                    title: '工具执行确认',
                    description: '配置 AI 调用工具时是否需要用户确认。勾选表示自动执行（无需确认），不勾选表示执行前需要用户确认。'
                },
                actions: {
                    refresh: '刷新',
                    enableAll: '全部自动执行',
                    disableAll: '全部需确认'
                },
                status: {
                    loading: '加载工具列表...',
                    empty: '暂无可用工具',
                    autoExecute: '自动执行',
                    needConfirm: '需确认'
                },
                categories: {
                    file: '文件操作',
                    search: '搜索',
                    terminal: '终端',
                    lsp: '代码智能',
                    media: '媒体处理',
                    mcp: 'MCP 工具',
                    other: '其他'
                },
                badges: {
                    dangerous: '危险'
                },
                tips: {
                    dangerousDefault: '• 标记为"危险"的工具默认需要用户确认后才能执行',
                    deleteFileWarning: '• delete_file: 删除文件操作不可恢复，建议保持需确认',
                    executeCommandWarning: '• execute_command: 执行终端命令可能对系统造成影响',
                    mcpToolsDefault: '• MCP 工具：来自已连接的 MCP 服务器，默认自动执行',
                    useWithCheckpoint: '• 建议配合存档点功能使用，以便在误操作时恢复'
                }
            },
            mcp: {
                title: 'MCP 设置',
                description: '配置 Model Context Protocol 服务器',
                addServer: '添加服务器',
                serverName: '服务器名称',
                serverCommand: '启动命令',
                serverArgs: '命令参数',
                serverEnv: '环境变量',
                serverStatus: '服务器状态',
                connecting: '连接中',
                connected: '已连接',
                disconnected: '已断开',
                error: '错误'
            },
            checkpoint: {
                title: '存档点设置',
                loading: '加载配置...',
                sections: {
                    enable: {
                        label: '启用存档点功能',
                        description: '在工具执行前后自动创建代码库快照，支持一键回退'
                    },
                    messages: {
                        title: '消息类型存档点',
                        description: '选择是否为用户消息和模型消息创建存档点（独立于工具调用）',
                        beforeLabel: '消息前',
                        afterLabel: '消息后',
                        types: {
                            user: {
                                name: '用户消息',
                                description: '用户发送的消息'
                            },
                            model: {
                                name: '模型消息',
                                description: '模型回复的消息（不包含工具调用）'
                            }
                        },
                        options: {
                            modelOuterLayerOnly: {
                                label: '连续调用工具时，只在最外层创建模型消息存档点',
                                hint: '启用后，模型消息的"消息前"存档点只在第一次迭代创建，"消息后"存档点只在最后一次（无工具调用）创建。禁用后每次迭代都会创建。'
                            },
                            mergeUnchanged: {
                                label: '合并显示消息前后无变更的存档点',
                                hint: '启用后，如果消息前后存档点的内容相同，将合并显示为一个"内容未变化"的存档点。禁用后将始终分别显示前后存档点。'
                            }
                        }
                    },
                    tools: {
                        title: '工具备份配置',
                        description: '选择需要在执行前后创建备份的工具',
                        beforeLabel: '执行前',
                        afterLabel: '执行后',
                        empty: '暂无可用的工具'
                    },
                    other: {
                        title: '其他配置',
                        maxCheckpoints: {
                            label: '最大存档点数量',
                            placeholder: '-1',
                            hint: '超过此数量时自动清理旧的存档点，填写 -1 表示无上限'
                        }
                    },
                    cleanup: {
                        title: '清理存档点',
                        description: '按对话清理存档点，释放存储空间',
                        searchPlaceholder: '搜索对话标题...',
                        loading: '加载中...',
                        noMatch: '未找到匹配的对话',
                        noCheckpoints: '暂无存档点',
                        refresh: '刷新列表',
                        checkpointCount: '{count} 个存档点',
                        confirmDelete: {
                            title: '确认删除',
                            message: '确定要删除的所有存档点吗？',
                            stats: '将删除 {count} 个存档点，释放 {size} 存储空间',
                            warning: '此操作不可恢复',
                            cancel: '取消',
                            delete: '删除'
                        },
                        timeFormat: {
                            justNow: '刚刚',
                            minutesAgo: '{count} 分钟前',
                            hoursAgo: '{count} 小时前',
                            daysAgo: '{count} 天前'
                        }
                    }
                }
            },
            summarize: {
                title: '上下文总结',
                description: '压缩对话历史，减少 Token 使用量',
                enableSummarize: '启用总结',
                tokenThreshold: 'Token 阈值',
                summaryModel: '总结模型',
                summaryPrompt: '总结提示词'
            },
            imageGen: {
                title: '图像生成',
                description: '配置 AI 图像生成工具',
                enableImageGen: '启用图像生成',
                provider: '提供者',
                model: '模型',
                outputPath: '输出路径',
                maxImages: '最大图片数'
            },
            dependencies: {
                title: '扩展依赖',
                description: '管理可选功能所需的依赖',
                installed: '已安装',
                notInstalled: '未安装',
                installing: '安装中',
                installFailed: '安装失败',
                install: '安装',
                uninstall: '卸载',
                required: '必需',
                optional: '可选'
            },
            context: {
                title: '上下文感知',
                description: '配置发送给 AI 的工作区上下文信息',
                includeFileTree: '包含文件树',
                includeOpenFiles: '包含打开的文件',
                includeSelection: '包含选中内容',
                maxDepth: '最大深度',
                excludePatterns: '排除规则',
                pinnedFiles: '固定文件',
                addPinnedFile: '添加固定文件'
            },
            prompt: {
                title: '系统提示词',
                description: '自定义系统提示词的结构和内容',
                systemPrompt: '系统提示词',
                customPrompt: '自定义提示词',
                templateVariables: '模板变量',
                preview: '预览',
                sections: {
                    environment: '环境信息',
                    tools: '工具描述',
                    context: '上下文信息',
                    instructions: '指令'
                }
            },
            general: {
                title: '通用设置',
                description: '基本配置选项',
                proxy: {
                    title: '网络代理',
                    description: '配置 HTTP 代理用于 API 请求',
                    enable: '启用代理',
                    url: '代理地址',
                    urlPlaceholder: 'http://127.0.0.1:7890',
                    urlError: '请输入有效的代理地址（http:// 或 https://）'
                },
                language: {
                    title: '界面语言',
                    description: '选择界面显示语言',
                    auto: '跟随系统',
                    autoDescription: '自动跟随 VS Code 语言设置'
                },
                appInfo: {
                    title: '应用信息',
                    name: 'LimCode - Vibe Coding 助手',
                    version: '版本',
                    repository: '项目仓库',
                    developer: '开发者'
                }
            },
            contextSettings: {
                loading: '加载中...',
                workspaceFiles: {
                    title: '工作区文件树',
                    description: '将工作区文件目录结构发送给 AI',
                    sendFileTree: '发送工作区文件树',
                    maxDepth: '最大深度',
                    unlimitedHint: '-1 表示无限制'
                },
                openTabs: {
                    title: '打开的标签页',
                    description: '将当前打开的文件列表发送给 AI',
                    sendOpenTabs: '发送打开的标签页',
                    maxCount: '最大数量'
                },
                activeEditor: {
                    title: '当前活动编辑器',
                    description: '将当前正在编辑的文件路径发送给 AI',
                    sendActiveEditor: '发送当前活动编辑器路径'
                },
                diagnostics: {
                    title: '诊断信息',
                    description: '将工作区的错误、警告等诊断信息发送给 AI，帮助 AI 修复代码问题',
                    enableDiagnostics: '启用诊断信息',
                    severityTypes: '问题类型',
                    severity: {
                        error: '错误',
                        warning: '警告',
                        information: '信息',
                        hint: '提示'
                    },
                    workspaceOnly: '仅工作区内文件',
                    openFilesOnly: '仅打开的文件',
                    maxPerFile: '每文件最大数量',
                    maxFiles: '最大文件数'
                },
                ignorePatterns: {
                    title: '忽略模式',
                    description: '匹配的文件/文件夹不会出现在上下文中（支持通配符）',
                    removeTooltip: '移除',
                    emptyHint: '暂无自定义忽略模式',
                    inputPlaceholder: '输入模式，如：**/node_modules, *.log',
                    addButton: '添加',
                    helpTitle: '通配符说明:',
                    helpItems: {
                        wildcard: '* - 匹配任意字符（不包含路径分隔符）',
                        recursive: '** - 匹配任意层级目录',
                        examples: '例如: **/node_modules、*.log、.git'
                    }
                },
                preview: {
                    title: '当前状态预览',
                    autoRefreshBadge: '实时更新',
                    description: '预览当前会发送给 AI 的上下文信息（每 2 秒自动刷新）',
                    activeEditorLabel: '当前活动编辑器：',
                    openTabsLabel: '打开的标签页（{count} 个）：',
                    noValue: '无',
                    moreItems: '... 还有 {count} 个'
                },
                saveSuccess: '保存成功',
                saveFailed: '保存失败'
            },
            dependencySettings: {
                title: '扩展依赖管理',
                description: '管理可选的扩展功能所需的依赖。这些依赖将安装到本地文件系统，不会打包进插件。',
                installPath: '安装路径：',
                installed: '已安装',
                installing: '安装中...',
                uninstalling: '卸载中...',
                install: '安装',
                uninstall: '卸载',
                estimatedSize: '约 {size}MB',
                empty: '暂无需要依赖的工具',
                progress: {
                    processing: '正在处理 {dependency}...',
                    complete: '{dependency} 处理完成',
                    failed: '{dependency} 处理失败',
                    installSuccess: '{name} 安装成功！',
                    installFailed: '{name} 安装失败',
                    uninstallSuccess: '{name} 已卸载',
                    uninstallFailed: '{name} 卸载失败',
                    unknownError: '未知错误'
                },
                panel: {
                    installedCount: '{installed}/{total}'
                }
            },
            generateImageSettings: {
                description: '图像生成工具允许 AI 调用图像生成模型来创建图片。生成的图片会保存到工作区并以多模态形式返回给 AI 查看。',
                api: {
                    title: 'API 配置',
                    url: 'API URL',
                    urlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
                    urlHint: '图像生成 API 的基础 URL',
                    apiKey: 'API Key',
                    apiKeyPlaceholder: '输入 API Key',
                    apiKeyHint: '用于图像生成 API 的密钥',
                    model: '模型名称',
                    modelPlaceholder: 'gemini-3-pro-Image-preview',
                    modelHint: '例如：gemini-3-pro-Image-preview',
                    show: '显示',
                    hide: '隐藏'
                },
                aspectRatio: {
                    title: '宽高比参数',
                    enable: '启用宽高比参数',
                    fixedRatio: '固定宽高比',
                    placeholder: '不固定（AI 可选择）',
                    options: {
                        auto: '自动',
                        square: '正方形',
                        landscape: '横向',
                        portrait: '纵向',
                        mobilePortrait: '手机屏幕竖屏',
                        widescreen: '宽屏',
                        ultrawide: '超宽屏'
                    },
                    hints: {
                        disabled: '禁用时：AI 不能配置此参数，API 调用不传入此参数',
                        fixed: '已固定：AI 将被告知固定为 {ratio}，不能更改',
                        flexible: '未固定：AI 可使用 aspect_ratio 参数自行选择'
                    }
                },
                imageSize: {
                    title: '图片尺寸参数',
                    enable: '启用图片尺寸参数',
                    fixedSize: '固定图片尺寸',
                    placeholder: '不固定（AI 可选择）',
                    options: {
                        auto: '自动'
                    },
                    hints: {
                        disabled: '禁用时：AI 不能配置此参数，API 调用不传入此参数',
                        fixed: '已固定：AI 将被告知固定为 {size}，不能更改',
                        flexible: '未固定：AI 可使用 image_size 参数自行选择'
                    }
                },
                batch: {
                    title: '批量生成限制',
                    maxTasks: '最大批量任务数',
                    maxTasksHint: 'AI 单次调用允许的最大任务数（不同提示词的图片）。范围 1-20。',
                    maxImagesPerTask: '单任务最大图片数',
                    maxImagesPerTaskHint: '每个任务（单个提示词）最多保存的图片数量。范围 1-10。',
                    summary: '当前配置：AI 单次最多发起 {maxTasks} 个任务，每个任务最多保存 {maxImages} 张图片'
                },
                usage: {
                    title: '使用说明',
                    step1: '配置上方的 API URL、API Key 和模型名称',
                    step2: '确保工具在"工具设置"中已启用',
                    step3: '在对话中让 AI 调用 generate_image 工具生成图片',
                    step4: '生成的图片会保存到工作区的 generated_images 目录',
                    warning: '请配置 API Key 后才能使用图像生成功能'
                }
            },
            mcpSettings: {
                toolbar: {
                    addServer: '添加服务器',
                    editJson: '编辑 JSON',
                    refresh: '刷新'
                },
                loading: '加载中...',
                empty: {
                    title: '暂无 MCP 服务器',
                    description: '点击"添加服务器"按钮来配置您的第一个 MCP 服务器'
                },
                serverCard: {
                    connect: '连接',
                    disconnect: '断开',
                    connecting: '连接中...',
                    edit: '编辑',
                    delete: '删除',
                    tools: '工具',
                    resources: '资源',
                    prompts: '提示'
                },
                status: {
                    connected: '已连接',
                    connecting: '连接中...',
                    error: '连接错误',
                    disconnected: '未连接'
                },
                form: {
                    addTitle: '添加 MCP 服务器',
                    editTitle: '编辑 MCP 服务器',
                    serverId: '服务器 ID',
                    serverIdPlaceholder: '可选，留空则自动生成',
                    serverIdHint: '只能包含字母、数字、下划线和中划线，用于在 JSON 配置中标识服务器',
                    serverIdError: 'ID 只能包含字母、数字、下划线和中划线',
                    serverName: '服务器名称',
                    serverNamePlaceholder: '例如：My MCP Server',
                    description: '描述',
                    descriptionPlaceholder: '可选的描述信息',
                    required: '*',
                    transportType: '传输类型',
                    command: '命令',
                    commandPlaceholder: '例如：npx, python, node',
                    args: '参数',
                    argsPlaceholder: '空格分隔，例如：-m mcp_server',
                    env: '环境变量 (JSON)',
                    envPlaceholder: '{"KEY": "value"}',
                    url: 'URL',
                    urlPlaceholderSse: 'https://example.com/sse',
                    urlPlaceholderHttp: 'https://example.com/mcp',
                    headers: '请求头 (JSON)',
                    headersPlaceholder: '{"Authorization": "Bearer token"}',
                    options: '选项',
                    enabled: '启用',
                    autoConnect: '自动连接',
                    cleanSchema: '清理 Schema',
                    cleanSchemaHint: '移除 JSON Schema 中不兼容的字段（如 $schema, additionalProperties），某些 API（如 Gemini）需要启用此选项',
                    timeout: '连接超时 (毫秒)',
                    cancel: '取消',
                    create: '创建',
                    save: '保存'
                },
                validation: {
                    nameRequired: '请输入服务器名称',
                    idInvalid: 'ID 无效',
                    idChecking: '正在验证 ID，请稍候',
                    commandRequired: '请输入命令',
                    urlRequired: '请输入 URL',
                    createFailed: '创建失败',
                    updateFailed: '更新失败'
                },
                delete: {
                    title: '删除 MCP 服务器',
                    message: '确定要删除服务器 "{name}" 吗？此操作不可恢复。',
                    confirm: '删除',
                    cancel: '取消'
                }
            },
            subagents: {
                selectAgent: '选择子代理',
                noAgents: '暂无子代理',
                create: '新建',
                rename: '重命名',
                delete: '删除',
                disabled: '已禁用',
                enabled: '启用此子代理',
                globalConfig: '全局配置',
                maxConcurrentAgents: '最大并发数',
                maxConcurrentAgentsHint: 'AI 一次性可调用的最大子代理数量（-1 表示无限制）',
                basicInfo: '基本信息',
                description: '描述',
                descriptionPlaceholder: '向主 AI 说明何时使用此子代理',
                maxIterations: '最大迭代次数',
                maxIterationsHint: '子代理内部最大工具调用轮数（-1 表示无限制）',
                maxRuntime: '最大运行时间',
                maxRuntimeHint: '子代理最大运行时间（秒，-1 表示无限制）',
                systemPrompt: '系统提示词',
                systemPromptPlaceholder: '输入子代理的系统提示词...',
                channelModel: '渠道与模型',
                channel: '渠道',
                selectChannel: '选择渠道',
                model: '模型',
                selectModel: '选择模型',
                tools: '工具配置',
                toolsDescription: '配置子代理可使用的工具',
                toolMode: {
                    label: '工具模式',
                    all: '全部工具',
                    builtin: '仅内置工具',
                    mcp: '仅 MCP 工具',
                    whitelist: '白名单',
                    blacklist: '黑名单'
                },
                builtinTools: '内置工具',
                mcpTools: 'MCP 工具',
                noTools: '暂无可用工具',
                whitelistHint: '勾选的工具将被允许使用',
                blacklistHint: '勾选的工具将被禁止使用',
                emptyState: '暂无子代理，点击下方按钮创建第一个',
                createFirst: '创建子代理',
                deleteConfirm: {
                    title: '删除子代理',
                    message: '确定要删除此子代理吗？此操作不可恢复。'
                },
                createDialog: {
                    title: '新建子代理',
                    nameLabel: '名称',
                    namePlaceholder: '例如：代码审查专家',
                    nameRequired: '请输入子代理名称',
                    nameDuplicate: '已存在同名的子代理'
                }
            },
            modelManager: {
                title: '模型列表',
                fetchModels: '获取模型',
                clearAll: '清除全部',
                clearAllTooltip: '清除所有模型',
                empty: '暂无模型，请点击"获取模型"或手动添加',
                addPlaceholder: '手动输入模型 ID',
                addTooltip: '添加',
                removeTooltip: '移除',
                enabledTooltip: '当前启用的模型',
                filterPlaceholder: '筛选模型...',
                clearFilter: '清除筛选',
                noResults: '没有匹配的模型',
                clearDialog: {
                    title: '清除所有模型',
                    message: '确定要清除所有 {count} 个模型吗？此操作不可恢复。',
                    confirm: '清除',
                    cancel: '取消'
                },
                errors: {
                    addFailed: '添加模型失败',
                    removeFailed: '移除模型失败',
                    setActiveFailed: '设置激活模型失败'
                }
            },
            modelSelectionDialog: {
                title: '选择要添加的模型',
                selectAll: '全选',
                deselectAll: '全不选',
                close: '关闭',
                loading: '加载中...',
                error: '加载模型列表失败',
                retry: '重试',
                empty: '暂无可用模型',
                added: '已添加',
                selectionCount: '已选择 {count} 个模型',
                cancel: '取消',
                add: '添加 ({count})',
                filterPlaceholder: '筛选模型...',
                clearFilter: '清除筛选',
                noResults: '没有匹配的模型'
            },
            promptSettings: {
                loading: '加载中...',
                enable: '启用自定义系统提示词模板',
                enableDescription: '启用后可以自定义系统提示词的结构和内容，使用模块占位符组装提示词',
                modes: {
                    label: '提示词模式',
                    add: '添加模式',
                    rename: '重命名',
                    delete: '删除模式',
                    confirmDelete: '确定要删除这个模式吗？此操作不可撤销。',
                    cannotDeleteDefault: '无法删除默认模式',
                    unsavedChanges: '当前模式有未保存的更改，确定要放弃并切换吗？',
                    newModeName: '请输入新模式的名称',
                    newModeDefault: '新模式',
                    renameModePrompt: '请输入新的模式名称'
                },
                templateSection: {
                    title: '系统提示词模板',
                    resetButton: '重置为默认',
                    description: '直接编写系统提示词，使用 {{$VARIABLE}} 格式引用变量，变量会在发送时被替换为实际内容',
                    placeholder: '输入系统提示词，可以使用 {{$ENVIRONMENT}} 等变量...'
                },
                staticSection: {
                    title: '静态系统提示词',
                    description: '放入系统提示词中，内容相对稳定，可被 API 提供商缓存以加速响应。使用 {{$VARIABLE}} 格式引用静态变量。',
                    placeholder: '输入静态系统提示词，可使用 {{$ENVIRONMENT}}、{{$TOOLS}} 等变量...'
                },
                dynamicSection: {
                    title: '动态上下文模板',
                    description: '每次请求时动态生成并追加到消息末尾，包含实时信息（时间、文件树、标签页等），不存储到历史记录中。',
                    placeholder: '输入动态上下文模板，可使用 {{$WORKSPACE_FILES}}、{{$OPEN_TABS}} 等变量...',
                    enableTooltip: '启用/禁用动态上下文模板',
                    disabledNotice: '动态上下文模板已禁用，不会向 AI 发送动态上下文消息。'
                },
                saveButton: '保存配置',
                saveSuccess: '保存成功',
                saveFailed: '保存失败',
                modulesReference: {
                    title: '可用变量参考',
                    insertTooltip: '插入到模板末尾'
                },
                staticModules: {
                    title: '静态变量',
                    badge: '可缓存',
                    description: '这些变量会放入系统提示词中，内容相对稳定，可被 API 提供商缓存以加速响应。'
                },
                dynamicModules: {
                    title: '动态变量',
                    badge: '实时更新',
                    description: '这些变量会作为上下文动态插入到最后一条消息中，包含当前时间、文件状态等实时信息，不存储到对话历史中。'
                },
                tokenCount: {
                    label: 'Token 数量',
                    staticLabel: '静态模板',
                    dynamicLabel: '动态上下文',
                    staticTooltip: '静态模板本身的 Token 数量（不包含 {{$TOOLS}} 等占位符的实际内容）',
                    dynamicTooltip: '动态上下文的实际 Token 数量（包含文件树、诊断等实际填充的内容）',
                    channelTooltip: '选择用于计算 token 的渠道',
                    refreshTooltip: '刷新 token 计数',
                    failed: '计数失败',
                    hint: '静态模板为模板本身，动态上下文为实际填充后的内容。实际请求还包括工具定义等内容。'
                },
                modules: {
                    ENVIRONMENT: {
                        name: '环境信息',
                        description: '包含工作区路径、操作系统、当前时间和时区信息'
                    },
                    WORKSPACE_FILES: {
                        name: '工作区文件树',
                        description: '列出工作区中的文件和目录结构，受上下文感知设置中的深度和忽略模式影响',
                        requiresConfig: '上下文感知 > 发送工作区文件树'
                    },
                    OPEN_TABS: {
                        name: '打开的标签页',
                        description: '列出当前在编辑器中打开的文件标签页',
                        requiresConfig: '上下文感知 > 发送打开的标签页'
                    },
                    ACTIVE_EDITOR: {
                        name: '活动编辑器',
                        description: '显示当前正在编辑的文件路径',
                        requiresConfig: '上下文感知 > 发送当前活动编辑器'
                    },
                    DIAGNOSTICS: {
                        name: '诊断信息',
                        description: '显示工作区的错误、警告等诊断信息，帮助 AI 修复代码问题',
                        requiresConfig: '上下文感知 > 启用诊断信息'
                    },
                    PINNED_FILES: {
                        name: '固定文件内容',
                        description: '显示用户固定的文件的完整内容',
                        requiresConfig: '需要在输入框旁的固定文件按钮中添加文件'
                    },
                    SKILLS: {
                        name: 'Skills 内容',
                        description: '显示当前启用的 Skills 的内容。Skills 是用户自定义的知识模块，AI 可以通过 toggle_skills 工具动态启用/禁用。',
                        requiresConfig: 'AI 通过 toggle_skills 工具启用 skills'
                    },
                    TOOLS: {
                        name: '工具定义',
                        description: '根据渠道配置生成 XML 或 Function Call 格式的工具定义（此变量由系统自动填充）'
                    },
                    MCP_TOOLS: {
                        name: 'MCP 工具',
                        description: '来自 MCP 服务器的额外工具定义（此变量由系统自动填充）',
                        requiresConfig: 'MCP 设置中需要配置并连接服务器'
                    }
                },
                exampleOutput: '示例输出：',
                requiresConfigLabel: '依赖配置：'
            },
            summarizeSettings: {
                description: '上下文总结功能可以压缩对话历史，减少 Token 使用量。当对话过长时，可以手动或自动触发总结，将旧的对话内容压缩为摘要。',
                manualSection: {
                    title: '手动总结',
                    description: '点击输入框右侧的压缩按钮，可以手动触发上下文总结。总结后的内容会替换原有的历史对话。'
                },
                autoSection: {
                    title: '自动总结',
                    comingSoon: '即将推出',
                    enable: '启用自动总结',
                    enableHint: '当 Token 使用量超过阈值时自动触发总结',
                    threshold: '触发阈值',
                    thresholdUnit: '%',
                    thresholdHint: '当 Token 使用量达到此百分比时触发自动总结'
                },
                optionsSection: {
                    title: '总结选项',
                    keepRounds: '保留最近轮数',
                    keepRoundsUnit: '轮',
                    keepRoundsHint: '保留最近 N 轮对话不参与总结，确保上下文连贯',
                    prompt: '总结提示词',
                    promptPlaceholder: '输入总结时使用的提示词...',
                    promptHint: 'AI 进行总结时使用的指令'
                },
                modelSection: {
                    title: '专用总结模型',
                    useSeparate: '使用专用总结模型',
                    useSeparateHint: '启用后，总结时将使用下方指定的模型，而不是对话时使用的模型。\n可以选择更便宜的模型来节省成本。',
                    currentModelHint: '当前使用对话时的模型进行总结',
                    selectChannel: '选择渠道',
                    selectChannelPlaceholder: '选择用于总结的渠道',
                    selectChannelHint: '只显示已启用的渠道',
                    selectModel: '选择模型',
                    selectModelPlaceholder: '选择用于总结的模型',
                    selectModelHint: '只显示该渠道已添加到设置中的模型。\n如需添加更多模型，请前往渠道设置进行配置。',
                    warningHint: '请选择渠道和模型，否则将使用对话时的模型进行总结'
                }
            },
            settingsPanel: {
                title: '设置',
                backToChat: '返回对话',
                sections: {
                    channel: {
                        title: '渠道设置',
                        description: '配置 API 渠道和模型'
                    },
                    tools: {
                        title: '工具设置',
                        description: '管理和配置可用工具'
                    },
                    autoExec: {
                        title: '自动执行',
                        description: '配置工具执行时的确认行为'
                    },
                    mcp: {
                        title: 'MCP 设置',
                        description: '配置 Model Context Protocol 服务器'
                    },
                    checkpoint: {
                        title: '存档点设置',
                        description: '配置代码库快照备份和回退'
                    },
                    summarize: {
                        title: '上下文总结',
                        description: '压缩对话历史，减少 Token 使用量'
                    },
                    imageGen: {
                        title: '图像生成',
                        description: '配置 AI 图像生成工具'
                    },
                    context: {
                        title: '上下文感知',
                        description: '配置发送给 AI 的工作区上下文信息'
                    },
                    prompt: {
                        title: '系统提示词',
                        description: '自定义系统提示词的结构和内容'
                    },
                    tokenCount: {
                        title: 'Token 计数',
                        description: '配置用于计算 Token 数量的 API'
                    },
                    subagents: {
                        title: '子代理',
                        description: '配置可由 AI 调用的专业子代理'
                    },
                    appearance: {
                        title: '外观设置',
                        description: '配置界面外观相关选项'
                    },
                    general: {
                        title: '通用设置',
                        description: '基本配置选项'
                    }
                },
                proxy: {
                    title: '网络代理',
                    description: '配置 HTTP 代理用于 API 请求',
                    enable: '启用代理',
                    url: '代理地址',
                    urlPlaceholder: 'http://127.0.0.1:7890',
                    urlError: '请输入有效的代理地址（http:// 或 https://）',
                    save: '保存',
                    saveSuccess: '保存成功',
                    saveFailed: '保存失败'
                },
                language: {
                    title: '界面语言',
                    description: '选择界面显示语言',
                    placeholder: '选择语言',
                    autoDescription: '自动跟随 VS Code 语言设置'
                },
                appInfo: {
                    title: '应用信息',
                    name: 'Lim Code - Vibe Coding助手',
                    version: '版本：1.0.52',
                    repository: '项目仓库',
                    developer: '开发者'
                }
            },
            toolSettings: {
                files: {
                    applyDiff: {
                        autoApply: '自动应用修改',
                        enableAutoApply: '启用自动应用',
                        enableAutoApplyDesc: '开启后，AI 修改将在指定延迟后自动保存，无需手动确认',
                        autoSaveDelay: '自动保存延迟',
                        delayTime: '延迟时间',
                        delayTimeDesc: '修改显示后等待此时间再自动保存',
                        delay1s: '1 秒',
                        delay2s: '2 秒',
                        delay3s: '3 秒',
                        delay5s: '5 秒',
                        delay10s: '10 秒',
                        infoEnabled: '当前设置：AI 修改文件后，将在 {delay} 后自动保存并继续执行。',
                        infoDisabled: '当前设置：AI 修改文件后，需要您手动在编辑器中按 Ctrl+S 保存确认修改。'
                    },
                    listFiles: {
                        ignoreList: '忽略列表',
                        ignoreListHint: '（支持通配符，如 *.log, temp*）',
                        inputPlaceholder: '输入要忽略的文件或目录模式...',
                        deleteTooltip: '删除',
                        addButton: '添加'
                    }
                },
                search: {
                    findFiles: {
                        excludeList: '排除模式',
                        excludeListHint: '（glob 格式，如 **/node_modules/**）',
                        inputPlaceholder: '输入要排除的文件或目录模式...',
                        deleteTooltip: '删除',
                        addButton: '添加'
                    },
                    searchInFiles: {
                        excludeList: '排除模式',
                        excludeListHint: '（glob 格式，如 **/node_modules/**）',
                        inputPlaceholder: '输入要排除的文件或目录模式...',
                        deleteTooltip: '删除',
                        addButton: '添加'
                    }
                },
                terminal: {
                    executeCommand: {
                        shellEnv: 'Shell 环境',
                        defaultBadge: '默认',
                        available: '可用',
                        unavailable: '不可用',
                        setDefaultTooltip: '设为默认',
                        executablePath: '可执行文件路径（可选）：',
                        executablePathPlaceholder: '留空则使用系统 PATH 中的路径',
                        execTimeout: '执行超时',
                        timeoutHint: '命令执行超过此时间将自动终止',
                        timeout30s: '30 秒',
                        timeout1m: '1 分钟',
                        timeout2m: '2 分钟',
                        timeout5m: '5 分钟',
                        timeout10m: '10 分钟',
                        timeoutUnlimited: '无限制',
                        maxOutputLines: '最大输出行数',
                        maxOutputLinesHint: '发送给 AI 的终端输出的最后 N 行，避免输出过大',
                        unlimitedLines: '无限制',
                        tips: {
                            onlyEnabledUsed: '• 只有启用且可用的 Shell 才会被 AI 使用',
                            statusMeaning: '• ✓ 表示可用，✗ 表示不可用',
                            windowsRecommend: '• Windows 建议使用 PowerShell（支持 UTF-8）',
                            gitBashRequire: '• Git Bash 需要安装 Git for Windows',
                            wslRequire: '• WSL 需要启用 Windows Subsystem for Linux',
                            confirmSettings: '• 如需配置是否需要确认后执行，请前往"自动执行"设置页签'
                        }
                    }
                },
                media: {
                    common: {
                        returnImageToAI: '直接返回图片给 AI',
                        returnImageDesc: '启用后，处理结果的图片 base64 将直接作为工具响应返回给 AI，AI 可以直接查看和分析图片内容。',
                        returnImageDescDetail: '禁用后，只返回文字描述（如文件路径），AI 需要调用 read_file 工具才能查看图片。'
                    },
                    cropImage: {
                        title: '裁切图片',
                        description: '启用后，AI 可以直接查看裁切效果，判断区域是否正确。禁用可节省 token 消耗。'
                    },
                    generateImage: {
                        title: '图像生成',
                        description: '启用后，AI 可以直接看到生成的图片效果，便于判断是否需要重新生成或调整。禁用可节省 token 消耗。'
                    },
                    removeBackground: {
                        title: '抠图',
                        description: '启用后，AI 可以直接查看抠图效果，判断是否需要调整主体描述或重新处理。禁用可节省 token 消耗。'
                    },
                    resizeImage: {
                        title: '缩放图片',
                        description: '启用后，AI 可以直接查看缩放效果，判断尺寸是否合适。禁用可节省 token 消耗。'
                    },
                    rotateImage: {
                        title: '旋转图片',
                        description: '启用后，AI 可以直接查看旋转效果，判断角度是否正确。禁用可节省 token 消耗。'
                    }
                },
                common: {
                    loading: '加载中...',
                    loadingConfig: '加载配置...',
                    saving: '保存中...',
                    error: '错误',
                    retry: '重试'
                }
            },
            toolsSettings: {
                maxIterations: {
                    label: '单回合最大工具调用次数',
                    hint: '防止 AI 无限循环调用工具，-1 表示无限制',
                    unit: '次'
                },
                actions: {
                    refresh: '刷新',
                    enableAll: '全部启用',
                    disableAll: '全部禁用'
                },
                loading: '加载工具列表...',
                empty: '暂无可用工具',
                categories: {
                    file: '文件操作',
                    search: '搜索',
                    terminal: '终端',
                    lsp: '代码智能',
                    media: '媒体处理',
                    other: '其他'
                },
                dependency: {
                    required: '需要依赖',
                    requiredTooltip: '此工具需要安装依赖才能使用',
                    disabledTooltip: '工具已禁用或缺少依赖'
                },
                config: {
                    tooltip: '配置工具'
                }
            },
            tokenCountSettings: {
                description: '配置用于精确计算 Token 数量的 API。启用后，将在发送请求前调用对应渠道的 Token 计数 API 来获取准确的 Token 数量，用于更精准的上下文管理。',
                hint: '如果未配置或 API 调用失败，将回退到估算方法。',
                enableChannel: '启用此渠道的 Token 计数',
                baseUrl: 'API URL',
                apiKey: 'API Key',
                apiKeyPlaceholder: '输入 API Key',
                model: '模型名称',
                geminiUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens?key={key}',
                geminiUrlHint: '使用 {model} 和 {key} 作为占位符',
                geminiModelPlaceholder: 'gemini-2.5-pro',
                anthropicUrlPlaceholder: 'https://api.anthropic.com/v1/messages/count_tokens',
                anthropicModelPlaceholder: 'claude-sonnet-4-5',
                comingSoon: '即将推出',
                customApi: '自定义 API',
                openaiDocTitle: 'OpenAI 兼容 API 接口',
                openaiDocDesc: 'OpenAI 官方未提供独立的 Token 计数 API。如果您有自建或第三方兼容的 Token 计数服务，可以在此配置。',
                openaiUrlPlaceholder: 'https://your-api.example.com/count-tokens',
                openaiUrlHint: '您的自定义 Token 计数 API 端点',
                openaiModelPlaceholder: 'gpt-4o',
                apiDocumentation: 'API 接口规范',
                requestExample: '请求示例',
                requestBody: '// 请求体',
                responseFormat: '// 响应格式',
                openaiDocNote: '您的 API 需要返回包含 total_tokens 字段的 JSON 响应。请求体使用 OpenAI Messages 格式。',
                saveSuccess: '配置已保存',
                saveFailed: '保存失败'
            },
            appearanceSettings: {
                loadingText: {
                    title: '流式 Loading 文本',
                    description: '在 AI 流式输出时，消息底部的逐字波动指示器显示的文本。',
                    placeholder: '例如：思考中…',
                    defaultHint: '留空使用默认值：{text}'
                },
                saveSuccess: '保存成功',
                saveFailed: '保存失败'
            },
            storageSettings: {
                title: '存储路径',
                description: '配置对话历史、存档点等数据的存储位置',
                currentPath: '当前存储路径',
                customPath: '自定义路径',
                customPathPlaceholder: '输入自定义存储路径...',
                customPathHint: '留空则使用默认路径（扩展存储目录）',
                browse: '浏览',
                apply: '应用',
                reset: '重置为默认',
                migrate: '迁移数据',
                migrateHint: '将现有数据迁移到新路径',
                migrating: '迁移中...',
                validating: '验证中...',
                validation: {
                    valid: '路径有效',
                    invalid: '路径无效',
                    checking: '检查中...'
                },
                dialog: {
                    migrateTitle: '确认迁移数据',
                    migrateMessage: '是否将现有数据迁移到新路径？这将复制所有对话历史和存档点。',
                    migrateWarning: '迁移过程中请勿关闭窗口',
                    confirm: '确认迁移',
                    cancel: '取消'
                },
                notifications: {
                    pathUpdated: '存储路径已更新',
                    pathReset: '存储路径已重置为默认',
                    migrationSuccess: '数据迁移完成，请重新加载窗口以使更改生效',
                    migrationFailed: '数据迁移失败: {error}',
                    validationFailed: '路径验证失败: {error}'
                },
                reloadWindow: '重新加载窗口'
            }
        },

        channels: {
            common: {
                temperature: {
                    label: '温度 (Temperature)',
                    hint: '0.0 - 1.0, 默认 1.0',
                    toggleHint: '启用后此参数将发送到 API'
                },
                maxTokens: {
                    label: '最大输出Tokens',
                    placeholder: '4096',
                    toggleHint: '启用后此参数将发送到 API'
                },
                topP: {
                    label: 'Top-P',
                    hint: '0.0 - 1.0',
                    toggleHint: '启用后此参数将发送到 API'
                },
                topK: {
                    label: 'Top-K',
                    toggleHint: '启用后此参数将发送到 API'
                },
                thinking: {
                    title: '思考配置',
                    toggleHint: '启用后思考参数将发送到 API'
                },
                currentThinking: {
                    title: '当前轮次回传配置',
                    sendSignatures: '发送最新思考签名',
                    sendSignaturesHint: '保持当前步骤的思考衔接',
                    sendContent: '发送最新思考内容',
                    sendContentHint: '回传当前轮次的推理过程',
                },
                historyThinking: {
                    title: '历史回合回传配置',
                    sendSignatures: '发送历史思考签名',
                    sendSignaturesHint: '保持跨多轮交互的思考上下文',
                    sendContent: '发送历史思考内容',
                    sendContentHint: '让 AI 看到之前已完成回合的思考过程',
                    roundsLabel: '发送历史思考回合数',
                    roundsHint: '控制发送多少轮非最新回合的历史对话思考。-1 表示全部，0 表示不发送历史对话，正数 N 表示发送最近 N 轮（如 1 表示只发送倒数第二回合）'
                }
            },
            anthropic: {
                thinking: {
                    budgetLabel: '思考预算 (Budget Tokens)',
                    budgetPlaceholder: '10000',
                    budgetHint: '思考过程使用的最大 Token 数量，建议 5000-50000'
                }
            },
            gemini: {
                thinking: {
                    includeThoughts: '返回思考内容',
                    includeThoughtsHint: '启用后，API 响应将包含模型的思考过程',
                    mode: '思考强度模式',
                    modeHint: '默认: 使用 API 默认值 | 等级: 选择预设等级 | 预算: 自定义 token 数',
                    modeDefault: '默认',
                    modeLevel: '等级',
                    modeBudget: '预算',
                    levelLabel: '思考等级',
                    levelHint: 'minimal: 最少思考 | low: 较少思考 | medium: 中等 | high: 深度思考',
                    levelMinimal: '最少',
                    levelLow: '低',
                    levelMedium: '中',
                    levelHigh: '高',
                    budgetLabel: '思考预算 (Token)',
                    budgetPlaceholder: '1024',
                    budgetHint: '自定义思考过程允许使用的 token 数量'
                },
                historyThinking: {
                    sendContentHint: '启用后，将发送历史对话中的思考内容（包括摘要），这可能会显著增加上下文长度'
                }
            },
            openai: {
                frequencyPenalty: {
                    label: '频率惩罚 (Frequency Penalty)',
                    hint: '-2.0 - 2.0',
                    toggleHint: '启用后此参数将发送到 API'
                },
                presencePenalty: {
                    label: '存在惩罚 (Presence Penalty)',
                    hint: '-2.0 - 2.0',
                    toggleHint: '启用后此参数将发送到 API'
                },
                thinking: {
                    effortLabel: '思考强度 (Effort)',
                    effortHint: 'none: 不使用 | minimal: 极少 | low: 较少 | medium: 中等 | high: 较多 | xhigh: 最高',
                    effortNone: '无',
                    effortMinimal: '极少',
                    effortLow: '低',
                    effortMedium: '中',
                    effortHigh: '高',
                    effortXHigh: '最高',
                    summaryLabel: '输出详细程度 (Summary)',
                    summaryHint: 'auto: 自动选择 | concise: 简洁输出 | detailed: 详细输出',
                    summaryAuto: '自动',
                    summaryConcise: '简洁',
                    summaryDetailed: '详细'
                },
                historyThinking: {
                    sendSignaturesHint: '启用后，将发送历史对话中的思考签名（OpenAI 暂不支持）。不建议开启，且发送的是非最新一轮对话的签名',
                    sendContentHint: '启用后，将发送历史对话中的 reasoning_content（包括摘要），这可能会显著增加上下文长度'
                }
            },
            'openai-responses': {
                maxOutputTokens: {
                    label: '最大输出 Tokens',
                    placeholder: '8192',
                    hint: '对应 API 的 max_output_tokens 参数'
                },
                thinking: {
                    effortLabel: '思考强度 (Effort)',
                    effortHint: 'none: 不使用 | minimal: 极少 | low: 较少 | medium: 中等 | high: 较多 | xhigh: 最高',
                    effortNone: '无 (none)',
                    effortMinimal: '极少 (minimal)',
                    effortLow: '低 (low)',
                    effortMedium: '中 (medium)',
                    effortHigh: '高 (high)',
                    effortXHigh: '最高 (xhigh)',
                    summaryLabel: '输出详细程度 (Summary)',
                    summaryHint: 'auto: 自动选择 | concise: 简洁输出 | detailed: 详细输出',
                    summaryAuto: '自动',
                    summaryConcise: '简洁',
                    summaryDetailed: '详细'
                },
                historyThinking: {
                    sendSignaturesHint: '保持跨多轮交互的思考上下文',
                    sendContentHint: '启用后，将发送历史对话中的 reasoning_content，这将增加上下文长度'
                }
            },
            customBody: {
                hint: '添加自定义请求体字段，支持嵌套 JSON 覆盖',
                modeSimple: '简单模式',
                modeAdvanced: '复杂模式',
                keyPlaceholder: '键名 (如: extra_body)',
                valuePlaceholder: '值 (支持 JSON，如: {"key": "value"})',
                empty: '暂无自定义 Body 项',
                addItem: '添加项',
                jsonError: 'JSON 格式错误',
                jsonHint: '完整 JSON 格式，支持嵌套覆盖',
                jsonPlaceholder: '{\n  "extra_body": {\n    "google": {\n      "thinking_config": {\n        "include_thoughts": false\n      }\n    }\n  }\n}',
                enabled: '已启用',
                disabled: '已禁用',
                deleteTooltip: '删除'
            },
            customHeaders: {
                hint: '添加自定义 HTTP 请求标头，按照顺序发送到 API',
                keyPlaceholder: 'Header-Name',
                valuePlaceholder: 'Header Value',
                keyDuplicate: '键名重复',
                empty: '暂无自定义标头',
                addHeader: '添加标头',
                enabled: '已启用',
                disabled: '已禁用',
                deleteTooltip: '删除'
            },
            toolOptions: {
                cropImage: {
                    title: '裁切图片 (crop_image)',
                    useNormalizedCoords: '使用归一化坐标 (0-1000)',
                    enabledTitle: '启用时',
                    enabledNote: '适用于 Gemini 等使用归一化坐标的模型',
                    disabledTitle: '禁用时',
                    disabledNote: '模型需自行计算图片的实际像素坐标',
                    coordTopLeft: '= 左上角',
                    coordBottomRight: '= 右下角',
                    coordCenter: '= 中心点'
                }
            },
            tokenCountMethod: {
                title: 'Token 计数方式',
                label: '计数方式',
                placeholder: '选择计数方式',
                hint: '选择用于计算 token 数量的方式，影响上下文裁剪的精确度',
                options: {
                    channelDefault: '使用渠道默认',
                    gemini: 'Gemini API',
                    openaiCustom: '自定义 OpenAI 格式',
                    openaiCustomDesc: '使用自定义 API 端点',
                    openaiResponses: 'OpenAI Responses API',
                    anthropic: 'Anthropic API',
                    local: '本地估算',
                    localDesc: '约 4 字符 = 1 token'
                },
                defaultDesc: {
                    gemini: '默认使用 Gemini countTokens API',
                    anthropic: '默认使用 Anthropic count_tokens API',
                    openai: '默认使用本地估算（OpenAI 无官方接口）'
                },
                apiConfig: {
                    title: 'API 配置',
                    url: 'API URL',
                    urlHint: '留空则使用渠道的 URL',
                    apiKey: 'API Key',
                    apiKeyPlaceholder: '输入 API Key',
                    apiKeyHint: '留空则使用渠道的 API Key',
                    model: '模型',
                    modelHint: '用于 token 计数的模型名称'
                }
            }
        },

        tools: {
            executing: '执行中...',
            executed: '已执行',
            failed: '执行失败',
            cancelled: '已取消',
            approve: '批准',
            reject: '拒绝',
            autoExecuted: '自动执行',
            terminate: '终止',
            saveToPath: '保存到路径',
            openFile: '打开文件',
            openFolder: '打开文件夹',
            viewDetails: '查看详情',
            hideDetails: '隐藏详情',
            parameters: '参数',
            result: '结果',
            error: '错误',
            duration: '耗时',
            file: {
                readFile: '读取文件',
                writeFile: '写入文件',
                deleteFile: '删除文件',
                createDirectory: '创建目录',
                listFiles: '列出文件',
                applyDiff: '应用差异',
                filesRead: '已读取文件',
                filesWritten: '已写入文件',
                filesDeleted: '已删除文件',
                directoriesCreated: '已创建目录',
                changesApplied: '已应用更改',
                applyDiffPanel: {
                    title: '应用差异',
                    changes: '个更改',
                    diffApplied: '差异已应用',
                    pending: '待审阅',
                    accepted: '已接受',
                    rejected: '已拒绝',
                    line: '起始行',
                    diffNumber: '#',
                    collapse: '收起',
                    expandRemaining: '展开剩余 {count} 行',
                    copied: '已复制',
                    copyNew: '复制新内容',
                    deletedLines: '删除',
                    addedLines: '新增',
                    userEdited: '用户已编辑',
                    userEditedContent: '用户修改后的内容'
                },
                createDirectoryPanel: {
                    title: '创建目录',
                    total: '共 {count} 个',
                    noDirectories: '没有要创建的目录',
                    success: '成功',
                    failed: '失败'
                },
                deleteFilePanel: {
                    title: '删除文件',
                    total: '共 {count} 个',
                    noFiles: '没有要删除的文件',
                    success: '成功',
                    failed: '失败'
                },
                listFilesPanel: {
                    title: '列出文件',
                    recursive: '递归',
                    totalStat: '{dirCount} 个目录, {folderCount} 个文件夹, {fileCount} 个文件',
                    copyAll: '复制全部列表',
                    copyList: '复制列表',
                    dirStat: '{folderCount} 文件夹, {fileCount} 文件',
                    collapse: '收起',
                    expandRemaining: '展开剩余 {count} 个',
                    emptyDirectory: '目录为空'
                },
                readFilePanel: {
                    title: '读取文件',
                    total: '共 {count} 个',
                    lines: '{count} 行',
                    copied: '已复制',
                    copyContent: '复制内容',
                    binaryFile: '二进制文件',
                    unknownSize: '未知大小',
                    collapse: '收起',
                    expandRemaining: '展开剩余 {count} 行',
                    emptyFile: '文件为空'
                },
                writeFilePanel: {
                    title: '写入文件',
                    total: '共 {count} 个',
                    lines: '{count} 行',
                    copied: '已复制',
                    copyContent: '复制内容',
                    collapse: '收起',
                    expandRemaining: '展开剩余 {count} 行',
                    noContent: '无写入内容',
                    viewContent: '内容',
                    viewDiff: '差异',
                    loadingDiff: '加载差异中...',
                    actions: {
                        created: '新建',
                        modified: '修改',
                        unchanged: '未变',
                        write: '写入'
                    }
                }
            },
            lsp: {
                getSymbols: '获取符号',
                gotoDefinition: '跳转定义',
                findReferences: '查找引用',
                getSymbolsPanel: {
                    title: '文件符号',
                    totalFiles: '共 {count} 个文件',
                    totalSymbols: '共 {count} 个符号',
                    noSymbols: '未找到符号',
                    symbolCount: '{count} 个符号',
                    collapse: '收起',
                    expandRemaining: '展开剩余 {count} 个',
                    copyAll: '复制全部',
                    copied: '已复制'
                },
                gotoDefinitionPanel: {
                    title: '定义',
                    definitionFound: '找到定义',
                    noDefinition: '未找到定义',
                    lines: '{count} 行',
                    copyCode: '复制代码',
                    copied: '已复制'
                },
                findReferencesPanel: {
                    title: '引用',
                    totalReferences: '共 {count} 个引用',
                    totalFiles: '{count} 个文件',
                    noReferences: '未找到引用',
                    referencesInFile: '{count} 个引用',
                    collapse: '收起',
                    expandRemaining: '展开剩余 {count} 个'
                }
            },
            mcp: {
                mcpTool: 'MCP 工具',
                serverName: '服务器名称',
                toolName: '工具名称',
                mcpToolPanel: {
                    requestParams: '请求参数',
                    errorInfo: '错误信息',
                    responseResult: '响应结果',
                    waitingResponse: '等待响应...'
                }
            },
            media: {
                generateImage: '生成图片',
                resizeImage: '缩放图片',
                cropImage: '裁切图片',
                rotateImage: '旋转图片',
                removeBackground: '去除背景',
                generating: '生成中...',
                processing: '处理中...',
                imagesGenerated: '已生成图片',
                saveImage: '保存图片',
                saveTo: '保存到',
                saved: '已保存',
                saveFailed: '保存失败',
                cropImagePanel: {
                    title: '裁切图片',
                    cancel: '终止',
                    cancelCrop: '终止裁切',
                    status: {
                        needDependency: '需要依赖',
                        cancelled: '已取消',
                        failed: '失败',
                        success: '成功',
                        error: '错误',
                        processing: '处理中...',
                        waiting: '等待中'
                    },
                    checkingDependency: '检查依赖状态...',
                    dependencyMessage: '裁切功能需要 sharp 库来处理图像。',
                    batchCrop: '批量裁切 ({count})',
                    cropTask: '裁切任务',
                    coordsHint: '坐标范围 0-1000（归一化），自动转换为实际像素',
                    cancelledMessage: '用户已取消裁切操作',
                    resultTitle: '裁切结果 ({count} 张)',
                    original: '原始:',
                    cropped: '裁切后:',
                    cropResultN: '裁切结果 {n}',
                    saved: '已保存',
                    overwriteSave: '覆盖保存',
                    save: '保存',
                    openInEditor: '在编辑器中打开',
                    savePaths: '保存路径:',
                    croppingImages: '正在裁切图片...',
                    openFileFailed: '打开文件失败:',
                    saveFailed: '保存失败'
                },
                generateImagePanel: {
                    title: '图像生成',
                    cancel: '终止',
                    cancelGeneration: '终止生成',
                    status: {
                        needDependency: '需要依赖',
                        cancelled: '已取消',
                        failed: '失败',
                        success: '成功',
                        error: '错误',
                        generating: '生成中...',
                        waiting: '等待中'
                    },
                    batchTasks: '批量任务 ({count})',
                    generateTask: '生成任务',
                    outputPath: '输出路径',
                    aspectRatio: '宽高比',
                    imageSize: '图片尺寸',
                    referenceImages: '{count} 张参考',
                    cancelledMessage: '用户已取消图像生成',
                    tasksFailed: '{count} 个任务失败',
                    resultTitle: '生成结果 ({count} 张)',
                    saved: '已保存',
                    overwriteSave: '覆盖保存',
                    save: '保存',
                    openInEditor: '在编辑器中打开',
                    savePaths: '保存路径:',
                    generatingImages: '正在生成图像...',
                    openFileFailed: '打开文件失败:',
                    saveFailed: '保存失败'
                },
                removeBackgroundPanel: {
                    title: '抠图',
                    cancel: '终止',
                    cancelRemove: '终止抠图',
                    status: {
                        needDependency: '需要依赖',
                        cancelled: '已取消',
                        failed: '失败',
                        success: '成功',
                        error: '错误',
                        processing: '处理中...',
                        waiting: '等待中',
                        disabled: '已禁用'
                    },
                    checkingDependency: '检查依赖状态...',
                    dependencyMessage: '抠图功能需要 sharp 库来处理图像。',
                    batchTasks: '批量任务 ({count})',
                    removeTask: '抠图任务',
                    subjectDescription: '主体描述',
                    maskPath: '遮罩: {path}',
                    needSharp: {
                        title: '需要安装 sharp 库',
                        message: '已生成遮罩图，但需要安装 sharp 库才能完成完整抠图。',
                        installCmd: 'pnpm add sharp'
                    },
                    cancelledMessage: '用户已取消抠图操作',
                    tasksFailed: '{count} 个任务失败',
                    resultTitle: '处理结果 ({count} 张)',
                    maskImage: '遮罩图',
                    resultImage: '抠图结果 {n}',
                    saved: '已保存',
                    overwriteSave: '覆盖保存',
                    save: '保存',
                    openInEditor: '在编辑器中打开',
                    savePaths: '保存路径:',
                    processingImages: '正在处理图片...',
                    openFileFailed: '打开文件失败:',
                    saveFailed: '保存失败'
                },
                resizeImagePanel: {
                    title: '缩放图片',
                    cancel: '终止',
                    cancelResize: '终止缩放',
                    status: {
                        needDependency: '需要依赖',
                        cancelled: '已取消',
                        failed: '失败',
                        success: '成功',
                        error: '错误',
                        processing: '处理中...',
                        waiting: '等待中'
                    },
                    checkingDependency: '检查依赖状态...',
                    dependencyMessage: '缩放功能需要 sharp 库来处理图像。',
                    batchResize: '批量缩放 ({count})',
                    resizeTask: '缩放任务',
                    sizeHint: '图片将拉伸填充到目标尺寸（不保持宽高比）',
                    cancelledMessage: '用户已取消缩放操作',
                    resultTitle: '缩放结果 ({count} 张)',
                    resizeResultN: '缩放结果 {n}',
                    dimensions: {
                        original: '原始:',
                        resized: '缩放后:'
                    },
                    saved: '已保存',
                    overwriteSave: '覆盖保存',
                    save: '保存',
                    openInEditor: '在编辑器中打开',
                    savePaths: '保存路径:',
                    resizingImages: '正在缩放图片...',
                    openFileFailed: '打开文件失败:',
                    saveFailed: '保存失败'
                },
                rotateImagePanel: {
                    title: '旋转图片',
                    cancel: '终止',
                    cancelRotate: '终止旋转',
                    status: {
                        needDependency: '需要依赖',
                        cancelled: '已取消',
                        failed: '失败',
                        success: '成功',
                        error: '错误',
                        processing: '处理中...',
                        waiting: '等待中'
                    },
                    checkingDependency: '检查依赖状态...',
                    dependencyMessage: '旋转功能需要 sharp 库来处理图像。',
                    batchRotate: '批量旋转 ({count})',
                    rotateTask: '旋转任务',
                    angleHint: '正角度逆时针，负角度顺时针。PNG/WebP 填充透明，JPG 填充黑色',
                    angleFormat: {
                        counterclockwise: '逆时针',
                        clockwise: '顺时针'
                    },
                    cancelledMessage: '用户已取消旋转操作',
                    resultTitle: '旋转结果 ({count} 张)',
                    rotateResultN: '旋转结果 {n}',
                    dimensions: {
                        rotation: '旋转:',
                        size: '尺寸:'
                    },
                    saved: '已保存',
                    overwriteSave: '覆盖保存',
                    save: '保存',
                    openInEditor: '在编辑器中打开',
                    savePaths: '保存路径:',
                    rotatingImages: '正在旋转图片...',
                    openFileFailed: '打开文件失败:',
                    saveFailed: '保存失败'
                }
            },
            search: {
                findFiles: '查找文件',
                searchInFiles: '在文件中搜索',
                filesFound: '找到文件',
                matchesFound: '找到匹配',
                noResults: '无结果',
                findFilesPanel: {
                    title: '查找文件',
                    totalFiles: '共 {count} 个文件',
                    fileCount: '{count} 个文件',
                    truncated: '已截断',
                    collapse: '收起',
                    expandRemaining: '展开剩余 {count} 个文件',
                    noFiles: '没有找到匹配的文件'
                },
                searchInFilesPanel: {
                    title: '搜索内容',
                    replaceTitle: '搜索替换',
                    regex: '正则',
                    matchCount: '{count} 个匹配',
                    fileCount: '{count} 个文件',
                    truncated: '已截断',
                    keywords: '关键词：',
                    replaceWith: '替换为：',
                    emptyString: '(空字符串)',
                    path: '路径：',
                    pattern: '模式：',
                    noResults: '没有找到匹配的内容',
                    collapse: '收起',
                    expandRemaining: '展开剩余 {count} 个匹配',
                    replacements: '已替换 {count} 处',
                    replacementsInFile: '{count} 处替换',
                    filesModified: '{count} 个文件',
                    viewMatches: '匹配项',
                    viewDiff: '差异',
                    loadingDiff: '加载差异中...'
                }
            },
            terminal: {
                executeCommand: '执行命令',
                command: '命令',
                output: '输出',
                exitCode: '退出码',
                running: '运行中',
                terminated: '已终止',
                terminateCommand: '终止命令',
                executeCommandPanel: {
                    title: '终端',
                    status: {
                        failed: '失败',
                        terminated: '已终止',
                        success: '成功',
                        exitCode: '退出码: {code}',
                        running: '运行中...',
                        pending: '等待中'
                    },
                    terminate: '终止',
                    terminateTooltip: '终止进程',
                    copyOutput: '复制输出',
                    copied: '已复制',
                    output: '输出',
                    truncatedInfo: '显示最后 {outputLines} 行 (共 {totalLines} 行)',
                    autoScroll: '自动滚动',
                    waitingOutput: '等待输出...',
                    noOutput: '没有输出',
                    executing: '命令执行中...'
                }
            },
            subagents: {
                title: '子代理',
                task: '任务',
                context: '上下文',
                completed: '执行完成',
                failed: '执行失败',
                executing: '正在执行...',
                partialResponse: '部分响应'
            }
        }
    },

    app: {
        retryPanel: {
            title: '请求失败，正在自动重试',
            cancelTooltip: '取消重试',
            defaultError: '请求失败'
        }
    },

    errors: {
        networkError: '网络错误，请检查网络连接',
        apiError: 'API 请求失败',
        timeout: '请求超时',
        invalidConfig: '配置无效',
        fileNotFound: '文件未找到',
        permissionDenied: '权限被拒绝',
        unknown: '未知错误',
        connectionFailed: '连接失败',
        authFailed: '认证失败',
        rateLimited: '请求过于频繁',
        serverError: '服务器错误',
        invalidResponse: '响应格式无效',
        cancelled: '操作已取消'
    },

    composables: {
        useChat: {
            errors: {
                sendFailed: '发送消息失败',
                retryFailed: '重试失败',
                editRetryFailed: '编辑重试失败',
                deleteFailed: '删除失败',
                streamError: '流式响应错误',
                loadHistoryFailed: '加载历史记录失败'
            }
        },
        useConversations: {
            defaultTitle: '无标题',
            newChatTitle: '新对话',
            errors: {
                loadFailed: '加载对话列表失败',
                createFailed: '创建对话失败',
                deleteFailed: '删除对话失败',
                updateTitleFailed: '更新标题失败'
            },
            relativeTime: {
                justNow: '刚刚',
                minutesAgo: '{minutes}分钟前',
                hoursAgo: '{hours}小时前',
                daysAgo: '{days}天前'
            }
        },
        useAttachments: {
            errors: {
                validationFailed: '附件验证失败',
                createThumbnailFailed: '创建缩略图失败',
                createVideoThumbnailFailed: '创建视频缩略图失败',
                readFileFailed: '读取文件失败',
                loadVideoFailed: '加载视频失败',
                readResultNotString: '读取结果不是字符串'
            }
        }
    },

    stores: {
        terminalStore: {
            errors: {
                killTerminalFailed: '杀死终端失败',
                refreshOutputFailed: '刷新终端输出失败'
            }
        },
        chatStore: {
            defaultTitle: '无标题',
            errors: {
                loadConversationsFailed: '加载对话列表失败',
                createConversationFailed: '创建对话失败',
                deleteConversationFailed: '删除对话失败',
                sendMessageFailed: '发送消息失败',
                streamError: '流式响应错误',
                loadHistoryFailed: '加载历史记录失败',
                retryFailed: '重试失败',
                editRetryFailed: '编辑重试失败',
                deleteFailed: '删除失败',
                noConversationSelected: '未选择对话',
                unknownError: '未知错误',
                restoreFailed: '恢复失败',
                restoreCheckpointFailed: '恢复检查点失败',
                restoreRetryFailed: '回档并重试失败',
                restoreDeleteFailed: '回档并删除失败',
                noConfigSelected: '未选择配置',
                summarizeFailed: '总结失败',
                restoreEditFailed: '回档并编辑失败'
            },
            relativeTime: {
                justNow: '刚刚',
                minutesAgo: '{minutes}分钟前',
                hoursAgo: '{hours}小时前',
                daysAgo: '{days}天前'
            }
        }
    }
};

export default zhCN;