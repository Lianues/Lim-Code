/**
 * LimCode Backend - i18n 类型定义
 * 与前端共享相同的语言配置
 */

/**
 * 支持的语言
 */
export type SupportedLanguage = 'auto' | 'zh-CN' | 'en' | 'ja';

/**
 * 后端翻译消息结构
 */
export interface BackendLanguageMessages {
    /** 核心模块 */
    core: {
        registry: {
            moduleAlreadyRegistered: string;
            duplicateApiName: string;
            registeringModule: string;
            moduleNotRegistered: string;
            unregisteringModule: string;
            apiNotFound: string;
            missingRequiredParams: string;
        };
    };

    /** 模块翻译 */
    modules: {
        /** 配置模块 */
        config: {
            errors: {
                configNotFound: string;
                configExists: string;
                invalidConfig: string;
                validationFailed: string;
                saveFailed: string;
                loadFailed: string;
            };
            validation: {
                nameRequired: string;
                typeRequired: string;
                invalidUrl: string;
                apiKeyEmpty: string;
                modelNotSelected: string;
                temperatureRange: string;
                maxOutputTokensMin: string;
                maxOutputTokensHigh: string;
                openaiNotImplemented: string;
                anthropicNotImplemented: string;
            };
        };

        /** 会话模块 */
        conversation: {
            defaultTitle: string;
            errors: {
                conversationNotFound: string;
                conversationExists: string;
                messageNotFound: string;
                messageIndexOutOfBounds: string;
                snapshotNotFound: string;
                snapshotNotBelongToConversation: string;
                saveFailed: string;
                loadFailed: string;
            };
        };

        /** MCP 模块 */
        mcp: {
            errors: {
                connectionFailed: string;
                serverNotFound: string;
                serverNotFoundWithAvailable: string;
                serverDisabled: string;
                serverNotConnected: string;
                clientNotConnected: string;
                toolCallFailed: string;
                requestTimeout: string;
                invalidServerId: string;
                serverIdExists: string;
            };
            status: {
                connecting: string;
                connected: string;
                disconnected: string;
                error: string;
            };
        };

        /** 检查点模块 */
        checkpoint: {
            description: {
                before: string;
                after: string;
            };
            restore: {
                success: string;
                filesUpdated: string;
                filesDeleted: string;
                filesUnchanged: string;
            };
            defaultConversationTitle: string;
            errors: {
                createFailed: string;
                restoreFailed: string;
                deleteFailed: string;
            };
        };

        /** 设置模块 */
        settings: {
            errors: {
                loadFailed: string;
                saveFailed: string;
                invalidValue: string;
            };
            storage: {
                pathNotAbsolute: string;
                pathNotDirectory: string;
                createDirectoryFailed: string;
                migrationFailed: string;
                migrationSuccess: string;
                migratingFiles: string;
                migratingConversations: string;
                migratingCheckpoints: string;
                migratingConfigs: string;
            };
        };

        /** 依赖管理模块 */
        dependencies: {
            descriptions: {
                sharp: string;
            };
            errors: {
                requiresContext: string;
                unknownDependency: string;
                nodeModulesNotFound: string;
                moduleNotFound: string;
                installFailed: string;
                uninstallFailed: string;
                loadFailed: string;
            };
            progress: {
                installing: string;
                downloading: string;
                installSuccess: string;
            };
        };

        /** 渠道模块 */
        channel: {
            formatters: {
                gemini: {
                    errors: {
                        invalidResponse: string;
                        apiError: string;
                    };
                };
                anthropic: {
                    errors: {
                        invalidResponse: string;
                    };
                };
                openai: {
                    errors: {
                        invalidResponse: string;
                    };
                };
            };
            errors: {
                configNotFound: string;
                configDisabled: string;
                unsupportedChannelType: string;
                configValidationFailed: string;
                buildRequestFailed: string;
                apiError: string;
                parseResponseFailed: string;
                httpRequestFailed: string;
                parseStreamChunkFailed: string;
                streamRequestFailed: string;
                requestTimeout: string;
                requestTimeoutNoResponse: string;
                requestCancelled: string;
                requestAborted: string;
                noResponseBody: string;
            };
            modelList: {
                errors: {
                    apiKeyRequired: string;
                    fetchModelsFailed: string;
                    unsupportedConfigType: string;
                };
            };
        };

        /** 渠道 API */
        api: {
            channel: {
                errors: {
                    listChannelsFailed: string;
                    channelNotFound: string;
                    getChannelFailed: string;
                    channelAlreadyExists: string;
                    createChannelFailed: string;
                    updateChannelFailed: string;
                    deleteChannelFailed: string;
                    setChannelStatusFailed: string;
                };
            };
            settings: {
                errors: {
                    getSettingsFailed: string;
                    updateSettingsFailed: string;
                    setActiveChannelFailed: string;
                    setToolStatusFailed: string;
                    batchSetToolStatusFailed: string;
                    setDefaultToolModeFailed: string;
                    updateUISettingsFailed: string;
                    updateProxySettingsFailed: string;
                    resetSettingsFailed: string;
                    toolRegistryNotAvailable: string;
                    getToolsListFailed: string;
                    getToolConfigFailed: string;
                    updateToolConfigFailed: string;
                    updateListFilesConfigFailed: string;
                    updateApplyDiffConfigFailed: string;
                    getCheckpointConfigFailed: string;
                    updateCheckpointConfigFailed: string;
                    getSummarizeConfigFailed: string;
                    updateSummarizeConfigFailed: string;
                    getGenerateImageConfigFailed: string;
                    updateGenerateImageConfigFailed: string;
                };
            };
            models: {
                errors: {
                    configNotFound: string;
                    getModelsFailed: string;
                    addModelsFailed: string;
                    removeModelFailed: string;
                    modelNotInList: string;
                    setActiveModelFailed: string;
                };
            };
            mcp: {
                errors: {
                    listServersFailed: string;
                    serverNotFound: string;
                    getServerFailed: string;
                    createServerFailed: string;
                    updateServerFailed: string;
                    deleteServerFailed: string;
                    setServerStatusFailed: string;
                    connectServerFailed: string;
                    disconnectServerFailed: string;
                };
            };
            chat: {
                errors: {
                    configNotFound: string;
                    configDisabled: string;
                    maxToolIterations: string;
                    unknownError: string;
                    toolExecutionSuccess: string;
                    mcpToolCallFailed: string;
                    invalidMcpToolName: string;
                    toolNotFound: string;
                    toolExecutionFailed: string;
                    noHistory: string;
                    lastMessageNotModel: string;
                    noFunctionCalls: string;
                    userRejectedTool: string;
                    notEnoughRounds: string;
                    notEnoughContent: string;
                    noMessagesToSummarize: string;
                    summarizeAborted: string;
                    emptySummary: string;
                    messageNotFound: string;
                    canOnlyEditUserMessage: string;
                };
                prompts: {
                    defaultSummarizePrompt: string;
                    summaryPrefix: string;
                };
            };
        };
    };

    /** 工具翻译 */
    tools: {
        errors: {
            toolNotFound: string;
            executionFailed: string;
            invalidParams: string;
            timeout: string;
        };

        /** 文件工具 */
        file: {
            errors: {
                fileNotFound: string;
                readFailed: string;
                writeFailed: string;
                deleteFailed: string;
                permissionDenied: string;
            };
            diffManager: {
                saved: string;
                saveFailed: string;
                savedShort: string;
                rejected: string;
                rejectFailed: string;
                diffTitle: string;
            };
            readFile: {
                cannotReadFile: string;
            };
        };

        /** 终端工具 */
        terminal: {
            errors: {
                executionFailed: string;
                timeout: string;
                killed: string;
            };
            shellCheck: {
                wslNotInstalled: string;
                shellNotFound: string;
                shellNotInPath: string;
            };
        };

        /** 搜索工具 */
        search: {
            google_search: {
                errors: {
                    unsupportedChannel: string;
                };
            };
            errors: {
                searchFailed: string;
                invalidPattern: string;
            };
        };

        /** 媒体工具 */
        media: {
            errors: {
                processingFailed: string;
                invalidFormat: string;
                dependencyMissing: string;
            };
        };
        
        /** 通用工具错误 */
        common: {
            taskNotFound: string;
            cancelTaskFailed: string;
            toolAlreadyExists: string;
        };
    };
    
    /** 工作区相关 */
    workspace: {
        noWorkspaceOpen: string;
        singleWorkspace: string;
        multiRootMode: string;
        useWorkspaceFormat: string;
    };
    
    /** 多模态相关 */
    multimodal: {
        cannotReadFile: string;
        cannotReadBinaryFile: string;
        cannotReadImage: string;
        cannotReadDocument: string;
    };
    
    /** Webview 相关 */
    webview: {
        errors: {
            /** 通用错误 */
            noWorkspaceOpen: string;
            workspaceNotFound: string;
            invalidFileUri: string;
            pathNotFile: string;
            fileNotExists: string;
            fileNotInWorkspace: string;
            fileNotInAnyWorkspace: string;
            fileInOtherWorkspace: string;
            conversationFileNotExists: string;
            cannotRevealInExplorer: string;
            
            /** 消息相关 */
            deleteMessageFailed: string;
            
            /** 模型相关 */
            getModelsFailed: string;
            addModelsFailed: string;
            removeModelFailed: string;
            setActiveModelFailed: string;
            
            /** 设置相关 */
            updateUISettingsFailed: string;
            getSettingsFailed: string;
            updateSettingsFailed: string;
            setActiveChannelFailed: string;
            
            /** 工具相关 */
            getToolsFailed: string;
            setToolEnabledFailed: string;
            getToolConfigFailed: string;
            updateToolConfigFailed: string;
            getAutoExecConfigFailed: string;
            getMcpToolsFailed: string;
            setToolAutoExecFailed: string;
            updateListFilesConfigFailed: string;
            updateApplyDiffConfigFailed: string;
            updateExecuteCommandConfigFailed: string;
            checkShellFailed: string;
            
            /** 终端相关 */
            killTerminalFailed: string;
            getTerminalOutputFailed: string;
            
            /** 图像生成相关 */
            cancelImageGenFailed: string;
            
            /** 任务相关 */
            cancelTaskFailed: string;
            getTasksFailed: string;
            
            /** 检查点相关 */
            getCheckpointConfigFailed: string;
            updateCheckpointConfigFailed: string;
            getCheckpointsFailed: string;
            restoreCheckpointFailed: string;
            deleteCheckpointFailed: string;
            deleteAllCheckpointsFailed: string;
            getConversationsWithCheckpointsFailed: string;
            
            /** Diff 预览相关 */
            openDiffPreviewFailed: string;
            diffContentNotFound: string;
            loadDiffContentFailed: string;
            invalidDiffData: string;
            noFileContent: string;
            unsupportedToolType: string;
            acceptDiffFailed: string;
            rejectDiffFailed: string;
            
            /** 文件相关 */
            getRelativePathFailed: string;
            previewAttachmentFailed: string;
            readImageFailed: string;
            openFileFailed: string;
        saveImageFailed: string;
            
            /** MCP 相关 */
            openMcpConfigFailed: string;
            getMcpServersFailed: string;
            validateMcpServerIdFailed: string;
            createMcpServerFailed: string;
            updateMcpServerFailed: string;
            deleteMcpServerFailed: string;
            connectMcpServerFailed: string;
            disconnectMcpServerFailed: string;
            setMcpServerEnabledFailed: string;
            
            /** 总结相关 */
            getSummarizeConfigFailed: string;
            updateSummarizeConfigFailed: string;
            summarizeFailed: string;
            
            /** 图像生成配置相关 */
            getGenerateImageConfigFailed: string;
            updateGenerateImageConfigFailed: string;
            
            /** Google 搜索配置相关 */
            getGoogleSearchConfigFailed: string;
            updateGoogleSearchConfigFailed: string;
            
            /** 上下文感知相关 */
            getContextAwarenessConfigFailed: string;
            updateContextAwarenessConfigFailed: string;
            getOpenTabsFailed: string;
            getActiveEditorFailed: string;
            
            /** 系统提示词相关 */
            getSystemPromptConfigFailed: string;
            updateSystemPromptConfigFailed: string;
            
            /** 固定文件相关 */
            getPinnedFilesConfigFailed: string;
            checkPinnedFilesExistenceFailed: string;
            updatePinnedFilesConfigFailed: string;
            addPinnedFileFailed: string;
            removePinnedFileFailed: string;
            setPinnedFileEnabledFailed: string;
            
            /** 依赖相关 */
            listDependenciesFailed: string;
            installDependencyFailed: string;
            uninstallDependencyFailed: string;
            getInstallPathFailed: string;
            
            /** 通知相关 */
            showNotificationFailed: string;
            
            /** 工具拒绝相关 */
            rejectToolCallsFailed: string;
            
            /** 存储配置相关 */
            getStorageConfigFailed: string;
            updateStorageConfigFailed: string;
            validateStoragePathFailed: string;
            migrateStorageFailed: string;
        };
        
        messages: {
            /** Diff 预览标题 */
            historyDiffPreview: string;
            newFileContentPreview: string;
            fullFileDiffPreview: string;
            searchReplaceDiffPreview: string;
        };
        dialogs: {
            selectStorageFolder: string;
            selectFolder: string;
        };
    };

    /** 通用错误 */
    errors: {
        unknown: string;
        timeout: string;
        cancelled: string;
        networkError: string;
        invalidRequest: string;
        internalError: string;
    };
}
