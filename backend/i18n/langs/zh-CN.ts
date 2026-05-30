/**
 * LimCode Backend - 中文语言包
 */

import type { BackendLanguageMessages } from '../types';

const zhCN: BackendLanguageMessages = {
    core: {
        registry: {
            moduleAlreadyRegistered: '模块 "{moduleId}" 已经注册',
            duplicateApiName: '模块 "{moduleId}" 中存在重复的 API 名称: {apiName}',
            registeringModule: '[ModuleRegistry] 注册模块: {moduleId} ({moduleName} v{version})',
            moduleNotRegistered: '模块未注册: {moduleId}',
            unregisteringModule: '[ModuleRegistry] 取消注册模块: {moduleId}',
            apiNotFound: 'API 不存在: {moduleId}.{apiName}',
            missingRequiredParams: '缺少必需参数: {params}'
        }
    },

    modules: {
        config: {
            errors: {
                configNotFound: '配置不存在: {configId}',
                configExists: '配置已存在: {configId}，使用 overwrite 选项覆盖',
                invalidConfig: '无效的配置',
                validationFailed: '配置验证失败: {errors}',
                saveFailed: '保存配置失败',
                loadFailed: '加载配置失败'
            },
            validation: {
                nameRequired: '名称不能为空',
                typeRequired: '类型不能为空',
                invalidUrl: 'API URL 无效',
                apiKeyEmpty: 'API Key 为空，需要配置后才能使用',
                modelNotSelected: '有可用模型但未选择当前使用的模型',
                temperatureRange: 'temperature 必须在 0.0 - 2.0 之间',
                maxOutputTokensMin: 'maxOutputTokens 必须大于 0',
                maxOutputTokensHigh: 'maxOutputTokens 过大，可能导致高延迟',
                openaiNotImplemented: 'OpenAI 配置验证尚未实现',
                anthropicNotImplemented: 'Anthropic 配置验证尚未实现'
            }
        },

        conversation: {
            defaultTitle: '对话 {conversationId}',
            errors: {
                conversationNotFound: '对话未找到: {conversationId}',
                conversationExists: '对话已存在: {conversationId}',
                messageNotFound: '消息未找到: {messageId}',
                messageIndexOutOfBounds: '消息索引越界: {index}',
                snapshotNotFound: '快照不存在: {snapshotId}',
                snapshotNotBelongToConversation: '快照不属于此对话',
                saveFailed: '保存对话失败',
                loadFailed: '加载对话失败'
            }
        },

        mcp: {
            errors: {
                connectionFailed: '连接失败: {serverName}',
                serverNotFound: '服务器不存在: {serverId}',
                serverNotFoundWithAvailable: '服务器不存在: {serverId}。可用的服务器: {available}',
                serverDisabled: '服务器未启用: {serverId}',
                serverNotConnected: '服务器未连接: {serverName}',
                clientNotConnected: '客户端未连接',
                toolCallFailed: '工具调用失败',
                requestTimeout: '请求超时 ({timeout}ms)',
                invalidServerId: 'ID 只能包含字母、数字、下划线和中划线',
                serverIdExists: '服务器 ID "{serverId}" 已存在'
            },
            status: {
                connecting: '正在连接...',
                connected: '已连接',
                disconnected: '已断开',
                error: '错误'
            }
        },

        checkpoint: {
            description: {
                before: '执行前',
                after: '执行后'
            },
            restore: {
                success: '已恢复到 "{toolName}" {phase}的状态',
                filesUpdated: '{count} 个文件已更新',
                filesDeleted: '{count} 个文件已删除',
                filesUnchanged: '{count} 个文件未变化'
            },
            defaultConversationTitle: '对话 {conversationId}',
            errors: {
                createFailed: '创建检查点失败',
                restoreFailed: '恢复检查点失败',
                deleteFailed: '删除检查点失败'
            }
        },

        settings: {
            errors: {
                loadFailed: '加载设置失败',
                saveFailed: '保存设置失败',
                invalidValue: '无效的设置值'
            },
            storage: {
                pathNotAbsolute: '路径必须是绝对路径: {path}',
                pathNotDirectory: '路径必须是目录: {path}',
                createDirectoryFailed: '创建目录失败: {error}',
                migrationFailed: '迁移失败: {error}',
                migrationSuccess: '存储迁移完成',
                migratingFiles: '正在迁移文件...',
                migratingConversations: '正在迁移对话...',
                migratingCheckpoints: '正在迁移存档点...',
                migratingConfigs: '正在迁移配置...'
            }
        },

        dependencies: {
            descriptions: {
                sharp: '高性能图像处理库，用于抠图功能的遮罩应用'
            },
            errors: {
                requiresContext: 'DependencyManager 需要首次调用时传入 ExtensionContext',
                unknownDependency: '未知依赖: {name}',
                nodeModulesNotFound: '安装后未找到 node_modules 目录',
                moduleNotFound: '安装后未找到 {name} 模块',
                installFailed: '安装失败: {error}',
                uninstallFailed: '卸载 {name} 失败',
                loadFailed: '加载 {name} 失败'
            },
            progress: {
                installing: '正在安装 {name}...',
                downloading: '正在下载 {name}...',
                installSuccess: '{name} 安装成功！'
            }
        },

        channel: {
            formatters: {
                gemini: {
                    errors: {
                        invalidResponse: '无效的 Gemini API 响应: 没有候选结果',
                        apiError: 'API 返回错误状态: {code}'
                    }
                },
                anthropic: {
                    errors: {
                        invalidResponse: '无效的 Anthropic API 响应: 没有内容'
                    }
                },
                openai: {
                    errors: {
                        invalidResponse: '无效的 OpenAI API 响应: 没有选项'
                    }
                }
            },
            errors: {
                configNotFound: '配置不存在: {configId}',
                configDisabled: '配置已禁用: {configId}',
                unsupportedChannelType: '不支持的渠道类型: {type}',
                configValidationFailed: '配置验证失败: {configId}',
                buildRequestFailed: '构建请求失败: {error}',
                apiError: 'API 返回错误状态: {status}',
                parseResponseFailed: '解析响应失败: {error}',
                httpRequestFailed: 'HTTP 请求失败: {error}',
                parseStreamChunkFailed: '解析流式响应块失败: {error}',
                streamRequestFailed: '流式请求失败: {error}',
                requestTimeout: '请求超时 ({timeout}ms)',
                requestTimeoutNoResponse: '请求超时 ({timeout}ms 内无响应)',
                requestCancelled: '请求已取消',
                requestAborted: '请求已中止',
                noResponseBody: '没有响应体'
            },
            modelList: {
                errors: {
                    apiKeyRequired: 'API Key 是必需的',
                    fetchModelsFailed: '获取模型列表失败: {error}',
                    unsupportedConfigType: '不支持的配置类型: {type}'
                }
            }
        },

        api: {
            channel: {
                errors: {
                    listChannelsFailed: '获取渠道配置列表失败',
                    channelNotFound: '渠道配置不存在: {channelId}',
                    getChannelFailed: '获取渠道配置失败',
                    channelAlreadyExists: '渠道配置已存在: {channelId}',
                    createChannelFailed: '创建渠道配置失败',
                    updateChannelFailed: '更新渠道配置失败',
                    deleteChannelFailed: '删除渠道配置失败',
                    setChannelStatusFailed: '设置渠道状态失败'
                }
            },
            settings: {
                errors: {
                    getSettingsFailed: '获取设置失败',
                    updateSettingsFailed: '更新设置失败',
                    setActiveChannelFailed: '设置活动渠道失败',
                    setToolStatusFailed: '设置工具状态失败',
                    batchSetToolStatusFailed: '批量设置工具状态失败',
                    setDefaultToolModeFailed: '设置默认工具模式失败',
                    updateUISettingsFailed: '更新 UI 设置失败',
                    updateProxySettingsFailed: '更新代理设置失败',
                    resetSettingsFailed: '重置设置失败',
                    toolRegistryNotAvailable: '工具注册器不可用',
                    getToolsListFailed: '获取工具列表失败',
                    getToolConfigFailed: '获取工具配置失败',
                    updateToolConfigFailed: '更新工具配置失败',
                    updateListFilesConfigFailed: '更新 list_files 配置失败',
                    updateApplyDiffConfigFailed: '更新 apply_diff 配置失败',
                    getCheckpointConfigFailed: '获取存档点配置失败',
                    updateCheckpointConfigFailed: '更新存档点配置失败',
                    getSummarizeConfigFailed: '获取总结配置失败',
                    updateSummarizeConfigFailed: '更新总结配置失败',
                    getGenerateImageConfigFailed: '获取图像生成配置失败',
                    updateGenerateImageConfigFailed: '更新图像生成配置失败'
                }
            },
            models: {
                errors: {
                    configNotFound: '配置不存在',
                    getModelsFailed: '获取模型列表失败',
                    addModelsFailed: '添加模型失败',
                    removeModelFailed: '移除模型失败',
                    modelNotInList: '模型不在列表中',
                    setActiveModelFailed: '设置激活模型失败'
                }
            },
            mcp: {
                errors: {
                    listServersFailed: '获取 MCP 服务器列表失败',
                    serverNotFound: 'MCP 服务器不存在: {serverId}',
                    getServerFailed: '获取 MCP 服务器失败',
                    createServerFailed: '创建 MCP 服务器失败',
                    updateServerFailed: '更新 MCP 服务器失败',
                    deleteServerFailed: '删除 MCP 服务器失败',
                    setServerStatusFailed: '设置 MCP 服务器状态失败',
                    connectServerFailed: '连接 MCP 服务器失败',
                    disconnectServerFailed: '断开 MCP 服务器失败'
                }
            },
            chat: {
                errors: {
                    configNotFound: '配置不存在: {configId}',
                    configDisabled: '配置已禁用: {configId}',
                    maxToolIterations: '达到最大工具调用次数限制 ({maxIterations})',
                    unknownError: '未知错误',
                    toolExecutionSuccess: '工具执行成功',
                    mcpToolCallFailed: 'MCP 工具调用失败',
                    invalidMcpToolName: '无效的 MCP 工具名称: {toolName}',
                    toolNotFound: '工具不存在: {toolName}',
                    toolExecutionFailed: '工具执行失败',
                    noHistory: '对话历史为空',
                    lastMessageNotModel: '最后一条消息不是模型消息',
                    noFunctionCalls: '没有待确认的工具调用',
                    userRejectedTool: '用户拒绝执行此工具',
                    notEnoughRounds: '对话回合数不足，当前 {currentRounds} 轮，保留 {keepRounds} 轮，无需总结',
                    notEnoughContent: '对话回合数不足，当前 {currentRounds} 轮，保留 {keepRounds} 轮，没有可总结的内容',
                    noMessagesToSummarize: '没有需要总结的消息',
                    summarizeAborted: '总结请求已取消',
                    emptySummary: 'AI 生成的总结为空',
                    messageNotFound: '消息不存在: 索引 {messageIndex}',
                    canOnlyEditUserMessage: '只能编辑用户消息，当前消息角色为: {role}'
                },
                prompts: {
                    defaultSummarizePrompt: `请将以上对话内容进行简洁总结，直接输出总结内容，不需要任何格式标记。

要求：
1. 保留关键信息和上下文要点
2. 去除冗余内容和工具调用细节
3. 概括对话的主题、讨论的问题、得出的结论
4. 保留重要的技术细节和决策
5. 直接输出总结内容，不要添加任何前缀、标题或格式标记`,
                    summaryPrefix: '[对话总结]',
                    autoSummarizePrompt: `请总结以上对话历史，输出以下内容，用于 AI 继续完成未完成的任务。

## 用户需求
用户想要完成什么（整体目标）。

## 已完成的工作
按时间顺序列出已经做了哪些事，包括改了哪些文件、做了什么决策。
文件路径、变量名、配置值等必须精确保留，不要泛化。

## 当前进度
做到了哪一步，正在做什么。

## 待办事项
接下来还需要做什么，按优先级列出。

## 重要约定
用户提出的限制、偏好、技术约束等（如"不使用第三方库"、"使用 TypeScript"等）。

直接输出内容，不要添加前缀。`
                },
                contextCommands: {
                    labels: {
                        projection: '投影',
                        ledgerEntry: '账本记录',
                        lossy: '有损',
                        reversible: '可恢复',
                        yes: '是',
                        no: '否',
                        nextActions: '后续操作：'
                    },
                    confirmation: {
                        title: '确认 {command}',
                        description: '{command} 会更新当前上下文投影，并写入上下文账本记录。原始历史不会被删除。执行确认命令继续：{confirmedCommand}'
                    },
                    undo: {
                        unavailableTitle: '无法撤销上下文操作',
                        unavailableDescription: '当前没有可恢复的上下文操作。',
                        completeTitle: '上下文撤销完成',
                        completeDescription: '最近的可恢复上下文投影已恢复。',
                        failedTitle: '上下文撤销失败',
                        recoveryHint: '运行 /context-status 检查当前上下文状态。'
                    },
                    restore: {
                        missingProjectionIdTitle: '恢复上下文需要投影 ID',
                        missingProjectionIdDescription: '用法: /context-restore <投影ID>',
                        completeTitle: '上下文恢复完成',
                        completeDescription: '投影已恢复。',
                        failedTitle: '上下文恢复失败',
                        recoveryHint: '从 /context-status 获取投影 ID。'
                    },
                    reset: {
                        completeTitle: '上下文重置完成',
                        completeDescription: '工作上下文投影已从不可变历史中重建，原始消息未被删除。',
                        failedTitle: '上下文重置失败',
                        recoveryHint: '重试前先运行 /context-status。',
                        restoreBoundaryMessage: '投影已从不可变对话历史中重建。'
                    },
                    compact: {
                        missingConfigTitle: '压缩上下文缺少配置',
                        missingConfigDescription: '压缩上下文需要一个模型配置。',
                        failedTitle: '压缩上下文失败',
                        configNotFoundDescription: '模型配置不存在：{configId}',
                        configDisabledDescription: '模型配置已禁用：{configId}',
                        notNeededTitle: '无需压缩上下文',
                        notNeededDescription: '当前投影边界之后只有 {rounds} 个最近回合，没有可裁剪的旧回合。',
                        unavailableTitle: '无法压缩上下文',
                        unavailableNoBoundaryDescription: '没有可用于手动裁剪的安全回合边界。',
                        completeTitle: '上下文压缩完成',
                        trimmedDescription: '工作上下文已裁剪为最近 {keepRecentRounds} 轮。原始历史没有被删除。',
                        restoreBoundaryMessage: '手动裁剪仅改变了工作投影，不可变源历史仍然保留。',
                        autoTrimRestoreBoundaryMessage: '自动裁剪仅改变了工作投影，不可变历史仍然可用。',
                        recoveryHint: '运行 /context-status 检查当前上下文投影。'
                    },
                    summarize: {
                        missingConfigTitle: '上下文命令缺少配置',
                        missingConfigDescription: '总结上下文需要一个模型配置。',
                        compactCompleteTitle: '上下文压缩完成',
                        summarizeCompleteTitle: '上下文总结完成',
                        summarizedDescription: '已总结 {count} 条消息。此操作是有损操作，并已记录到上下文账本。',
                        compactFailedTitle: '上下文压缩失败',
                        summarizeFailedTitle: '上下文总结失败',
                        restoreBoundaryMessage: '已创建有损总结投影。原始历史仍然保留，但总结文本不是原文替换。',
                        recoveryHint: '检查模型配置和上下文状态后重试。'
                    },
                    status: {
                        title: '上下文状态',
                        noProjectionDescription: '当前没有已压缩的工作投影。此对话正在使用完整历史，共 {historyLength} 条消息。上下文账本记录数：{ledgerCount}。',
                        projectionDescription: '当前投影 {projectionId} 为 {mode} 模式，从消息索引 {startIndex} 开始，{lossiness}，且{reversibility}。上下文账本记录数：{ledgerCount}。',
                        lossySummaryData: '依赖有损总结数据',
                        losslessTrimmedHistory: '保留无损裁剪历史',
                        reversibleProjection: '可通过已记录的投影历史恢复',
                        irreversibleProjection: '无法仅从工作投影完整恢复',
                        degradedDescription: '上下文状态需要关注：{reason}。历史消息数：{count}。可用的恢复操作已列在下方。',
                        integrityDegradedReason: '对话存储完整性状态：{status}',
                        legacyMigrationMessage: '投影从旧版 trimState 迁移而来，无法获取准确的来源操作信息。'
                    }
                }
            }
        }
    },

    tools: {
        errors: {
            toolNotFound: '工具未找到: {toolName}',
            executionFailed: '工具执行失败: {error}',
            invalidParams: '无效的参数',
            timeout: '执行超时'
        },

        file: {
            errors: {
                fileNotFound: '文件未找到: {path}',
                readFailed: '读取文件失败: {error}',
                writeFailed: '写入文件失败: {error}',
                deleteFailed: '删除文件失败: {error}',
                permissionDenied: '权限被拒绝: {path}'
            },
            diffManager: {
                saved: '已保存修改: {filePath}',
                saveFailed: '保存失败: {error}',
                savedShort: '已保存: {filePath}',
                rejected: '已拒绝修改: {filePath}',
                diffTitle: '{filePath} (AI 修改 - Ctrl+S 保存)',
                diffGuardWarning: '此次修改删除了 {deletePercent}% 的文件内容（{deletedLines}/{totalLines} 行），超过 {threshold}% 的警戒阈值，请仔细检查'
            },
            diffCodeLens: {
                accept: '接受',
                reject: '拒绝',
                acceptAll: '全部接受',
                rejectAll: '全部拒绝'
            },
            diffEditorActions: {
                noActiveDiff: '当前没有待处理的 diff 修改',
                allBlocksProcessed: '所有 diff 块都已处理',
                diffBlock: 'Diff 块 #{index}',
                lineRange: '第 {start}-{end} 行',
                acceptAllBlocks: '接受所有块',
                rejectAllBlocks: '拒绝所有块',
                blocksCount: '{count} 个待处理块',
                selectBlockToAccept: '选择要接受的 Diff 块',
                selectBlockToReject: '选择要拒绝的 Diff 块',
                selectBlockPlaceholder: '可以多选'
            },
            diffInline: {
                hoverOrLightbulb: '悬停或点击 💡 应用修改',
                acceptBlock: '接受 Diff 块 #{index}',
                rejectBlock: '拒绝 Diff 块 #{index}',
                acceptAll: '接受所有修改',
                rejectAll: '拒绝所有修改'
            },
            readFile: {
                cannotReadFile: '无法读取此文件'
            },
            selectionContext: {
                hoverAddToInput: '添加选中内容到输入框',
                codeActionAddToInput: 'LimCode: 添加选中代码到输入框',
                noActiveEditor: '没有活动编辑器',
                noSelection: '没有选中内容',
                failedToAddSelection: '添加选中内容失败: {error}'
            }
        },

        terminal: {
            errors: {
                executionFailed: '命令执行失败',
                timeout: '命令执行超时',
                killed: '命令被终止'
            },
            shellCheck: {
                wslNotInstalled: 'WSL 未安装或未启用',
                shellNotFound: '找不到: {shellPath}',
                shellNotInPath: '{shellPath} 不在 PATH 中'
            }
        },

        search: {
            errors: {
                searchFailed: '搜索失败: {error}',
                invalidPattern: '无效的搜索模式: {pattern}'
            }
        },

        media: {
            errors: {
                processingFailed: '处理失败: {error}',
                invalidFormat: '无效的格式: {format}',
                dependencyMissing: '缺少依赖: {dependency}'
            }
        },
        
        common: {
            taskNotFound: '任务 {id} 未找到或已完成',
            cancelTaskFailed: '取消任务失败: {error}',
            toolAlreadyExists: '工具已存在: {name}'
        },
        
        skills: {
            description: '开启或关闭 Skills。Skills 是用户自定义的知识模块，提供专业的上下文和指令。每个参数是一个 skill 名称 - 设为 true 启用，false 禁用。',
            // 为什么要改：legacy-to-create-skill 已停止自动生成，保留旧模板会变成未使用的旧入口文案。
            // 怎么改：删除旧模板，只保留 Skills 工具本身的设置描述和错误文案。
            // 目的：让新手引导转移到 read_skill 无 Skill 描述，避免再次产生自动写入的 legacy Skill。
            errors: {
                managerNotInitialized: 'Skills 管理器未初始化',
                unsupportedScriptType: 'cmd.exe 脚本不受 execute_skill_script 支持，因为 cmd.exe 需要 shell 解析。请改用 PowerShell 或 sh 脚本。',
                unsupportedExtension: '不支持的 Skill 脚本扩展名: {ext}',
                outputTruncated: '（输出已截断）',
                cwdNotRelative: 'execute_skill_script.cwd 必须是工作区相对路径，不能是绝对路径。',
                cwdInvalid: '无效的工作区相对路径 cwd: {cwd}',
                cwdOutsideWorkspace: 'execute_skill_script.cwd 必须位于所选工作区内。',
                shellExecutionDisabled: '设置中已禁用 Skill Shell 执行。',
                stageFailed: '暂存 Skill 脚本失败',
                scriptTimeout: 'Skill 脚本在 {timeout}ms 后超时',
                scriptExitCode: 'Skill 脚本以代码 {code} 退出',
                resourceChanged: 'Skill 资源在读取前已变更。请刷新 Skills 并重新请求确认。'
            }
        },
        /** 子代理工具 */
        subagents: {
            errors: {
                inputBudgetExceededCode: 'SUBAGENT_INPUT_BUDGET_EXCEEDED',
                inputBudgetExceeded: 'SubAgent 输入预算超出：{chars}/{max} 字符。',
                depthExceededCode: 'SUBAGENT_DEPTH_EXCEEDED',
                depthExceeded: 'SubAgent 深度超出：{depth}/{max}。',
                concurrencyExceededCode: 'SUBAGENT_CONCURRENCY_EXCEEDED',
                concurrencyExceeded: '超出活跃 SubAgent 数量限制 ({max})。此运行已被拒绝。',
                outputTruncated: '[SubAgent 输出已截断以适配主上下文。完整输出可在 SubAgent Monitor 中查看。原始字符数：{length}。]',
                requiredParam: '{param} 是必需的',
                agentNotFound: '未找到 SubAgent "{name}"。可用的 Agent：{list}',
                noExecutor: 'SubAgent "{name}" 没有可用的执行器',
                noRuntimeExecutor: 'SubAgent "{name}" 没有运行时执行器上下文。',
                cancelled: '用户取消了 SubAgent 执行。请等待用户的下一步指示。',
                governanceRejected: 'SubAgent 治理策略拒绝了此运行。',
                executionFailed: 'SubAgent 执行失败',
                executionError: 'SubAgent 执行错误：{error}'
            }
        },
        
        history: {
            noSummarizedHistory: '没有找到已总结的历史记录。当前对话尚未触发上下文总结。',
            noHistory: '未找到对话历史记录。',
            searchResultHeader: '在历史记录中找到 {count} 个匹配项，关键词："{query}"（共 {totalLines} 行）',
            // 当完整短语无结果时说明已启用空格分隔关键词兜底，避免模型误以为命中了原始完整短语。
            keywordFallbackNotice: '[未找到完整短语，已改用空格分隔关键词搜索：{terms}]',
            noMatchesFound: '在历史记录中未找到 "{query}" 的匹配项（共 {totalLines} 行）。请尝试其他关键词。',
            resultsLimited: '[结果限制为 {max} 个匹配项。请使用更具体的关键词。]',
            readResultHeader: '历史记录的第 {start}-{end} 行（共 {totalLines} 行）',
            readTruncated: '[输出限制为 {max} 行。使用 start_line={nextStart} 继续读取。]',
            invalidRegex: '无效的正则表达式：{error}',
            invalidRange: '无效的行范围：{start}-{end}（文档共 {totalLines} 行）',
            errors: {
                contextRequired: '需要工具上下文',
                conversationIdRequired: '工具上下文中需要 conversationId',
                conversationStoreRequired: '工具上下文中需要 conversationStore',
                getHistoryNotAvailable: 'conversationStore.getHistory 不可用',
                invalidMode: '无效的模式："{mode}"。必须是 "search" 或 "read"',
                queryRequired: 'search 模式需要 query 参数',
                searchFailed: '历史搜索失败：{error}'
            }
        },
        reviewDocument: {
            sections: {
                scope: '评审范围',
                summary: '评审摘要',
                findings: '评审发现',
                milestones: '评审里程碑',
                finalConclusion: '最终结论',
                snapshot: '评审快照'
            },
            header: {
                date: '日期',
                overview: '概述',
                status: '状态',
                overallDecision: '总体结论'
            },
            summary: {
                currentStatus: '当前状态',
                reviewedModules: '已审模块',
                currentProgress: '当前进度',
                totalMilestones: '里程碑总数',
                completedMilestones: '已完成里程碑',
                totalFindings: '问题总数',
                findingsBySeverity: '问题严重级别分布',
                latestConclusion: '最新结论',
                recommendedNextAction: '下一步建议',
                overallDecision: '总体结论'
            },
            finding: {
                severity: '严重级别',
                category: '分类',
                trackingStatus: '跟踪状态',
                description: '说明',
                recommendation: '建议',
                relatedMilestones: '相关里程碑',
                evidenceFiles: '证据'
            },
            milestone: {
                status: '状态',
                recordedAt: '记录时间',
                reviewedModules: '已审模块',
                summary: '摘要',
                conclusion: '结论',
                evidenceFiles: '证据',
                recommendedNextAction: '下一步建议',
                findings: '问题'
            },
            values: {
                pending: '待定',
                milestoneStatus: {
                    inProgress: '进行中',
                    completed: '已完成'
                },
                overallDecision: {
                    pending: '待定',
                    accepted: '通过',
                    conditionallyAccepted: '有条件通过',
                    rejected: '不通过',
                    needsFollowUp: '需要后续跟进'
                },
                severity: {
                    high: '高',
                    medium: '中',
                    low: '低'
                },
                category: {
                    html: 'HTML',
                    css: 'CSS',
                    javascript: 'JavaScript',
                    accessibility: '可访问性',
                    performance: '性能',
                    maintainability: '可维护性',
                    docs: '文档',
                    test: '测试',
                    other: '其他'
                },
                trackingStatus: {
                    open: '开放',
                    acceptedRisk: '接受风险',
                    fixed: '已修复',
                    wontFix: '不修复',
                    duplicate: '重复'
                }
            },
            placeholders: {
                noMilestones: '<!-- no milestones -->',
                noFindings: '<!-- no findings -->',
                defaultReviewScope: '_未提供评审范围。_',
                defaultFinalConclusion: '_最终结论待补充。_'
            },
            templates: {
                currentProgressWithLatest: '已记录 {count} 个里程碑；最新：{latestId}',
                currentProgressEmpty: '已记录 0 个里程碑',
                findingsBySeverity: '高 {high} / 中 {medium} / 低 {low}'
            }
        }
    },
    
    notifications: {
        windowsAgentStop: {
            currentWindow: '当前窗口',
            reasonLabels: {
                error: '失败',
                awaitingUserAction: '等待用户操作',
                continueRequired: '等待继续'
            },
            actionLabels: {
                generatePlan: '生成计划',
                executePlan: '执行计划',
                continue: '继续',
                genericConfirmation: '确认'
            }
        }
    },
    
    workspace: {
        noWorkspaceOpen: '无工作区打开',
        singleWorkspace: '工作区: {path}',
        multiRootMode: '多工作区模式:',
        useWorkspaceFormat: '使用 "工作区名称/路径" 格式访问特定工作区的文件'
    },
    
    multimodal: {
        cannotReadFile: '无法读取 {ext} 文件：多模态工具未启用。请在渠道设置中启用"多模态工具"选项。',
        cannotReadBinaryFile: '无法读取二进制文件 {ext}：不支持此文件格式。',
        cannotReadImage: '无法读取 {ext} 图片：当前渠道类型不支持图片读取。',
        cannotReadDocument: '无法读取 {ext} 文档：当前渠道类型不支持文档读取。OpenAI 格式仅支持图片，不支持文档。'
    },
    
    webview: {
        errors: {
            noWorkspaceOpen: '没有打开的工作区',
            workspaceNotFound: '工作区不存在',
            invalidFileUri: '无效的文件 URI',
            pathNotFile: '路径不是文件',
            fileNotExists: '文件不存在',
            fileNotInWorkspace: '文件不在当前工作区内',
            fileNotInAnyWorkspace: '文件不在任何打开的工作区内',
            fileInOtherWorkspace: '文件属于其他工作区: {workspaceName}',
            readFileFailed: '读取文件失败',
            conversationFileNotExists: '对话文件不存在',
            cannotRevealInExplorer: '无法在文件管理器中显示',
            
            deleteMessageFailed: '删除消息失败',
            
            getModelsFailed: '获取模型列表失败',
            addModelsFailed: '添加模型失败',
            removeModelFailed: '移除模型失败',
            setActiveModelFailed: '设置激活模型失败',
            
            updateUISettingsFailed: '更新 UI 设置失败',
            getSettingsFailed: '获取设置失败',
            updateSettingsFailed: '更新设置失败',
            setActiveChannelFailed: '设置激活渠道失败',
            
            getToolsFailed: '获取工具列表失败',
            setToolEnabledFailed: '设置工具状态失败',
            getToolConfigFailed: '获取工具配置失败',
            updateToolConfigFailed: '更新工具配置失败',
            getAutoExecConfigFailed: '获取自动执行配置失败',
            getMcpToolsFailed: '获取 MCP 工具列表失败',
            setToolAutoExecFailed: '设置工具自动执行失败',
            updateListFilesConfigFailed: '更新 list_files 配置失败',
            updateApplyDiffConfigFailed: '更新 apply_diff 配置失败',
            updateExecuteCommandConfigFailed: '更新终端配置失败',
            checkShellFailed: '检测 Shell 失败',
            
            killTerminalFailed: '终止终端失败',
            getTerminalOutputFailed: '获取终端输出失败',
            
            cancelImageGenFailed: '取消图像生成失败',
            
            cancelTaskFailed: '取消任务失败',
            getTasksFailed: '获取任务列表失败',
            
            getCheckpointConfigFailed: '获取存档点配置失败',
            updateCheckpointConfigFailed: '更新存档点配置失败',
            getCheckpointsFailed: '获取检查点列表失败',
            restoreCheckpointFailed: '恢复检查点失败',
            deleteCheckpointFailed: '删除检查点失败',
            deleteAllCheckpointsFailed: '删除所有检查点失败',
            getConversationsWithCheckpointsFailed: '获取对话检查点信息失败',
            
            openDiffPreviewFailed: '打开 diff 预览失败',
            diffContentNotFound: 'Diff 内容不存在或已过期',
            loadDiffContentFailed: '加载 diff 内容失败',
            invalidDiffData: '无效的 diff 数据',
            noFileContent: '无文件内容',
            unsupportedToolType: '不支持的工具类型: {toolName}',
            
            getRelativePathFailed: '获取相对路径失败',
            previewAttachmentFailed: '预览附件失败',
            readImageFailed: '读取图片失败',
            openFileFailed: '打开文件失败',
            saveImageFailed: '保存图片失败',
            
            openMcpConfigFailed: '打开 MCP 配置文件失败',
            getMcpServersFailed: '获取 MCP 服务器列表失败',
            validateMcpServerIdFailed: '验证 MCP 服务器 ID 失败',
            createMcpServerFailed: '创建 MCP 服务器失败',
            updateMcpServerFailed: '更新 MCP 服务器失败',
            deleteMcpServerFailed: '删除 MCP 服务器失败',
            connectMcpServerFailed: '连接 MCP 服务器失败',
            disconnectMcpServerFailed: '断开 MCP 服务器失败',
            setMcpServerEnabledFailed: '设置 MCP 服务器状态失败',
            
            getSummarizeConfigFailed: '获取总结配置失败',
            updateSummarizeConfigFailed: '更新总结配置失败',
            summarizeFailed: '上下文总结失败',
            
            getGenerateImageConfigFailed: '获取图像生成配置失败',
            updateGenerateImageConfigFailed: '更新图像生成配置失败',
            
            getContextAwarenessConfigFailed: '获取上下文感知配置失败',
            updateContextAwarenessConfigFailed: '更新上下文感知配置失败',
            getOpenTabsFailed: '获取打开的标签页失败',
            getActiveEditorFailed: '获取当前编辑器失败',
            
            getSystemPromptConfigFailed: '获取系统提示词配置失败',
            updateSystemPromptConfigFailed: '更新系统提示词配置失败',
            
            getPinnedFilesConfigFailed: '获取固定文件配置失败',
            checkPinnedFilesExistenceFailed: '检查文件存在性失败',
            updatePinnedFilesConfigFailed: '更新固定文件配置失败',
            addPinnedFileFailed: '添加固定文件失败',
            removePinnedFileFailed: '移除固定文件失败',
            setPinnedFileEnabledFailed: '设置固定文件状态失败',
            
            listDependenciesFailed: '获取依赖列表失败',
            installDependencyFailed: '安装依赖失败',
            uninstallDependencyFailed: '卸载依赖失败',
            getInstallPathFailed: '获取安装路径失败',
            
            showNotificationFailed: '显示通知失败',
            rejectToolCallsFailed: '标记工具拒绝状态失败',
            
            getStorageConfigFailed: '获取存储配置失败',
            updateStorageConfigFailed: '更新存储配置失败',
            validateStoragePathFailed: '验证存储路径失败',
            migrateStorageFailed: '迁移存储失败'
        },
        
        messages: {
            historyDiffPreview: '{filePath} (历史修改预览)',
            newFileContentPreview: '{filePath} (新写入内容预览)',
            fullFileDiffPreview: '{filePath} (完整文件差异预览)',
            searchReplaceDiffPreview: '{filePath} (搜索替换差异预览)'
        },
        dialogs: {
            selectStorageFolder: '选择存储文件夹',
            selectFolder: '选择文件夹'
        }
    },

    errors: {
        unknown: '未知错误',
        timeout: '操作超时',
        cancelled: '操作已取消',
        networkError: '网络错误',
        invalidRequest: '无效的请求',
        internalError: '内部错误'
    }
};

export default zhCN;