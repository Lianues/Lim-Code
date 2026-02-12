/**
 * LimCode Backend - English Language Pack
 */

import type { BackendLanguageMessages } from '../types';

const en: BackendLanguageMessages = {
    core: {
        registry: {
            moduleAlreadyRegistered: 'Module "{moduleId}" is already registered',
            duplicateApiName: 'Duplicate API name in module "{moduleId}": {apiName}',
            registeringModule: '[ModuleRegistry] Registering module: {moduleId} ({moduleName} v{version})',
            moduleNotRegistered: 'Module not registered: {moduleId}',
            unregisteringModule: '[ModuleRegistry] Unregistering module: {moduleId}',
            apiNotFound: 'API not found: {moduleId}.{apiName}',
            missingRequiredParams: 'Missing required parameters: {params}'
        }
    },

    modules: {
        config: {
            errors: {
                configNotFound: 'Configuration not found: {configId}',
                configExists: 'Configuration already exists: {configId}, use overwrite option to replace',
                invalidConfig: 'Invalid configuration',
                validationFailed: 'Configuration validation failed: {errors}',
                saveFailed: 'Failed to save configuration',
                loadFailed: 'Failed to load configuration'
            },
            validation: {
                nameRequired: 'Name is required',
                typeRequired: 'Type is required',
                invalidUrl: 'API URL is invalid',
                apiKeyEmpty: 'API Key is empty, configuration required before use',
                modelNotSelected: 'Models available but none selected',
                temperatureRange: 'temperature must be between 0.0 and 2.0',
                maxOutputTokensMin: 'maxOutputTokens must be greater than 0',
                maxOutputTokensHigh: 'maxOutputTokens is too high, may cause high latency',
                openaiNotImplemented: 'OpenAI configuration validation not implemented yet',
                anthropicNotImplemented: 'Anthropic configuration validation not implemented yet'
            }
        },

        conversation: {
            defaultTitle: 'Conversation {conversationId}',
            errors: {
                conversationNotFound: 'Conversation not found: {conversationId}',
                conversationExists: 'Conversation already exists: {conversationId}',
                messageNotFound: 'Message not found: {messageId}',
                messageIndexOutOfBounds: 'Message index out of bounds: {index}',
                snapshotNotFound: 'Snapshot not found: {snapshotId}',
                snapshotNotBelongToConversation: 'Snapshot does not belong to this conversation',
                saveFailed: 'Failed to save conversation',
                loadFailed: 'Failed to load conversation'
            }
        },

        mcp: {
            errors: {
                connectionFailed: 'Connection failed: {serverName}',
                serverNotFound: 'Server not found: {serverId}',
                serverNotFoundWithAvailable: 'Server not found: {serverId}. Available servers: {available}',
                serverDisabled: 'Server is disabled: {serverId}',
                serverNotConnected: 'Server not connected: {serverName}',
                clientNotConnected: 'Client not connected',
                toolCallFailed: 'Tool call failed',
                requestTimeout: 'Request timeout ({timeout}ms)',
                invalidServerId: 'ID can only contain letters, numbers, underscores and hyphens',
                serverIdExists: 'Server ID "{serverId}" already exists'
            },
            status: {
                connecting: 'Connecting...',
                connected: 'Connected',
                disconnected: 'Disconnected',
                error: 'Error'
            }
        },

        checkpoint: {
            description: {
                before: 'Before',
                after: 'After'
            },
            restore: {
                success: 'Restored to "{toolName}" {phase} state',
                filesUpdated: '{count} files updated',
                filesDeleted: '{count} files deleted',
                filesUnchanged: '{count} files unchanged'
            },
            defaultConversationTitle: 'Conversation {conversationId}',
            errors: {
                createFailed: 'Failed to create checkpoint',
                restoreFailed: 'Failed to restore checkpoint',
                deleteFailed: 'Failed to delete checkpoint'
            }
        },

        settings: {
            errors: {
                loadFailed: 'Failed to load settings',
                saveFailed: 'Failed to save settings',
                invalidValue: 'Invalid setting value'
            },
            storage: {
                pathNotAbsolute: 'Path must be absolute: {path}',
                pathNotDirectory: 'Path must be a directory: {path}',
                createDirectoryFailed: 'Failed to create directory: {error}',
                migrationFailed: 'Migration failed: {error}',
                migrationSuccess: 'Storage migration completed',
                migratingFiles: 'Migrating files...',
                migratingConversations: 'Migrating conversations...',
                migratingCheckpoints: 'Migrating checkpoints...',
                migratingConfigs: 'Migrating configs...'
            }
        },

        dependencies: {
            descriptions: {
                sharp: 'High-performance image processing library for mask application in background removal'
            },
            errors: {
                requiresContext: 'DependencyManager requires ExtensionContext on first call',
                unknownDependency: 'Unknown dependency: {name}',
                nodeModulesNotFound: 'node_modules directory not found after installation',
                moduleNotFound: '{name} module not found after installation',
                installFailed: 'Installation failed: {error}',
                uninstallFailed: 'Failed to uninstall {name}',
                loadFailed: 'Failed to load {name}'
            },
            progress: {
                installing: 'Installing {name}...',
                downloading: 'Downloading {name}...',
                installSuccess: '{name} installed successfully!'
            }
        },

        channel: {
            formatters: {
                gemini: {
                    errors: {
                        invalidResponse: 'Invalid Gemini API response: no candidates',
                        apiError: 'API returned error status: {code}'
                    }
                },
                anthropic: {
                    errors: {
                        invalidResponse: 'Invalid Anthropic API response: no content'
                    }
                },
                openai: {
                    errors: {
                        invalidResponse: 'Invalid OpenAI API response: no choices'
                    }
                }
            },
            errors: {
                configNotFound: 'Configuration not found: {configId}',
                configDisabled: 'Configuration is disabled: {configId}',
                unsupportedChannelType: 'Unsupported channel type: {type}',
                configValidationFailed: 'Configuration validation failed: {configId}',
                buildRequestFailed: 'Failed to build request: {error}',
                apiError: 'API returned error status: {status}',
                parseResponseFailed: 'Failed to parse response: {error}',
                httpRequestFailed: 'HTTP request failed: {error}',
                parseStreamChunkFailed: 'Failed to parse stream chunk: {error}',
                streamRequestFailed: 'Stream request failed: {error}',
                requestTimeout: 'Request timeout ({timeout}ms)',
                requestTimeoutNoResponse: 'Request timeout (no response in {timeout}ms)',
                requestCancelled: 'Request cancelled',
                requestAborted: 'Request aborted',
                noResponseBody: 'No response body'
            },
            modelList: {
                errors: {
                    apiKeyRequired: 'API Key is required',
                    fetchModelsFailed: 'Failed to fetch models: {error}',
                    unsupportedConfigType: 'Unsupported config type: {type}'
                }
            }
        },

        api: {
            channel: {
                errors: {
                    listChannelsFailed: 'Failed to list channel configurations',
                    channelNotFound: 'Channel configuration not found: {channelId}',
                    getChannelFailed: 'Failed to get channel configuration',
                    channelAlreadyExists: 'Channel configuration already exists: {channelId}',
                    createChannelFailed: 'Failed to create channel configuration',
                    updateChannelFailed: 'Failed to update channel configuration',
                    deleteChannelFailed: 'Failed to delete channel configuration',
                    setChannelStatusFailed: 'Failed to set channel status'
                }
            },
            settings: {
                errors: {
                    getSettingsFailed: 'Failed to get settings',
                    updateSettingsFailed: 'Failed to update settings',
                    setActiveChannelFailed: 'Failed to set active channel',
                    setToolStatusFailed: 'Failed to set tool status',
                    batchSetToolStatusFailed: 'Failed to batch set tool status',
                    setDefaultToolModeFailed: 'Failed to set default tool mode',
                    updateUISettingsFailed: 'Failed to update UI settings',
                    updateProxySettingsFailed: 'Failed to update proxy settings',
                    resetSettingsFailed: 'Failed to reset settings',
                    toolRegistryNotAvailable: 'Tool registry not available',
                    getToolsListFailed: 'Failed to get tools list',
                    getToolConfigFailed: 'Failed to get tool config',
                    updateToolConfigFailed: 'Failed to update tool config',
                    updateListFilesConfigFailed: 'Failed to update list_files config',
                    updateApplyDiffConfigFailed: 'Failed to update apply_diff config',
                    getCheckpointConfigFailed: 'Failed to get checkpoint config',
                    updateCheckpointConfigFailed: 'Failed to update checkpoint config',
                    getSummarizeConfigFailed: 'Failed to get summarize config',
                    updateSummarizeConfigFailed: 'Failed to update summarize config',
                    getGenerateImageConfigFailed: 'Failed to get generate image config',
                    updateGenerateImageConfigFailed: 'Failed to update generate image config'
                }
            },
            models: {
                errors: {
                    configNotFound: 'Configuration not found',
                    getModelsFailed: 'Failed to get models list',
                    addModelsFailed: 'Failed to add models',
                    removeModelFailed: 'Failed to remove model',
                    modelNotInList: 'Model not in list',
                    setActiveModelFailed: 'Failed to set active model'
                }
            },
            mcp: {
                errors: {
                    listServersFailed: 'Failed to get MCP server list',
                    serverNotFound: 'MCP server not found: {serverId}',
                    getServerFailed: 'Failed to get MCP server',
                    createServerFailed: 'Failed to create MCP server',
                    updateServerFailed: 'Failed to update MCP server',
                    deleteServerFailed: 'Failed to delete MCP server',
                    setServerStatusFailed: 'Failed to set MCP server status',
                    connectServerFailed: 'Failed to connect MCP server',
                    disconnectServerFailed: 'Failed to disconnect MCP server'
                }
            },
            chat: {
                errors: {
                    configNotFound: 'Configuration not found: {configId}',
                    configDisabled: 'Configuration disabled: {configId}',
                    maxToolIterations: 'Maximum tool call iterations reached ({maxIterations})',
                    unknownError: 'Unknown error',
                    toolExecutionSuccess: 'Tool execution successful',
                    mcpToolCallFailed: 'MCP tool call failed',
                    invalidMcpToolName: 'Invalid MCP tool name: {toolName}',
                    toolNotFound: 'Tool not found: {toolName}',
                    toolExecutionFailed: 'Tool execution failed',
                    noHistory: 'Conversation history is empty',
                    lastMessageNotModel: 'Last message is not a model message',
                    noFunctionCalls: 'No pending function calls',
                    userRejectedTool: 'User rejected tool execution',
                    notEnoughRounds: 'Not enough conversation rounds, current {currentRounds}, keeping {keepRounds}, no summary needed',
                    notEnoughContent: 'Not enough conversation rounds, current {currentRounds}, keeping {keepRounds}, no content to summarize',
                    noMessagesToSummarize: 'No messages to summarize',
                    summarizeAborted: 'Summarize request aborted',
                    emptySummary: 'AI generated summary is empty',
                    messageNotFound: 'Message not found: index {messageIndex}',
                    canOnlyEditUserMessage: 'Can only edit user messages, current message role: {role}'
                },
                prompts: {
                    defaultSummarizePrompt: `Please summarize the above conversation content concisely, output the summary directly without any format markers.

Requirements:
1. Keep key information and context points
2. Remove redundant content and tool call details
3. Summarize the topic, discussed problems, and conclusions
4. Keep important technical details and decisions
5. Output summary content directly without any prefix, title, or format markers`,
                    summaryPrefix: '[Conversation Summary]',
                    autoSummarizePrompt: `Please summarize the above conversation history and output the following sections, so that the AI can continue completing the unfinished tasks.

## User Requirements
What the user wants to accomplish (overall goal).

## Completed Work
List what has been done in chronological order, including which files were changed and what decisions were made.
File paths, variable names, and configuration values must be preserved exactly, do not generalize.

## Current Progress
What step has been reached, what is currently being done.

## TODO Items
What still needs to be done, listed by priority.

## Important Conventions
Constraints, preferences, and technical requirements raised by the user (e.g., "do not use third-party libraries", "use TypeScript", etc.).

Output content directly without any prefix.`
                }
            }
        }
    },

    tools: {
        errors: {
            toolNotFound: 'Tool not found: {toolName}',
            executionFailed: 'Tool execution failed: {error}',
            invalidParams: 'Invalid parameters',
            timeout: 'Execution timeout'
        },

        file: {
            errors: {
                fileNotFound: 'File not found: {path}',
                readFailed: 'Failed to read file: {error}',
                writeFailed: 'Failed to write file: {error}',
                deleteFailed: 'Failed to delete file: {error}',
                permissionDenied: 'Permission denied: {path}'
            },
            diffManager: {
                saved: 'Saved changes: {filePath}',
                saveFailed: 'Save failed: {error}',
                savedShort: 'Saved: {filePath}',
                rejected: 'Rejected changes: {filePath}',
                diffTitle: '{filePath} (AI changes - Ctrl+S to save)',
                diffGuardWarning: 'This change deletes {deletePercent}% of the file content ({deletedLines}/{totalLines} lines), exceeding the {threshold}% guard threshold. Please review carefully.'
            },
            diffCodeLens: {
                accept: 'Accept',
                reject: 'Reject',
                acceptAll: 'Accept All',
                rejectAll: 'Reject All'
            },
            diffEditorActions: {
                noActiveDiff: 'No pending diff changes',
                allBlocksProcessed: 'All diff blocks have been processed',
                diffBlock: 'Diff Block #{index}',
                lineRange: 'Lines {start}-{end}',
                acceptAllBlocks: 'Accept All Blocks',
                rejectAllBlocks: 'Reject All Blocks',
                blocksCount: '{count} pending block(s)',
                selectBlockToAccept: 'Select Diff Block to Accept',
                selectBlockToReject: 'Select Diff Block to Reject',
                selectBlockPlaceholder: 'You can select multiple'
            },
            diffInline: {
                hoverOrLightbulb: 'Hover or click 💡 to apply',
                acceptBlock: 'Accept Diff Block #{index}',
                rejectBlock: 'Reject Diff Block #{index}',
                acceptAll: 'Accept All Changes',
                rejectAll: 'Reject All Changes'
            },
            readFile: {
                cannotReadFile: 'Cannot read this file'
            },
            selectionContext: {
                hoverAddToInput: 'Add selection to input',
                codeActionAddToInput: 'LimCode: Add selection to input',
                noActiveEditor: 'No active editor',
                noSelection: 'No selection',
                failedToAddSelection: 'Failed to add selection: {error}'
            }
        },

        terminal: {
            errors: {
                executionFailed: 'Command execution failed',
                timeout: 'Command execution timeout',
                killed: 'Command was terminated'
            },
            shellCheck: {
                wslNotInstalled: 'WSL is not installed or not enabled',
                shellNotFound: 'Not found: {shellPath}',
                shellNotInPath: '{shellPath} is not in PATH'
            }
        },

        search: {
            errors: {
                searchFailed: 'Search failed: {error}',
                invalidPattern: 'Invalid search pattern: {pattern}'
            }
        },

        media: {
            errors: {
                processingFailed: 'Processing failed: {error}',
                invalidFormat: 'Invalid format: {format}',
                dependencyMissing: 'Missing dependency: {dependency}'
            }
        },
        
        common: {
            taskNotFound: 'Task {id} not found or already completed',
            cancelTaskFailed: 'Failed to cancel task: {error}',
            toolAlreadyExists: 'Tool already exists: {name}'
        },
        
        skills: {
            description: 'Toggle skills on or off. Skills are user-defined knowledge modules that provide specialized context and instructions. Each parameter is a skill name - set to true to enable, false to disable.',
            errors: {
                managerNotInitialized: 'Skills manager not initialized'
            }
        },
        
        history: {
            noSummarizedHistory: 'No summarized history found. Context summarization has not been triggered yet in this conversation.',
            searchResultHeader: 'Found {count} match(es) for "{query}" in summarized history ({totalLines} total lines)',
            noMatchesFound: 'No matches found for "{query}" in summarized history ({totalLines} total lines). Try different keywords.',
            resultsLimited: '[Results limited to {max} matches. Try a more specific query to narrow results.]',
            readResultHeader: 'Lines {start}-{end} of {totalLines} total lines in summarized history',
            readTruncated: '[Output limited to {max} lines. Use start_line={nextStart} to continue reading.]',
            invalidRegex: 'Invalid regular expression: {error}',
            invalidRange: 'Invalid line range: {start}-{end} (document has {totalLines} lines)',
            errors: {
                contextRequired: 'Tool context is required',
                conversationIdRequired: 'conversationId is required in tool context',
                conversationStoreRequired: 'conversationStore is required in tool context',
                getHistoryNotAvailable: 'conversationStore.getHistory is not available',
                invalidMode: 'Invalid mode: "{mode}". Must be "search" or "read"',
                queryRequired: 'query parameter is required for search mode',
                searchFailed: 'History search failed: {error}'
            }
        }
    },
    
    workspace: {
        noWorkspaceOpen: 'No workspace open',
        singleWorkspace: 'Workspace: {path}',
        multiRootMode: 'Multi-root workspace mode:',
        useWorkspaceFormat: 'Use "workspace_name/path" format to access files in specific workspace'
    },
    
    multimodal: {
        cannotReadFile: 'Cannot read {ext} file: Multimodal tools are not enabled. Please enable "Multimodal Tools" option in channel settings.',
        cannotReadBinaryFile: 'Cannot read binary file {ext}: This file format is not supported.',
        cannotReadImage: 'Cannot read {ext} image: Current channel type does not support image reading.',
        cannotReadDocument: 'Cannot read {ext} document: Current channel type does not support document reading. OpenAI format only supports images, not documents.'
    },
    
    webview: {
        errors: {
            noWorkspaceOpen: 'No workspace open',
            workspaceNotFound: 'Workspace not found',
            invalidFileUri: 'Invalid file URI',
            pathNotFile: 'Path is not a file',
            fileNotExists: 'File does not exist',
            fileNotInWorkspace: 'File is not in current workspace',
            fileNotInAnyWorkspace: 'File is not in any open workspace',
            fileInOtherWorkspace: 'File belongs to another workspace: {workspaceName}',
            readFileFailed: 'Failed to read file',
            conversationFileNotExists: 'Conversation file does not exist',
            cannotRevealInExplorer: 'Cannot reveal in explorer',
            
            deleteMessageFailed: 'Failed to delete message',
            
            getModelsFailed: 'Failed to get models list',
            addModelsFailed: 'Failed to add models',
            removeModelFailed: 'Failed to remove model',
            setActiveModelFailed: 'Failed to set active model',
            
            updateUISettingsFailed: 'Failed to update UI settings',
            getSettingsFailed: 'Failed to get settings',
            updateSettingsFailed: 'Failed to update settings',
            setActiveChannelFailed: 'Failed to set active channel',
            
            getToolsFailed: 'Failed to get tools list',
            setToolEnabledFailed: 'Failed to set tool status',
            getToolConfigFailed: 'Failed to get tool config',
            updateToolConfigFailed: 'Failed to update tool config',
            getAutoExecConfigFailed: 'Failed to get auto exec config',
            getMcpToolsFailed: 'Failed to get MCP tools list',
            setToolAutoExecFailed: 'Failed to set tool auto exec',
            updateListFilesConfigFailed: 'Failed to update list_files config',
            updateApplyDiffConfigFailed: 'Failed to update apply_diff config',
            updateExecuteCommandConfigFailed: 'Failed to update terminal config',
            checkShellFailed: 'Failed to check shell',
            
            killTerminalFailed: 'Failed to kill terminal',
            getTerminalOutputFailed: 'Failed to get terminal output',
            
            cancelImageGenFailed: 'Failed to cancel image generation',
            
            cancelTaskFailed: 'Failed to cancel task',
            getTasksFailed: 'Failed to get tasks list',
            
            getCheckpointConfigFailed: 'Failed to get checkpoint config',
            updateCheckpointConfigFailed: 'Failed to update checkpoint config',
            getCheckpointsFailed: 'Failed to get checkpoints list',
            restoreCheckpointFailed: 'Failed to restore checkpoint',
            deleteCheckpointFailed: 'Failed to delete checkpoint',
            deleteAllCheckpointsFailed: 'Failed to delete all checkpoints',
            getConversationsWithCheckpointsFailed: 'Failed to get conversations with checkpoints',
            
            openDiffPreviewFailed: 'Failed to open diff preview',
            diffContentNotFound: 'Diff content not found or expired',
            loadDiffContentFailed: 'Failed to load diff content',
            invalidDiffData: 'Invalid diff data',
            noFileContent: 'No file content',
            unsupportedToolType: 'Unsupported tool type: {toolName}',
            
            getRelativePathFailed: 'Failed to get relative path',
            previewAttachmentFailed: 'Failed to preview attachment',
            readImageFailed: 'Failed to read image',
            openFileFailed: 'Failed to open file',
            saveImageFailed: 'Failed to save image',
            
            openMcpConfigFailed: 'Failed to open MCP config file',
            getMcpServersFailed: 'Failed to get MCP servers list',
            validateMcpServerIdFailed: 'Failed to validate MCP server ID',
            createMcpServerFailed: 'Failed to create MCP server',
            updateMcpServerFailed: 'Failed to update MCP server',
            deleteMcpServerFailed: 'Failed to delete MCP server',
            connectMcpServerFailed: 'Failed to connect MCP server',
            disconnectMcpServerFailed: 'Failed to disconnect MCP server',
            setMcpServerEnabledFailed: 'Failed to set MCP server status',
            
            getSummarizeConfigFailed: 'Failed to get summarize config',
            updateSummarizeConfigFailed: 'Failed to update summarize config',
            summarizeFailed: 'Context summarization failed',
            
            getGenerateImageConfigFailed: 'Failed to get image generation config',
            updateGenerateImageConfigFailed: 'Failed to update image generation config',
            
            getContextAwarenessConfigFailed: 'Failed to get context awareness config',
            updateContextAwarenessConfigFailed: 'Failed to update context awareness config',
            getOpenTabsFailed: 'Failed to get open tabs',
            getActiveEditorFailed: 'Failed to get active editor',
            
            getSystemPromptConfigFailed: 'Failed to get system prompt config',
            updateSystemPromptConfigFailed: 'Failed to update system prompt config',
            
            getPinnedFilesConfigFailed: 'Failed to get pinned files config',
            checkPinnedFilesExistenceFailed: 'Failed to check files existence',
            updatePinnedFilesConfigFailed: 'Failed to update pinned files config',
            addPinnedFileFailed: 'Failed to add pinned file',
            removePinnedFileFailed: 'Failed to remove pinned file',
            setPinnedFileEnabledFailed: 'Failed to set pinned file status',
            
            listDependenciesFailed: 'Failed to get dependencies list',
            installDependencyFailed: 'Failed to install dependency',
            uninstallDependencyFailed: 'Failed to uninstall dependency',
            getInstallPathFailed: 'Failed to get install path',
            
            showNotificationFailed: 'Failed to show notification',
            rejectToolCallsFailed: 'Failed to reject tool calls',
            
            getStorageConfigFailed: 'Failed to get storage config',
            updateStorageConfigFailed: 'Failed to update storage config',
            validateStoragePathFailed: 'Failed to validate storage path',
            migrateStorageFailed: 'Failed to migrate storage'
        },
        
        messages: {
            historyDiffPreview: '{filePath} (History diff preview)',
            newFileContentPreview: '{filePath} (New content preview)',
            fullFileDiffPreview: '{filePath} (Full file diff preview)',
            searchReplaceDiffPreview: '{filePath} (Search replace diff preview)'
        },
        dialogs: {
            selectStorageFolder: 'Select Storage Folder',
            selectFolder: 'Select Folder'
        }
    },

    errors: {
        unknown: 'Unknown error',
        timeout: 'Operation timeout',
        cancelled: 'Operation cancelled',
        networkError: 'Network error',
        invalidRequest: 'Invalid request',
        internalError: 'Internal error'
    }
};

export default en;