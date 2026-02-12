/**
 * LimCode - English Language Pack
 * Organized by component directory structure
 */

import type { LanguageMessages } from '../types';

const en: LanguageMessages = {
    common: {
        save: 'Save',
        cancel: 'Cancel',
        confirm: 'Confirm',
        delete: 'Delete',
        edit: 'Edit',
        add: 'Add',
        remove: 'Remove',
        enable: 'Enable',
        disable: 'Disable',
        enabled: 'Enabled',
        disabled: 'Disabled',
        loading: 'Loading...',
        error: 'Error',
        success: 'Success',
        warning: 'Warning',
        info: 'Info',
        close: 'Close',
        back: 'Back',
        next: 'Next',
        done: 'Done',
        yes: 'Yes',
        no: 'No',
        ok: 'OK',
        copy: 'Copy',
        paste: 'Paste',
        reset: 'Reset',
        default: 'Default',
        custom: 'Custom',
        auto: 'Auto',
        manual: 'Manual',
        none: 'None',
        all: 'All',
        select: 'Select',
        search: 'Search',
        filter: 'Filter',
        sort: 'Sort',
        refresh: 'Refresh',
        retry: 'Retry',
        settings: 'Settings',
        help: 'Help',
        about: 'About',
        version: 'Version',
        name: 'Name',
        description: 'Description',
        status: 'Status',
        type: 'Type',
        size: 'Size',
        path: 'Path',
        time: 'Time',
        date: 'Date',
        actions: 'Actions',
        more: 'More',
        less: 'Less',
        expand: 'Expand',
        collapse: 'Collapse',
        preview: 'Preview',
        download: 'Download',
        upload: 'Upload',
        import: 'Import',
        export: 'Export',
        create: 'Create',
        update: 'Update',
        apply: 'Apply',
        install: 'Install',
        uninstall: 'Uninstall',
        start: 'Start',
        stop: 'Stop',
        pause: 'Pause',
        resume: 'Resume',
        running: 'Running',
        stopped: 'Stopped',
        pending: 'Pending',
        completed: 'Completed',
        failed: 'Failed',
        unknown: 'Unknown'
    },

    components: {
        announcement: {
            title: 'What\'s New',
            gotIt: 'Got it'
        },
        attachment: {
            preview: 'Preview',
            download: 'Download',
            close: 'Close',
            downloadFile: 'Download File',
            unsupportedPreview: 'This file type cannot be previewed',
            imageFile: 'Image File',
            videoFile: 'Video File',
            audioFile: 'Audio File',
            documentFile: 'Document File',
            otherFile: 'Other File'
        },

        common: {
            confirmDialog: {
                title: 'Confirm',
                message: 'Are you sure you want to proceed?',
                confirm: 'Confirm',
                cancel: 'Cancel'
            },
            inputDialog: {
                title: 'Input',
                confirm: 'OK',
                cancel: 'Cancel'
            },
            deleteDialog: {
                title: 'Delete Message',
                message: 'Are you sure you want to delete this message?',
                messageWithCount: 'Are you sure you want to delete this message? This will also delete the following {count} messages, {total} messages will be deleted in total.',
                checkpointHint: 'A backup was detected before this message. You can choose to restore to that backup point before deleting to recover file changes.',
                cancel: 'Cancel',
                delete: 'Delete',
                restoreToUserMessage: 'Restore to before user message',
                restoreToAssistantMessage: 'Restore to before assistant message',
                restoreToToolBatch: 'Restore to before batch tool execution',
                restoreToTool: 'Restore to before {toolName} execution',
                restoreToAfterUserMessage: 'Restore to after user message',
                restoreToAfterAssistantMessage: 'Restore to after assistant message',
                restoreToAfterToolBatch: 'Restore to after batch tool execution',
                restoreToAfterTool: 'Restore to after {toolName} execution'
            },
            editDialog: {
                title: 'Edit Message',
                placeholder: 'Enter new message content... (paste attachments, drag files to add badges, Ctrl+Shift+drag to insert @path text, type @ to search files)',
                addAttachment: 'Add Attachment',
                checkpointHint: 'A tool execution backup was detected before this message. You can choose to restore to before tool execution and then edit to recover file changes.',
                cancel: 'Cancel',
                save: 'Save',
                restoreToUserMessage: 'Restore to before user message',
                restoreToAssistantMessage: 'Restore to before assistant message',
                restoreToToolBatch: 'Restore to before batch tool execution',
                restoreToTool: 'Restore to before {toolName} execution',
                restoreToAfterUserMessage: 'Restore to after user message',
                restoreToAfterAssistantMessage: 'Restore to after assistant message',
                restoreToAfterToolBatch: 'Restore to after batch tool execution',
                restoreToAfterTool: 'Restore to after {toolName} execution'
            },
            retryDialog: {
                title: 'Retry Message',
                message: 'Are you sure you want to retry this message? This will delete this message and subsequent messages, then request a new AI response.',
                checkpointHint: 'A tool execution backup was detected before this message. You can choose to restore to before tool execution and then retry.',
                cancel: 'Cancel',
                retry: 'Retry',
                restoreToUserMessage: 'Restore to before user message',
                restoreToAssistantMessage: 'Restore to before assistant message',
                restoreToToolBatch: 'Restore to before batch tool execution',
                restoreToTool: 'Restore to before {toolName} execution',
                restoreToAfterUserMessage: 'Restore to after user message',
                restoreToAfterAssistantMessage: 'Restore to after assistant message',
                restoreToAfterToolBatch: 'Restore to after batch tool execution',
                restoreToAfterTool: 'Restore to after {toolName} execution'
            },
            dependencyWarning: {
                title: 'Dependencies Required',
                defaultMessage: 'This feature requires the following dependencies:',
                hint: 'Please go to',
                linkText: 'Extension Dependencies'
            },
            emptyState: {
                noData: 'No data',
                noResults: 'No results found'
            },
            tooltip: {
                copied: 'Copied',
                copyFailed: 'Copy failed'
            },
            modal: {
                close: 'Close'
            },
            markdown: {
                copyCode: 'Copy code',
                wrapEnable: 'Wrap lines',
                wrapDisable: 'No wrap',
                copied: 'Copied',
                imageLoadFailed: 'Failed to load image'
            },
            markdownRenderer: {
                mermaid: {
                    title: 'Mermaid Diagram',
                    copyCode: 'Copy Mermaid code',
                    zoomIn: 'Zoom in',
                    zoomOut: 'Zoom out',
                    resetZoom: 'Reset zoom',
                    tip: 'Scroll to zoom, drag to pan',
                    closePreview: 'Close preview'
                }
            },
            scrollToTop: 'Scroll to top',
            scrollToBottom: 'Scroll to bottom'
        },

        header: {
            newChat: 'New Chat',
            history: 'History',
            settings: 'Settings',
            model: 'Model',
            channel: 'Channel'
        },

        tabs: {
            newChat: 'New Chat',
            newTab: 'New Tab',
            closeTab: 'Close Tab'
        },

        history: {
            title: 'Chat History',
            empty: 'No conversations yet',
            deleteConfirm: 'Are you sure you want to delete this conversation?',
            searchPlaceholder: 'Search conversations...',
            clearSearch: 'Clear search',
            noSearchResults: 'No matching conversations',
            today: 'Today',
            yesterday: 'Yesterday',
            thisWeek: 'This Week',
            earlier: 'Earlier',
            noTitle: 'Untitled',
            currentWorkspace: 'Current Workspace',
            allWorkspaces: 'All Workspaces',
            backToChat: 'Back to Chat',
            showHistory: 'Show history:',
            revealInExplorer: 'Reveal in Explorer',
            deleteConversation: 'Delete Conversation',
            messages: 'messages'
        },

        home: {
            welcome: 'Welcome to LimCode',
            welcomeMessage: 'AI coding assistant helping you write code more efficiently',
            welcomeHint: 'Type a message in the input box below to start a conversation',
            quickStart: 'Quick Start',
            recentChats: 'Recent Chats',
            noRecentChats: 'No conversation history',
            viewAll: 'View All'
        },

        input: {
            placeholder: 'Type a message...',
            placeholderHint: 'Type a message... (Enter to send, paste attachments, Shift+drag or @ to add paths, Ctrl+Shift+drag to insert @path text)',
            send: 'Send message',
            stopGenerating: 'Stop generating',
            attachFile: 'Attach file',
            pinnedFiles: 'Pinned files',
            skills: 'Skills',
            summarizeContext: 'Summarize context',
            selectChannel: 'Select channel',
            selectModel: 'Select model',
            clickToPreview: 'Click to preview',
            remove: 'Remove',
            tokenUsage: 'Usage',
            context: 'Context',
            fileNotExists: 'File does not exist',
            queue: {
                title: 'Queued Messages',
                sendNow: 'Send now',
                remove: 'Remove',
                queued: 'Queued',
                drag: 'Drag to reorder',
                edit: 'Edit'
            },
            mode: {
                selectMode: 'Select mode',
                manageMode: 'Manage Modes',
                search: 'Search modes...',
                noResults: 'No matching modes'
            },
            channelSelector: {
                placeholder: 'Select config',
                searchPlaceholder: 'Search channels...',
                noMatch: 'No matching channels'
            },
            modelSelector: {
                placeholder: 'Select model',
                searchPlaceholder: 'Search models...',
                noMatch: 'No matching models',
                addInSettings: 'Please add models in settings'
            },
            pinnedFilesPanel: {
                title: 'Pinned Files',
                description: 'Pinned file contents will be sent to AI in every conversation',
                loading: 'Loading...',
                empty: 'No pinned files',
                notExists: 'Does not exist',
                dragHint: 'Hold Shift and drag text files from workspace here to add',
                dropHint: 'Release to add file'
            },
            skillsPanel: {
                title: 'Skills',
                description: 'Skills are user-defined knowledge modules. Checkbox: enable in conversation. Switch: send detailed content to AI.',
                loading: 'Loading...',
                empty: 'No skills available. Click the folder icon in the top right to open the directory. Create a folder containing a SKILL.md file to add a skill.',
                notExists: 'Does not exist',
                enableTooltip: 'Enable this skill in current conversation',
                sendContentTooltip: 'Send skill content to AI when enabled',
                hint: 'AI can also decide whether to send skill content via toggle_skills tool',
                openDirectory: 'Open Skills Directory',
                refresh: 'Refresh Skills list'
            },
            promptContext: {
                title: 'Prompt Context',
                description: 'These contents will be attached before your message in XML format to provide extra context for AI',
                empty: 'No context content',
                emptyHint: 'Drag files here, or click + to add custom text',
                addText: 'Add Custom Text',
                addFile: 'Add File Content',
                titlePlaceholder: 'Enter title...',
                contentPlaceholder: 'Enter content...',
                typeFile: 'File',
                typeText: 'Text',
                typeSnippet: 'Snippet',
                hint: 'Content will be sent to AI wrapped in <context> tags',
                dropHint: 'Release to add file content',
                fileAdded: 'Added file content: {path}',
                readFailed: 'Failed to read file',
                addFailed: 'Add failed: {error}'
            },
            filePicker: {
                title: 'Select File',
                subtitle: 'Type after @ to filter paths',
                loading: 'Searching...',
                empty: 'No matching files found',
                navigate: 'navigate',
                select: 'select',
                close: 'close',
                ctrlClickHint: 'Insert as @path text'
            },
            notifications: {
                summarizeFailed: 'Summarize failed: {error}',
                summarizeSuccess: 'Successfully summarized {count} messages',
                summarizeError: 'Summarize failed: {error}',
                holdShiftToDrag: 'Please hold Shift key to drag files',
                fileNotInWorkspace: 'File is not in workspace',
                fileNotInAnyWorkspace: 'File is not in any open workspace',
                fileInOtherWorkspace: 'File belongs to another workspace: {workspaceName}',
                fileAdded: 'Added pinned file: {path}',
                addFailed: 'Add failed: {error}',
                cannotGetFilePath: 'Cannot get file path, please drag from VSCode Explorer or tab',
                fileNotMatchOrNotInWorkspace: 'File is not in workspace or filename does not match',
                removeFailed: 'Remove failed: {error}'
            }
        },

        message: {
            roles: {
                user: 'User',
                tool: 'Tool',
                assistant: 'Assistant'
            },
            actions: {
                viewRaw: 'View raw'
            },
            emptyResponse: '(Empty response from model)',
            stats: {
                responseDuration: 'Response Duration',
                tokenRate: 'Token Rate'
            },
            thought: {
                thinking: 'Thinking...',
                thoughtProcess: 'Thought Process'
            },
            contextBlocks: {
                clickToView: 'Click to view full content'
            },
            summary: {
                title: 'Context Summary',
                compressed: 'Compressed {count} messages',
                deleteTitle: 'Delete Summary'
            },
            checkpoint: {
                userMessageBefore: 'Before User Message',
                userMessageAfter: 'After User Message',
                assistantMessageBefore: 'Before Assistant Message',
                assistantMessageAfter: 'After Assistant Message',
                toolBatchBefore: 'Before Tool Batch',
                toolBatchAfter: 'After Tool Batch',
                userMessageUnchanged: 'User Message · Unchanged',
                assistantMessageUnchanged: 'Assistant Message · Unchanged',
                toolBatchUnchanged: 'Tool Batch Completed · Unchanged',
                toolExecutionUnchanged: 'Tool Execution Completed · Unchanged',
                restoreTooltip: 'Restore workspace to this checkpoint',
                fileCount: '{count} files',
                yesterday: 'Yesterday',
                daysAgo: '{days} days ago',
                restoreConfirmTitle: 'Restore Checkpoint',
                restoreConfirmMessage: 'Are you sure you want to restore the workspace to this checkpoint? This will overwrite the corresponding files in your current workspace, and this action cannot be undone.',
                restoreConfirmBtn: 'Restore'
            },
            continue: {
                title: 'Conversation Paused',
                description: 'Tool execution completed. You can send a new message or click "Continue" to let AI continue responding',
                button: 'Continue'
            },
            error: {
                title: 'Request Failed',
                retry: 'Retry',
                dismiss: 'Dismiss'
            },
            tool: {
                parameters: 'Parameters',
                result: 'Result',
                error: 'Error',
                paramCount: '{count} parameters',
                streamingArgs: 'Generating arguments...',
                confirmExecution: 'Click to confirm execution',
                confirm: 'Confirm Execution',
                saveAll: 'Save All',
                rejectAll: 'Reject All',
                reject: 'Reject',
                confirmed: 'Confirmed',
                rejected: 'Rejected',
                viewDiff: 'View Diff',
                viewDiffInVSCode: 'View diff in VSCode',
                openDiffFailed: 'Failed to open diff preview',
                todoWrite: {
                    label: 'TODO',
                    labelWithCount: 'TODO · {count}',
                    mergePrefix: 'Merge · ',
                    description: 'Pending {pending} · In Progress {inProgress} · Completed {completed}'
                },
                todoUpdate: {
                    label: 'TODO Update',
                    labelWithCount: 'TODO Update · {count}',
                    description: 'Add {add} · Status {setStatus} · Content {setContent} · Cancel {cancel} · Remove {remove}'
                },
                createPlan: {
                    label: 'Create Plan',
                    fallbackTitle: 'Plan'
                },
                todoPanel: {
                    title: 'TODO List',
                    modePlan: 'plan',
                    modeUpdate: 'update',
                    modeMerge: 'merge',
                    sourceCurrentInput: 'Current tool input',
                    sourceSnapshot: 'Snapshot at that time',
                    statusPending: 'Pending',
                    statusInProgress: 'In Progress',
                    statusCompleted: 'Completed',
                    statusCancelled: 'Cancelled',
                    totalItems: '{count} items',
                    copyAsMarkdown: 'Copy as Markdown',
                    copyMarkdown: 'Copy Markdown',
                    copied: 'Copied',
                    empty: 'No TODOs',
                    markdownCancelledSuffix: ' (cancelled)',
                    markdownInProgressSuffix: ' (in progress)',
                    copyFailed: 'Copy failed'
                },
                planCard: {
                    title: 'Plan',
                    executeLabel: 'Execute:',
                    executed: 'Executed',
                    executing: 'Executing...',
                    executePlan: 'Execute Plan',
                    loadChannelsFailed: 'Failed to load channels',
                    loadModelsFailed: 'Failed to load models',
                    executePlanFailed: 'Failed to execute plan',
                    promptPrefix: 'Please execute the following plan:\n\n{plan}'
                }
            },
            attachment: {
                clickToPreview: 'Click to preview',
                removeAttachment: 'Remove attachment'
            }
        },

        settings: {
            title: 'Settings',
            tabs: {
                channel: 'Channel',
                tools: 'Tools',
                autoExec: 'Auto Execute',
                mcp: 'MCP',
                subagents: 'Sub-Agents',
                checkpoint: 'Checkpoint',
                summarize: 'Summarize',
                imageGen: 'Image Generation',
                dependencies: 'Dependencies',
                context: 'Context',
                prompt: 'Prompt',
                tokenCount: 'Token Count',
                appearance: 'Appearance',
                general: 'General'
            },
            channelSettings: {
                selector: {
                    placeholder: 'Select Config',
                    rename: 'Rename',
                    add: 'New Config',
                    delete: 'Delete Config',
                    inputPlaceholder: 'Enter config name',
                    confirm: 'Confirm',
                    cancel: 'Cancel'
                },
                dialog: {
                    new: {
                        title: 'New Configuration',
                        nameLabel: 'Config Name',
                        namePlaceholder: 'e.g.: My Gemini',
                        typeLabel: 'API Type',
                        typePlaceholder: 'Select API type',
                        cancel: 'Cancel',
                        create: 'Create'
                    },
                    delete: {
                        title: 'Delete Configuration',
                        message: 'Are you sure you want to delete config "{name}"? This action cannot be undone.',
                        atLeastOne: 'At least one config must be kept',
                        cancel: 'Cancel',
                        confirm: 'Confirm'
                    }
                },
                form: {
                    apiUrl: {
                        label: 'API URL',
                        placeholder: 'Enter API URL',
                        placeholderResponses: 'Enter base API URL, e.g., https://api.openai.com/v1'
                    },
                    apiKey: {
                        label: 'API Key',
                        placeholder: 'Enter API Key',
                        show: 'Show',
                        hide: 'Hide',
                        useAuthorization: 'Send as Authorization format',
                        useAuthorizationHintGemini: 'Convert x-goog-api-key to Authorization: Bearer format',
                        useAuthorizationHintAnthropic: 'Convert x-api-key to Authorization: Bearer format'
                    },
                    stream: {
                        label: 'Stream Output'
                    },
                    channelType: {
                        label: 'Channel Type',
                        gemini: 'Gemini API',
                        openai: 'OpenAI API',
                        'openai-responses': 'OpenAI Responses API',
                        anthropic: 'Anthropic API'
                    },
                    toolMode: {
                        label: 'Tool Call Format',
                        placeholder: 'Select tool call format',
                        functionCall: {
                            label: 'Function Calling',
                            description: 'Use native function calling'
                        },
                        xml: {
                            label: 'XML Prompt',
                            description: 'Use XML format prompt'
                        },
                        json: {
                            label: 'JSON Boundary Markers',
                            description: 'Use JSON format + boundary markers (recommended)'
                        },
                        hint: {
                            functionCall: 'Function Calling: Use API native function calling feature',
                            xml: 'XML Prompt: Convert tools to XML format in system prompt',
                            json: 'JSON Boundary Markers: Use JSON format + <<<TOOL_CALL>>> boundary markers (recommended)'
                        },
                        openaiWarning: 'OpenAI Function Call mode does not support multimodal tools (such as read_file for reading images, generate_image, remove_background, crop_image, resize_image, rotate_image). To use multimodal features, please switch to XML or JSON mode.'
                    },
                    multimodal: {
                        label: 'Enable Multimodal Tools',
                        supportedTypes: 'Supported file types:',
                        image: 'Image',
                        imageFormats: 'PNG, JPEG, WebP',
                        document: 'Document',
                        documentFormats: 'PDF',
                        capabilities: 'Multimodal Tool Capabilities:',
                        table: {
                            channel: 'Channel / Mode',
                            readImage: 'Read Image',
                            readDocument: 'Read Document',
                            generateImage: 'Generate Image',
                            historyMultimodal: 'History Multimodal'
                        },
                        channels: {
                            geminiAll: 'Gemini (All)',
                            anthropicAll: 'Anthropic (All)',
                            openaiXmlJson: 'OpenAI (XML/JSON)',
                            openaiResponses: 'OpenAI (Responses)',
                            openaiFunction: 'OpenAI (Function Call)'
                        },
                        legend: {
                            supported: 'Supported',
                            notSupported: 'Not Supported'
                        },
                        notes: {
                            requireEnable: 'This option must be enabled to use multimodal tools like read_file for images/documents, generate_image, remove_background, crop_image, resize_image, rotate_image',
                            userAttachment: 'User-submitted attachments are not affected by this config and are always processed according to channel native capabilities',
                            geminiAnthropic: 'Gemini / Anthropic: Tools can directly return images and documents, support image generation',
                            openaiResponses: 'OpenAI Responses: Native support for images/PDFs, supports real-time thinking display',
                            openaiXmlJson: 'OpenAI XML/JSON: Supports reading images and generating images, does not support documents'
                        }
                    },
                    timeout: {
                        label: 'Timeout (ms)',
                        placeholder: '30000'
                    },
                    maxContextTokens: {
                        label: 'Max Context Tokens',
                        placeholder: '128000',
                        hint: 'Upper limit for displaying context usage'
                    },
                    contextManagement: {
                        title: 'Context Management',
                        enableTitle: 'Enable context threshold detection',
                        threshold: {
                            label: 'Context Threshold',
                            placeholder: '80% or 100000',
                            hint: 'When total tokens exceed this threshold, automatically discard oldest conversation turns. Supports two formats: percentage (e.g. 80%) or absolute value (e.g. 100000)'
                        },
                        extraCut: {
                            label: 'Extra Cut',
                            placeholder: '0 or 10%',
                            hint: 'Extra tokens to cut when trimming. Actual reserve = threshold - extra cut. Supports percentage or absolute value, defaults to 0'
                        },
                        autoSummarize: {
                            label: 'Auto Summarize (Coming Soon)',
                            enableTitle: 'Enable auto summarize',
                            hint: 'When enabled, summarize old turns before discarding (feature in development)'
                        }
                    },
                    toolOptions: {
                        title: 'Tool Configuration'
                    },
                    advancedOptions: {
                        title: 'Advanced Options'
                    },
                    customBody: {
                        title: 'Custom Body',
                        enableTitle: 'Enable custom body'
                    },
                    customHeaders: {
                        title: 'Custom Headers',
                        enableTitle: 'Enable custom headers'
                    },
                    autoRetry: {
                        title: 'Auto Retry',
                        enableTitle: 'Enable auto retry',
                        retryCount: {
                            label: 'Retry Count',
                            hint: 'Maximum retry attempts when API returns error (1-10)'
                        },
                        retryInterval: {
                            label: 'Retry Interval (ms)',
                            hint: 'Wait time between each retry (1000-60000 milliseconds)'
                        }
                    },
                    enabled: {
                        label: 'Enable this configuration'
                    }
                }
            },
            tools: {
                title: 'Tools Settings',
                description: 'Manage and configure available tools',
                enableAll: 'Enable All',
                disableAll: 'Disable All',
                toolName: 'Tool Name',
                toolDescription: 'Tool Description',
                toolEnabled: 'Enabled'
            },
            autoExec: {
                title: 'Auto Execute',
                intro: {
                    title: 'Tool Execution Confirmation',
                    description: 'Configure whether user confirmation is required when AI calls tools. Checked means auto execute (no confirmation needed), unchecked means confirmation required before execution.'
                },
                actions: {
                    refresh: 'Refresh',
                    enableAll: 'Auto Execute All',
                    disableAll: 'Confirm All'
                },
                status: {
                    loading: 'Loading tools list...',
                    empty: 'No tools available',
                    autoExecute: 'Auto Execute',
                    needConfirm: 'Need Confirm'
                },
                categories: {
                    file: 'File Operations',
                    search: 'Search',
                    terminal: 'Terminal',
                    lsp: 'Code Intelligence',
                    media: 'Media Processing',
                    plan: 'Plan',
                    mcp: 'MCP Tools',
                    other: 'Other'
                },
                badges: {
                    dangerous: 'Dangerous'
                },
                tips: {
                    dangerousDefault: '• Tools marked as "Dangerous" require user confirmation by default before execution',
                    deleteFileWarning: '• delete_file: File deletion is irreversible, recommend keeping confirmation enabled',
                    executeCommandWarning: '• execute_command: Executing terminal commands may affect the system',
                    mcpToolsDefault: '• MCP Tools: From connected MCP servers, auto execute by default',
                    useWithCheckpoint: '• Recommend using with checkpoint feature to restore in case of mistakes'
                }
            },
            mcp: {
                title: 'MCP Settings',
                description: 'Configure Model Context Protocol servers',
                addServer: 'Add Server',
                serverName: 'Server Name',
                serverCommand: 'Command',
                serverArgs: 'Arguments',
                serverEnv: 'Environment Variables',
                serverStatus: 'Server Status',
                connecting: 'Connecting',
                connected: 'Connected',
                disconnected: 'Disconnected',
                error: 'Error'
            },
            checkpoint: {
                title: 'Checkpoint Settings',
                loading: 'Loading config...',
                sections: {
                    enable: {
                        label: 'Enable Checkpoint Feature',
                        description: 'Automatically create codebase snapshots before and after tool execution, supporting one-click rollback'
                    },
                    messages: {
                        title: 'Message Type Checkpoints',
                        description: 'Choose whether to create checkpoints for user and model messages (independent of tool calls)',
                        beforeLabel: 'Before Message',
                        afterLabel: 'After Message',
                        types: {
                            user: {
                                name: 'User Message',
                                description: 'Messages sent by user'
                            },
                            model: {
                                name: 'Model Message',
                                description: 'Messages replied by model (excluding tool calls)'
                            }
                        },
                        options: {
                            modelOuterLayerOnly: {
                                label: 'When tools are called continuously, only create model message checkpoints at outermost layer',
                                hint: 'When enabled, "before message" checkpoint is only created in first iteration, "after message" checkpoint is only created in last iteration (no tool calls). When disabled, checkpoints are created in every iteration.'
                            },
                            mergeUnchanged: {
                                label: 'Merge checkpoints when content is unchanged before and after messages',
                                hint: 'When enabled, if checkpoint content is the same before and after message, they will be merged and displayed as a single "unchanged" checkpoint. When disabled, before/after checkpoints will always be displayed separately.'
                            }
                        }
                    },
                    tools: {
                        title: 'Tool Backup Configuration',
                        description: 'Select tools that need backups before and after execution',
                        beforeLabel: 'Before Execution',
                        afterLabel: 'After Execution',
                        empty: 'No tools available'
                    },
                    other: {
                        title: 'Other Configuration',
                        maxCheckpoints: {
                            label: 'Maximum Checkpoints',
                            placeholder: '-1',
                            hint: 'Automatically clean up old checkpoints when exceeding this number, -1 means unlimited'
                        }
                    },
                    cleanup: {
                        title: 'Cleanup Checkpoints',
                        description: 'Clean up checkpoints by conversation to free up storage',
                        searchPlaceholder: 'Search conversation title...',
                        loading: 'Loading...',
                        noMatch: 'No matching conversations found',
                        noCheckpoints: 'No checkpoints',
                        refresh: 'Refresh List',
                        checkpointCount: '{count} checkpoints',
                        confirmDelete: {
                            title: 'Confirm Deletion',
                            message: 'Are you sure you want to delete all checkpoints?',
                            stats: 'Will delete {count} checkpoints, freeing {size} storage',
                            warning: 'This operation cannot be undone',
                            cancel: 'Cancel',
                            delete: 'Delete'
                        },
                        timeFormat: {
                            justNow: 'Just now',
                            minutesAgo: '{count} minutes ago',
                            hoursAgo: '{count} hours ago',
                            daysAgo: '{count} days ago'
                        }
                    }
                }
            },
            summarize: {
                title: 'Context Summarize',
                description: 'Compress conversation history to reduce token usage',
                enableSummarize: 'Enable Summarize',
                tokenThreshold: 'Token Threshold',
                summaryModel: 'Summary Model',
                summaryPrompt: 'Summary Prompt'
            },
            imageGen: {
                title: 'Image Generation',
                description: 'Configure AI image generation tool',
                enableImageGen: 'Enable Image Generation',
                provider: 'Provider',
                model: 'Model',
                outputPath: 'Output Path',
                maxImages: 'Max Images'
            },
            dependencies: {
                title: 'Extension Dependencies',
                description: 'Manage dependencies for optional features',
                installed: 'Installed',
                notInstalled: 'Not Installed',
                installing: 'Installing',
                installFailed: 'Install Failed',
                install: 'Install',
                uninstall: 'Uninstall',
                required: 'Required',
                optional: 'Optional'
            },
            context: {
                title: 'Context Awareness',
                description: 'Configure workspace context sent to AI',
                includeFileTree: 'Include File Tree',
                includeOpenFiles: 'Include Open Files',
                includeSelection: 'Include Selection',
                maxDepth: 'Max Depth',
                excludePatterns: 'Exclude Patterns',
                pinnedFiles: 'Pinned Files',
                addPinnedFile: 'Add Pinned File'
            },
            prompt: {
                title: 'System Prompt',
                description: 'Customize system prompt structure and content',
                systemPrompt: 'System Prompt',
                customPrompt: 'Custom Prompt',
                templateVariables: 'Template Variables',
                preview: 'Preview',
                sections: {
                    environment: 'Environment',
                    tools: 'Tools',
                    context: 'Context',
                    instructions: 'Instructions'
                }
            },
            general: {
                title: 'General Settings',
                description: 'Basic configuration options',
                proxy: {
                    title: 'Network Proxy',
                    description: 'Configure HTTP proxy for API requests',
                    enable: 'Enable Proxy',
                    url: 'Proxy URL',
                    urlPlaceholder: 'http://127.0.0.1:7890',
                    urlError: 'Please enter a valid proxy address (http:// or https://)'
                },
                language: {
                    title: 'Interface Language',
                    description: 'Choose interface display language',
                    auto: 'Follow System',
                    autoDescription: 'Automatically follow VS Code language setting'
                },
                appInfo: {
                    title: 'Application Info',
                    name: 'LimCode - Vibe Coding Assistant',
                    version: 'Version',
                    repository: 'Repository',
                    developer: 'Developer'
                }
            },
            contextSettings: {
                loading: 'Loading...',
                workspaceFiles: {
                    title: 'Workspace File Tree',
                    description: 'Send workspace directory structure to AI',
                    sendFileTree: 'Send workspace file tree',
                    maxDepth: 'Max Depth',
                    unlimitedHint: '-1 means unlimited'
                },
                openTabs: {
                    title: 'Open Tabs',
                    description: 'Send current open file list to AI',
                    sendOpenTabs: 'Send open tabs',
                    maxCount: 'Max Count'
                },
                activeEditor: {
                    title: 'Current Active Editor',
                    description: 'Send currently editing file path to AI',
                    sendActiveEditor: 'Send current active editor path'
                },
                diagnostics: {
                    title: 'Diagnostics',
                    description: 'Send workspace errors, warnings, and other diagnostics to AI to help fix code issues',
                    enableDiagnostics: 'Enable diagnostics',
                    severityTypes: 'Problem types',
                    severity: {
                        error: 'Error',
                        warning: 'Warning',
                        information: 'Info',
                        hint: 'Hint'
                    },
                    workspaceOnly: 'Workspace files only',
                    openFilesOnly: 'Open files only',
                    maxPerFile: 'Max per file',
                    maxFiles: 'Max files'
                },
                ignorePatterns: {
                    title: 'Ignore Patterns',
                    description: 'Matching files/folders will not appear in context (supports wildcards)',
                    removeTooltip: 'Remove',
                    emptyHint: 'No custom ignore patterns',
                    inputPlaceholder: 'Enter pattern, e.g.: **/node_modules, *.log',
                    addButton: 'Add',
                    helpTitle: 'Wildcard Help:',
                    helpItems: {
                        wildcard: '* - Matches any character (excludes path separator)',
                        recursive: '** - Matches any directory level',
                        examples: 'e.g.: **/node_modules, *.log, .git'
                    }
                },
                preview: {
                    title: 'Current Status Preview',
                    autoRefreshBadge: 'Live Update',
                    description: 'Preview context information to be sent to AI (auto-refresh every 2 seconds)',
                    activeEditorLabel: 'Current Active Editor:',
                    openTabsLabel: 'Open Tabs ({count}):',
                    noValue: 'None',
                    moreItems: '... {count} more'
                },
                saveSuccess: 'Saved successfully',
                saveFailed: 'Save failed'
            },
            dependencySettings: {
                title: 'Extension Dependency Management',
                description: 'Manage dependencies required for optional extension features. These dependencies will be installed to the local file system and not packaged into the plugin.',
                installPath: 'Install Path:',
                installed: 'Installed',
                installing: 'Installing...',
                uninstalling: 'Uninstalling...',
                install: 'Install',
                uninstall: 'Uninstall',
                estimatedSize: 'About {size}MB',
                empty: 'No tools requiring dependencies',
                progress: {
                    processing: 'Processing {dependency}...',
                    complete: '{dependency} processing complete',
                    failed: '{dependency} processing failed',
                    installSuccess: '{name} installed successfully!',
                    installFailed: '{name} installation failed',
                    uninstallSuccess: '{name} uninstalled',
                    uninstallFailed: '{name} uninstallation failed',
                    unknownError: 'Unknown error'
                },
                panel: {
                    installedCount: '{installed}/{total}'
                }
            },
            generateImageSettings: {
                description: 'The image generation tool allows AI to call the image generation model to create images. Generated images will be saved to the workspace and returned to AI for viewing in multimodal form.',
                api: {
                    title: 'API Configuration',
                    url: 'API URL',
                    urlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
                    urlHint: 'Base URL for image generation API',
                    apiKey: 'API Key',
                    apiKeyPlaceholder: 'Enter API Key',
                    apiKeyHint: 'Secret key for image generation API',
                    model: 'Model Name',
                    modelPlaceholder: 'gemini-3-pro-Image-preview',
                    modelHint: 'e.g.: gemini-3-pro-Image-preview',
                    show: 'Show',
                    hide: 'Hide'
                },
                aspectRatio: {
                    title: 'Aspect Ratio Parameters',
                    enable: 'Enable aspect ratio parameters',
                    fixedRatio: 'Fixed Aspect Ratio',
                    placeholder: 'Not fixed (AI can choose)',
                    options: {
                        auto: 'Auto',
                        square: 'Square',
                        landscape: 'Landscape',
                        portrait: 'Portrait',
                        mobilePortrait: 'Mobile Portrait',
                        widescreen: 'Widescreen',
                        ultrawide: 'Ultra-wide'
                    },
                    hints: {
                        disabled: 'When disabled: AI cannot configure this parameter, API call will not include this parameter',
                        fixed: 'Fixed: AI will be told to fix at {ratio}, cannot change',
                        flexible: 'Not fixed: AI can choose using aspect_ratio parameter'
                    }
                },
                imageSize: {
                    title: 'Image Size Parameters',
                    enable: 'Enable image size parameters',
                    fixedSize: 'Fixed Image Size',
                    placeholder: 'Not fixed (AI can choose)',
                    options: {
                        auto: 'Auto'
                    },
                    hints: {
                        disabled: 'When disabled: AI cannot configure this parameter, API call will not include this parameter',
                        fixed: 'Fixed: AI will be told to fix at {size}, cannot change',
                        flexible: 'Not fixed: AI can choose using image_size parameter'
                    }
                },
                batch: {
                    title: 'Batch Generation Limits',
                    maxTasks: 'Max Batch Tasks',
                    maxTasksHint: 'Maximum number of tasks (images with different prompts) allowed per AI call. Range 1-20.',
                    maxImagesPerTask: 'Max Images Per Task',
                    maxImagesPerTaskHint: 'Maximum number of images saved per task (single prompt). Range 1-10.',
                    summary: 'Current config: AI can initiate up to {maxTasks} tasks per call, with up to {maxImages} images saved per task'
                },
                usage: {
                    title: 'Usage Instructions',
                    step1: 'Configure API URL, API Key, and model name above',
                    step2: 'Ensure the tool is enabled in "Tool Settings"',
                    step3: 'Have AI call the generate_image tool in conversation to create images',
                    step4: 'Generated images will be saved to the generated_images directory in the workspace',
                    warning: 'Please configure API Key before using image generation feature'
                }
            },
            mcpSettings: {
                toolbar: {
                    addServer: 'Add Server',
                    editJson: 'Edit JSON',
                    refresh: 'Refresh'
                },
                loading: 'Loading...',
                empty: {
                    title: 'No MCP Servers',
                    description: 'Click "Add Server" button to configure your first MCP server'
                },
                serverCard: {
                    connect: 'Connect',
                    disconnect: 'Disconnect',
                    connecting: 'Connecting...',
                    edit: 'Edit',
                    delete: 'Delete',
                    tools: 'Tools',
                    resources: 'Resources',
                    prompts: 'Prompts'
                },
                status: {
                    connected: 'Connected',
                    connecting: 'Connecting...',
                    error: 'Connection Error',
                    disconnected: 'Disconnected'
                },
                form: {
                    addTitle: 'Add MCP Server',
                    editTitle: 'Edit MCP Server',
                    serverId: 'Server ID',
                    serverIdPlaceholder: 'Optional, leave blank to auto-generate',
                    serverIdHint: 'Can only contain letters, numbers, underscores and hyphens, used to identify server in JSON config',
                    serverIdError: 'ID can only contain letters, numbers, underscores and hyphens',
                    serverName: 'Server Name',
                    serverNamePlaceholder: 'e.g.: My MCP Server',
                    description: 'Description',
                    descriptionPlaceholder: 'Optional description',
                    required: '*',
                    transportType: 'Transport Type',
                    command: 'Command',
                    commandPlaceholder: 'e.g.: npx, python, node',
                    args: 'Arguments',
                    argsPlaceholder: 'Space separated, e.g.: -m mcp_server',
                    env: 'Environment Variables (JSON)',
                    envPlaceholder: '{"KEY": "value"}',
                    url: 'URL',
                    urlPlaceholderSse: 'https://example.com/sse',
                    urlPlaceholderHttp: 'https://example.com/mcp',
                    headers: 'Headers (JSON)',
                    headersPlaceholder: '{"Authorization": "Bearer token"}',
                    options: 'Options',
                    enabled: 'Enabled',
                    autoConnect: 'Auto Connect',
                    cleanSchema: 'Clean Schema',
                    cleanSchemaHint: 'Remove incompatible fields from JSON Schema (e.g. $schema, additionalProperties), required for some APIs (e.g. Gemini)',
                    timeout: 'Connection Timeout (ms)',
                    cancel: 'Cancel',
                    create: 'Create',
                    save: 'Save'
                },
                validation: {
                    nameRequired: 'Please enter server name',
                    idInvalid: 'ID is invalid',
                    idChecking: 'Validating ID, please wait',
                    commandRequired: 'Please enter command',
                    urlRequired: 'Please enter URL',
                    createFailed: 'Create failed',
                    updateFailed: 'Update failed'
                },
                delete: {
                    title: 'Delete MCP Server',
                    message: 'Are you sure you want to delete server "{name}"? This action cannot be undone.',
                    confirm: 'Delete',
                    cancel: 'Cancel'
                }
            },
            subagents: {
                selectAgent: 'Select Sub-Agent',
                noAgents: 'No sub-agents',
                create: 'Create',
                rename: 'Rename',
                delete: 'Delete',
                disabled: 'Disabled',
                enabled: 'Enable this sub-agent',
                globalConfig: 'Global Configuration',
                maxConcurrentAgents: 'Max Concurrent Agents',
                maxConcurrentAgentsHint: 'Maximum number of sub-agents AI can invoke at once (-1 for unlimited)',
                basicInfo: 'Basic Info',
                description: 'Description',
                descriptionPlaceholder: 'Describe when the main AI should use this sub-agent',
                maxIterations: 'Max Iterations',
                maxIterationsHint: 'Maximum tool call rounds for this sub-agent (-1 for unlimited)',
                maxRuntime: 'Max Runtime',
                maxRuntimeHint: 'Maximum runtime in seconds (-1 for unlimited)',
                systemPrompt: 'System Prompt',
                systemPromptPlaceholder: 'Enter the sub-agent system prompt...',
                channelModel: 'Channel & Model',
                channel: 'Channel',
                selectChannel: 'Select Channel',
                model: 'Model',
                selectModel: 'Select Model',
                tools: 'Tool Configuration',
                toolsDescription: 'Configure tools available to this sub-agent',
                toolMode: {
                    label: 'Tool Mode',
                    all: 'All Tools',
                    builtin: 'Built-in Only',
                    mcp: 'MCP Only',
                    whitelist: 'Whitelist',
                    blacklist: 'Blacklist'
                },
                builtinTools: 'Built-in Tools',
                mcpTools: 'MCP Tools',
                noTools: 'No tools available',
                whitelistHint: 'Checked tools will be allowed',
                blacklistHint: 'Checked tools will be blocked',
                emptyState: 'No sub-agents yet, click the button below to create one',
                createFirst: 'Create Sub-Agent',
                deleteConfirm: {
                    title: 'Delete Sub-Agent',
                    message: 'Are you sure you want to delete this sub-agent? This action cannot be undone.'
                },
                createDialog: {
                    title: 'Create Sub-Agent',
                    nameLabel: 'Name',
                    namePlaceholder: 'e.g., Code Review Expert',
                    nameRequired: 'Please enter a name for the sub-agent',
                    nameDuplicate: 'A sub-agent with this name already exists'
                }
            },
            modelManager: {
                title: 'Model List',
                fetchModels: 'Fetch Models',
                clearAll: 'Clear All',
                clearAllTooltip: 'Clear all models',
                empty: 'No models, please click "Fetch Models" or add manually',
                addPlaceholder: 'Manually enter model ID',
                addTooltip: 'Add',
                removeTooltip: 'Remove',
                enabledTooltip: 'Currently enabled model',
                filterPlaceholder: 'Filter models...',
                clearFilter: 'Clear filter',
                noResults: 'No matching models',
                clearDialog: {
                    title: 'Clear All Models',
                    message: 'Are you sure you want to clear all {count} models? This action cannot be undone.',
                    confirm: 'Clear',
                    cancel: 'Cancel'
                },
                errors: {
                    addFailed: 'Failed to add model',
                    removeFailed: 'Failed to remove model',
                    setActiveFailed: 'Failed to set active model'
                }
            },
            modelSelectionDialog: {
                title: 'Select Models to Add',
                selectAll: 'Select All',
                deselectAll: 'Deselect All',
                close: 'Close',
                loading: 'Loading...',
                error: 'Failed to load model list',
                retry: 'Retry',
                empty: 'No models available',
                added: 'Added',
                selectionCount: 'Selected {count} models',
                cancel: 'Cancel',
                add: 'Add ({count})',
                filterPlaceholder: 'Filter models...',
                clearFilter: 'Clear filter',
                noResults: 'No matching models'
            },
            promptSettings: {
                loading: 'Loading...',
                enable: 'Enable Custom System Prompt Template',
                enableDescription: 'When enabled, you can customize the structure and content of system prompts using module placeholders',
                modes: {
                    label: 'Prompt Mode',
                    add: 'Add Mode',
                    rename: 'Rename',
                    delete: 'Delete Mode',
                    confirmDelete: 'Are you sure you want to delete this mode? This action cannot be undone.',
                    cannotDeleteDefault: 'Cannot delete the default mode',
                    unsavedChanges: 'The current mode has unsaved changes. Are you sure you want to discard and switch?',
                    newModeName: 'Please enter a name for the new mode',
                    newModeDefault: 'New Mode',
                    renameModePrompt: 'Please enter the new mode name'
                },
                templateSection: {
                    title: 'System Prompt Template',
                    resetButton: 'Reset to Default',
                    description: 'Write system prompts directly, use {{$VARIABLE}} format to reference variables, which will be replaced with actual content when sent',
                    placeholder: 'Enter system prompt, you can use variables like {{$ENVIRONMENT}}...'
                },
                staticSection: {
                    title: 'Static System Prompt',
                    description: 'Included in system prompt, content is relatively stable, can be cached by API providers to speed up responses. Use {{$VARIABLE}} format to reference static variables.',
                    placeholder: 'Enter static system prompt, you can use {{$ENVIRONMENT}}, {{$TOOLS}} and other variables...'
                },
                dynamicSection: {
                    title: 'Dynamic Context Template',
                    description: 'Generated dynamically and appended to the end of messages on each request, contains real-time info (time, file tree, tabs, etc.), not stored in history.',
                    placeholder: 'Enter dynamic context template, you can use {{$WORKSPACE_FILES}}, {{$OPEN_TABS}} and other variables...',
                    enableTooltip: 'Enable/disable dynamic context template',
                    disabledNotice: 'Dynamic context template is disabled. No dynamic context messages will be sent to AI.'
                },
                toolPolicy: {
                    title: 'Tool Policy',
                    description: 'Restrict which tools are available in this mode. When not set, it inherits the Code mode toolset (and still respects global tool toggles).',
                    inherit: 'Inherit (default)',
                    custom: 'Custom (allowlist)',
                    inheritHint: 'This mode will inherit the Code mode toolset.',
                    searchPlaceholder: 'Search tools…',
                    selectAll: 'Select all',
                    clear: 'Clear',
                    loadingTools: 'Loading tools list...',
                    noTools: 'No tools available',
                    disabledBadge: 'Disabled',
                    emptyWarning: 'Custom tool list is enabled, but no tools are selected.',
                    emptyCannotSave: 'Please select at least 1 tool for a custom tool list'
                },
                saveButton: 'Save Configuration',
                saveSuccess: 'Saved successfully',
                saveFailed: 'Save failed',
                tokenCount: {
                    label: 'Token Count',
                    staticLabel: 'Static Template',
                    dynamicLabel: 'Dynamic Context',
                    staticTooltip: 'Token count of static template itself (excluding actual content of placeholders like {{$TOOLS}})',
                    dynamicTooltip: 'Actual token count of dynamic context (including filled content like file tree, diagnostics)',
                    channelTooltip: 'Select channel for token calculation',
                    refreshTooltip: 'Refresh token count',
                    failed: 'Count failed',
                    hint: 'Static template is the template itself, dynamic context is the filled content. Actual requests also include tool definitions.'
                },
                modulesReference: {
                    title: 'Available Variables Reference',
                    insertTooltip: 'Insert at the end of template'
                },
                staticModules: {
                    title: 'Static Variables',
                    badge: 'Cacheable',
                    description: 'These variables are included in the system prompt with relatively stable content, can be cached by API providers to speed up responses.'
                },
                dynamicModules: {
                    title: 'Dynamic Variables',
                    badge: 'Real-time',
                    description: 'These variables are dynamically inserted into the last message as context, containing real-time info like current time and file status, not stored in conversation history.'
                },
                modules: {
                    ENVIRONMENT: {
                        name: 'Environment Info',
                        description: 'Contains workspace path, operating system, current time and timezone information'
                    },
                    WORKSPACE_FILES: {
                        name: 'Workspace File Tree',
                        description: 'Lists files and directory structure in the workspace, affected by depth and ignore patterns in context awareness settings',
                        requiresConfig: 'Context Awareness > Send Workspace File Tree'
                    },
                    OPEN_TABS: {
                        name: 'Open Tabs',
                        description: 'Lists file tabs currently open in the editor',
                        requiresConfig: 'Context Awareness > Send Open Tabs'
                    },
                    ACTIVE_EDITOR: {
                        name: 'Active Editor',
                        description: 'Shows the path of the currently editing file',
                        requiresConfig: 'Context Awareness > Send Active Editor'
                    },
                    DIAGNOSTICS: {
                        name: 'Diagnostics',
                        description: 'Shows workspace errors, warnings and other diagnostics to help AI fix code issues',
                        requiresConfig: 'Context Awareness > Enable Diagnostics'
                    },
                    PINNED_FILES: {
                        name: 'Pinned Files Content',
                        description: 'Shows complete content of user-pinned files',
                        requiresConfig: 'Need to add files in the pinned files button next to input box'
                    },
                    SKILLS: {
                        name: 'Skills Content',
                        description: 'Shows content of currently enabled Skills. Skills are user-defined knowledge modules that AI can dynamically enable/disable via toggle_skills tool.',
                        requiresConfig: 'AI enables skills via toggle_skills tool'
                    },
                    TOOLS: {
                        name: 'Tool Definitions',
                        description: 'Generate tool definitions in XML or Function Call format based on channel configuration (this variable is automatically filled by the system)'
                    },
                    MCP_TOOLS: {
                        name: 'MCP Tools',
                        description: 'Additional tool definitions from MCP servers (this variable is automatically filled by the system)',
                        requiresConfig: 'Need to configure and connect servers in MCP settings'
                    }
                },
                exampleOutput: 'Example Output:',
                requiresConfigLabel: 'Requires Config:'
            },
            summarizeSettings: {
                description: 'Context summarization can compress conversation history to reduce Token usage. When conversations get too long, you can manually or automatically trigger summarization to compress old conversation content into a summary.',
                manualSection: {
                    title: 'Manual Summarization',
                    description: 'Click the compress button on the right side of the input box to manually trigger context summarization. The summarized content will replace the original conversation history.'
                },
                autoSection: {
                    title: 'Auto Summarization',
                    comingSoon: 'Coming Soon',
                    enable: 'Enable Auto Summarization',
                    enableHint: 'Automatically trigger summarization when Token usage exceeds the threshold',
                    threshold: 'Trigger Threshold',
                    thresholdUnit: '%',
                    thresholdHint: 'Trigger auto summarization when Token usage reaches this percentage'
                },
                optionsSection: {
                    title: 'Summarization Options',
                    keepRounds: 'Keep Recent Rounds',
                    keepRoundsUnit: 'rounds',
                    keepRoundsHint: 'Keep the most recent N rounds of conversation from being summarized to ensure context continuity',
                    prompt: 'Summarization Prompt',
                    promptPlaceholder: 'Enter the prompt to use for summarization...',
                    promptHint: 'Instructions used by AI when performing summarization'
                },
                modelSection: {
                    title: 'Dedicated Summarization Model',
                    useSeparate: 'Use Dedicated Summarization Model',
                    useSeparateHint: 'When enabled, summarization will use the model specified below instead of the model used in the conversation.\nYou can choose a cheaper model to save costs.',
                    currentModelHint: 'Currently using the conversation model for summarization',
                    selectChannel: 'Select Channel',
                    selectChannelPlaceholder: 'Select channel for summarization',
                    selectChannelHint: 'Only shows enabled channels',
                    selectModel: 'Select Model',
                    selectModelPlaceholder: 'Select model for summarization',
                    selectModelHint: 'Only shows models added to settings for this channel.\nTo add more models, please go to channel settings to configure.',
                    warningHint: 'Please select a channel and model, otherwise the conversation model will be used for summarization'
                }
            },
            settingsPanel: {
                title: 'Settings',
                backToChat: 'Back to Chat',
                sections: {
                    channel: {
                        title: 'Channel Settings',
                        description: 'Configure API channels and models'
                    },
                    tools: {
                        title: 'Tool Settings',
                        description: 'Manage and configure available tools'
                    },
                    autoExec: {
                        title: 'Auto Execution',
                        description: 'Configure confirmation behavior when executing tools'
                    },
                    mcp: {
                        title: 'MCP Settings',
                        description: 'Configure Model Context Protocol servers'
                    },
                    checkpoint: {
                        title: 'Checkpoint Settings',
                        description: 'Configure codebase snapshot backup and rollback'
                    },
                    summarize: {
                        title: 'Context Summarization',
                        description: 'Compress conversation history to reduce Token usage'
                    },
                    imageGen: {
                        title: 'Image Generation',
                        description: 'Configure AI image generation tools'
                    },
                    context: {
                        title: 'Context Awareness',
                        description: 'Configure workspace context information sent to AI'
                    },
                    prompt: {
                        title: 'System Prompt',
                        description: 'Customize the structure and content of system prompts'
                    },
                    tokenCount: {
                        title: 'Token Count',
                        description: 'Configure API for counting tokens'
                    },
                    subagents: {
                        title: 'Sub-Agents',
                        description: 'Configure specialized sub-agents that AI can invoke'
                    },
                    appearance: {
                        title: 'Appearance',
                        description: 'Configure UI appearance options'
                    },
                    general: {
                        title: 'General Settings',
                        description: 'Basic configuration options'
                    }
                },
                proxy: {
                    title: 'Network Proxy',
                    description: 'Configure HTTP proxy for API requests',
                    enable: 'Enable Proxy',
                    url: 'Proxy Address',
                    urlPlaceholder: 'http://127.0.0.1:7890',
                    urlError: 'Please enter a valid proxy address (http:// or https://)',
                    save: 'Save',
                    saveSuccess: 'Saved successfully',
                    saveFailed: 'Save failed'
                },
                language: {
                    title: 'Interface Language',
                    description: 'Select interface display language',
                    placeholder: 'Select Language',
                    autoDescription: 'Auto follow VS Code language settings'
                },
                appInfo: {
                    title: 'Application Info',
                    name: 'Lim Code - Vibe Coding Assistant',
                    version: 'Version: 1.0.88',
                    repository: 'Repository',
                    developer: 'Developer'
                }
            },
            toolSettings: {
                files: {
                    applyDiff: {
                        autoApply: 'Auto Apply Changes',
                        enableAutoApply: 'Enable Auto Apply',
                        enableAutoApplyDesc: 'When enabled, AI changes will be automatically saved after specified delay without manual confirmation',
                        autoSaveDelay: 'Auto Save Delay',
                        delayTime: 'Delay Time',
                        delayTimeDesc: 'Wait this amount of time after showing changes before auto-saving',
                        delay1s: '1 second',
                        delay2s: '2 seconds',
                        delay3s: '3 seconds',
                        delay5s: '5 seconds',
                        delay10s: '10 seconds',
                        infoEnabled: 'Current setting: After AI modifies files, changes will be automatically saved after {delay} and continue execution.',
                        infoDisabled: 'Current setting: After AI modifies files, you need to manually press Ctrl+S in the editor to confirm and save changes.',

                        format: 'Diff Format',
                        formatDesc: 'Choose the parameter format used when AI calls apply_diff (unified diff is recommended by default)',
                        formatUnified: 'Unified diff (unified diff patch)',
                        formatSearchReplace: 'Legacy (search/replace)',

                        skipDiffView: 'Skip Diff View',
                        enableSkipDiffView: 'Skip diff view when auto-applying',
                        enableSkipDiffViewDesc: 'When enabled, auto-applied changes will be saved directly without opening the diff comparison view',

                        diffGuard: 'Diff Guard',
                        enableDiffGuard: 'Enable deletion guard',
                        enableDiffGuardDesc: 'Show a warning when the number of deleted lines exceeds a specified percentage of the total file lines',
                        diffGuardThreshold: 'Guard Threshold',
                        diffGuardThresholdDesc: 'Trigger a warning when deleted lines exceed this percentage of total file lines',
                        diffGuardWarning: '⚠️ This change deletes {deletePercent}% of the file content ({deletedLines}/{totalLines} lines), exceeding the {threshold}% guard threshold. Please review carefully.'
                    },
                    listFiles: {
                        ignoreList: 'Ignore List',
                        ignoreListHint: '(Supports wildcards, e.g. *.log, temp*)',
                        inputPlaceholder: 'Enter file or directory pattern to ignore...',
                        deleteTooltip: 'Delete',
                        addButton: 'Add'
                    }
                },
                search: {
                    findFiles: {
                        excludeList: 'Exclude Patterns',
                        excludeListHint: '(glob format, e.g. **/node_modules/**)',
                        inputPlaceholder: 'Enter file or directory pattern to exclude...',
                        deleteTooltip: 'Delete',
                        addButton: 'Add'
                    },
                    searchInFiles: {
                        excludeList: 'Exclude Patterns',
                        excludeListHint: '(glob format, e.g. **/node_modules/**)',
                        inputPlaceholder: 'Enter file or directory pattern to exclude...',
                        deleteTooltip: 'Delete',
                        addButton: 'Add'
                    }
                },
                terminal: {
                    executeCommand: {
                        shellEnv: 'Shell Environment',
                        defaultBadge: 'Default',
                        available: 'Available',
                        unavailable: 'Unavailable',
                        setDefaultTooltip: 'Set as default',
                        executablePath: 'Executable Path (optional):',
                        executablePathPlaceholder: 'Leave empty to use path from system PATH',
                        execTimeout: 'Execution Timeout',
                        timeoutHint: 'Commands exceeding this time will be automatically terminated',
                        timeout30s: '30 seconds',
                        timeout1m: '1 minute',
                        timeout2m: '2 minutes',
                        timeout5m: '5 minutes',
                        timeout10m: '10 minutes',
                        timeoutUnlimited: 'Unlimited',
                        maxOutputLines: 'Max Output Lines',
                        maxOutputLinesHint: 'Last N lines of terminal output sent to AI, to avoid excessive output',
                        unlimitedLines: 'Unlimited',
                        tips: {
                            onlyEnabledUsed: '• Only enabled and available shells will be used by AI',
                            statusMeaning: '• ✓ means available, ✗ means unavailable',
                            windowsRecommend: '• Windows recommends using PowerShell (supports UTF-8)',
                            gitBashRequire: '• Git Bash requires Git for Windows to be installed',
                            wslRequire: '• WSL requires Windows Subsystem for Linux to be enabled',
                            confirmSettings: '• To configure execution confirmation, go to "Auto Execute" settings tab'
                        }
                    }
                },
                media: {
                    common: {
                        returnImageToAI: 'Return Image Directly to AI',
                        returnImageDesc: 'When enabled, the processed image base64 will be returned directly to AI as tool response, allowing AI to view and analyze the image content.',
                        returnImageDescDetail: 'When disabled, only text description (e.g. file path) will be returned, AI needs to call read_file tool to view the image.'
                    },
                    cropImage: {
                        title: 'Crop Image',
                        description: 'When enabled, AI can directly view the cropping effect to judge if the area is correct. Disable to save token consumption.'
                    },
                    generateImage: {
                        title: 'Image Generation',
                        description: 'When enabled, AI can directly see the generated image effect to judge if regeneration or adjustment is needed. Disable to save token consumption.'
                    },
                    removeBackground: {
                        title: 'Remove Background',
                        description: 'When enabled, AI can directly view the background removal effect to judge if subject description needs adjustment or reprocessing. Disable to save token consumption.'
                    },
                    resizeImage: {
                        title: 'Resize Image',
                        description: 'When enabled, AI can directly view the resizing effect to judge if the dimensions are appropriate. Disable to save token consumption.'
                    },
                    rotateImage: {
                        title: 'Rotate Image',
                        description: 'When enabled, AI can directly view the rotation effect to judge if the angle is correct. Disable to save token consumption.'
                    }
                },
                common: {
                    loading: 'Loading...',
                    loadingConfig: 'Loading config...',
                    saving: 'Saving...',
                    error: 'Error',
                    retry: 'Retry'
                }
            },
            toolsSettings: {
                maxIterations: {
                    label: 'Max Tool Calls Per Turn',
                    hint: 'Prevents AI from infinite tool call loops, -1 for unlimited',
                    unit: 'calls'
                },
                actions: {
                    refresh: 'Refresh',
                    enableAll: 'Enable All',
                    disableAll: 'Disable All'
                },
                loading: 'Loading tools list...',
                empty: 'No tools available',
                categories: {
                    file: 'File Operations',
                    search: 'Search',
                    terminal: 'Terminal',
                    lsp: 'Code Intelligence',
                    media: 'Media Processing',
                    plan: 'Plan',
                    todo: 'TODO',
                    other: 'Other'
                },
                dependency: {
                    required: 'Dependencies Required',
                    requiredTooltip: 'This tool requires dependencies to be installed',
                    disabledTooltip: 'Tool is disabled or missing dependencies'
                },
                config: {
                    tooltip: 'Configure Tool'
                }
            },
            tokenCountSettings: {
                description: 'Configure API for accurate token counting. When enabled, the corresponding channel\'s token counting API will be called before sending requests to get accurate token counts for more precise context management.',
                hint: 'If not configured or API call fails, will fallback to estimation method.',
                enableChannel: 'Enable token counting for this channel',
                baseUrl: 'API URL',
                apiKey: 'API Key',
                apiKeyPlaceholder: 'Enter API Key',
                model: 'Model Name',
                geminiUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens?key={key}',
                geminiUrlHint: 'Use {model} and {key} as placeholders',
                geminiModelPlaceholder: 'gemini-2.5-pro',
                anthropicUrlPlaceholder: 'https://api.anthropic.com/v1/messages/count_tokens',
                anthropicModelPlaceholder: 'claude-sonnet-4-5',
                comingSoon: 'Coming Soon',
                customApi: 'Custom API',
                openaiDocTitle: 'OpenAI Compatible API Interface',
                openaiDocDesc: 'OpenAI does not provide a standalone token counting API. If you have a self-hosted or third-party compatible token counting service, you can configure it here.',
                openaiUrlPlaceholder: 'https://your-api.example.com/count-tokens',
                openaiUrlHint: 'Your custom token counting API endpoint',
                openaiModelPlaceholder: 'gpt-4o',
                apiDocumentation: 'API Specification',
                requestExample: 'Request Example',
                requestBody: '// Request Body',
                responseFormat: '// Response Format',
                openaiDocNote: 'Your API should return a JSON response with a total_tokens field. The request body uses OpenAI Messages format.',
                saveSuccess: 'Configuration saved',
                saveFailed: 'Save failed'
            },
            appearanceSettings: {
                loadingText: {
                    title: 'Streaming Loading Text',
                    description: 'Text displayed in the animated indicator at the bottom of a message while the AI is streaming output.',
                    placeholder: 'e.g. Thinking...',
                    defaultHint: 'Leave empty to use default: {text}'
                },
                saveSuccess: 'Saved successfully',
                saveFailed: 'Save failed'
            },
            storageSettings: {
                title: 'Storage Path',
                description: 'Configure storage location for conversation history, checkpoints, etc.',
                currentPath: 'Current Storage Path',
                customPath: 'Custom Path',
                customPathPlaceholder: 'Enter custom storage path...',
                customPathHint: 'Leave empty to use default path (extension storage directory)',
                browse: 'Browse',
                apply: 'Apply',
                reset: 'Reset to Default',
                migrate: 'Migrate Data',
                migrateHint: 'Migrate existing data to new path',
                migrating: 'Migrating...',
                validating: 'Validating...',
                validation: {
                    valid: 'Path is valid',
                    invalid: 'Path is invalid',
                    checking: 'Checking...'
                },
                dialog: {
                    migrateTitle: 'Confirm Data Migration',
                    migrateMessage: 'Do you want to migrate existing data to the new path? This will copy all conversation history and checkpoints.',
                    migrateWarning: 'Do not close the window during migration',
                    confirm: 'Confirm Migration',
                    cancel: 'Cancel'
                },
                notifications: {
                    pathUpdated: 'Storage path updated',
                    pathReset: 'Storage path reset to default',
                    migrationSuccess: 'Data migration completed, please reload window for changes to take effect',
                    migrationFailed: 'Data migration failed: {error}',
                    validationFailed: 'Path validation failed: {error}'
                },
                reloadWindow: 'Reload Window'
            }
        },

        channels: {
            common: {
                temperature: {
                    label: 'Temperature',
                    hint: '0.0 - 1.0, default 1.0',
                    toggleHint: 'When enabled, this parameter will be sent to API'
                },
                maxTokens: {
                    label: 'Max Output Tokens',
                    placeholder: '4096',
                    toggleHint: 'When enabled, this parameter will be sent to API'
                },
                topP: {
                    label: 'Top-P',
                    hint: '0.0 - 1.0',
                    toggleHint: 'When enabled, this parameter will be sent to API'
                },
                topK: {
                    label: 'Top-K',
                    toggleHint: 'When enabled, this parameter will be sent to API'
                },
                thinking: {
                    title: 'Thinking Configuration',
                    toggleHint: 'When enabled, thinking parameters will be sent to API'
                },
                currentThinking: {
                    title: 'Current Round Config',
                    sendSignatures: 'Send Current Signatures',
                    sendSignaturesHint: 'Maintain reasoning context for current step',
                    sendContent: 'Send Current Thoughts',
                    sendContentHint: 'Send reasoning content of the current turn',
                },
                historyThinking: {
                    title: 'History Rounds Config',
                    sendSignatures: 'Send History Signatures',
                    sendSignaturesHint: 'Maintain reasoning context across turns',
                    sendContent: 'Send History Thoughts',
                    sendContentHint: 'Let AI see thought processes of completed rounds',
                    roundsLabel: 'History Thinking Rounds',
                    roundsHint: 'How many non-latest rounds to send. -1 for all, 0 for none, positive N for last N rounds (e.g., 1 for only the second-to-last round)'
                }
            },
            anthropic: {
                thinking: {
                    typeLabel: 'Thinking Mode',
                    typeAdaptive: 'Adaptive',
                    typeEnabled: 'Manual (Enabled)',
                    typeAdaptiveHint: 'Claude automatically decides thinking depth, recommended for Opus 4.6+',
                    typeEnabledHint: 'Manually set thinking token budget, works with all thinking-capable models',
                    budgetLabel: 'Thinking Budget (Budget Tokens)',
                    budgetPlaceholder: '10000',
                    budgetHint: 'Maximum token count for thinking process, recommended 5000-50000',
                    effortLabel: 'Thinking Effort',
                    effortMax: 'Maximum (Opus 4.6 only)',
                    effortHigh: 'High (default)',
                    effortMedium: 'Medium',
                    effortLow: 'Low',
                    effortHint: 'Controls Claude thinking depth. Higher levels think deeper but consume more tokens'
                }
            },
            gemini: {
                thinking: {
                    includeThoughts: 'Return Thought Content',
                    includeThoughtsHint: 'When enabled, API response will include the model\'s thinking process',
                    mode: 'Thinking Intensity Mode',
                    modeHint: 'Default: Use API default | Level: Choose preset level | Budget: Custom token count',
                    modeDefault: 'Default',
                    modeLevel: 'Level',
                    modeBudget: 'Budget',
                    levelLabel: 'Thinking Level',
                    levelHint: 'minimal: Minimal thinking | low: Less thinking | medium: Moderate | high: Deep thinking',
                    levelMinimal: 'Minimal',
                    levelLow: 'Low',
                    levelMedium: 'Medium',
                    levelHigh: 'High',
                    budgetLabel: 'Thinking Budget (Token)',
                    budgetPlaceholder: '1024',
                    budgetHint: 'Custom token count allowed for thinking process'
                },
                historyThinking: {
                    sendContentHint: 'When enabled, thought content (including summaries) from historical conversations will be sent, which may significantly increase context length'
                }
            },
            openai: {
                frequencyPenalty: {
                    label: 'Frequency Penalty',
                    hint: '-2.0 - 2.0',
                    toggleHint: 'When enabled, this parameter will be sent to API'
                },
                presencePenalty: {
                    label: 'Presence Penalty',
                    hint: '-2.0 - 2.0',
                    toggleHint: 'When enabled, this parameter will be sent to API'
                },
                thinking: {
                    effortLabel: 'Thinking Effort',
                    effortHint: 'none: Not used | minimal: Minimal | low: Less | medium: Moderate | high: More | xhigh: Maximum',
                    effortNone: 'None',
                    effortMinimal: 'Minimal',
                    effortLow: 'Low',
                    effortMedium: 'Medium',
                    effortHigh: 'High',
                    effortXHigh: 'Extra High',
                    summaryLabel: 'Output Detail (Summary)',
                    summaryHint: 'auto: Auto select | concise: Brief output | detailed: Detailed output',
                    summaryAuto: 'Auto',
                    summaryConcise: 'Concise',
                    summaryDetailed: 'Detailed'
                },
                historyThinking: {
                    sendSignaturesHint: 'When enabled, thought signatures from historical conversations will be sent (OpenAI not supported). Not recommended, and only signatures from non-latest turns are sent.',
                    sendContentHint: 'When enabled, reasoning_content (including summaries) from historical conversations will be sent, which may significantly increase context length'
                }
            },
            'openai-responses': {
                maxOutputTokens: {
                    label: 'Max Output Tokens',
                    placeholder: '8192',
                    hint: 'Maps to API max_output_tokens parameter'
                },
                thinking: {
                    effortLabel: 'Thinking Effort',
                    effortHint: 'none: Not used | minimal: Minimal | low: Less | medium: Moderate | high: More | xhigh: Maximum',
                    effortNone: 'None (none)',
                    effortMinimal: 'Minimal (minimal)',
                    effortLow: 'Low (low)',
                    effortMedium: 'Medium (medium)',
                    effortHigh: 'High (high)',
                    effortXHigh: 'Maximum (xhigh)',
                    summaryLabel: 'Output Detail (Summary)',
                    summaryHint: 'auto: Auto select | concise: Brief output | detailed: Detailed output',
                    summaryAuto: 'Auto',
                    summaryConcise: 'Concise',
                    summaryDetailed: 'Detailed'
                },
                historyThinking: {
                    sendSignaturesHint: 'Maintain reasoning context across turns',
                    sendContentHint: 'When enabled, reasoning_content from historical conversations will be sent'
                }
            },
            customBody: {
                hint: 'Add custom request body fields, supports nested JSON override',
                modeSimple: 'Simple Mode',
                modeAdvanced: 'Advanced Mode',
                keyPlaceholder: 'Key name (e.g.: extra_body)',
                valuePlaceholder: 'Value (supports JSON, e.g.: {"key": "value"})',
                empty: 'No custom body items',
                addItem: 'Add Item',
                jsonError: 'JSON format error',
                jsonHint: 'Complete JSON format, supports nested override',
                jsonPlaceholder: '{\n  "extra_body": {\n    "google": {\n      "thinking_config": {\n        "include_thoughts": false\n      }\n    }\n  }\n}',
                enabled: 'Enabled',
                disabled: 'Disabled',
                deleteTooltip: 'Delete'
            },
            customHeaders: {
                hint: 'Add custom HTTP request headers, sent to API in order',
                keyPlaceholder: 'Header-Name',
                valuePlaceholder: 'Header Value',
                keyDuplicate: 'Duplicate key name',
                empty: 'No custom headers',
                addHeader: 'Add Header',
                enabled: 'Enabled',
                disabled: 'Disabled',
                deleteTooltip: 'Delete'
            },
            toolOptions: {
                cropImage: {
                    title: 'Crop Image (crop_image)',
                    useNormalizedCoords: 'Use Normalized Coordinates (0-1000)',
                    enabledTitle: 'When Enabled',
                    enabledNote: 'Suitable for models using normalized coordinates like Gemini',
                    disabledTitle: 'When Disabled',
                    disabledNote: 'Model needs to calculate actual pixel coordinates',
                    coordTopLeft: '= Top-left corner',
                    coordBottomRight: '= Bottom-right corner',
                    coordCenter: '= Center point'
                }
            },
            tokenCountMethod: {
                title: 'Token Count Method',
                label: 'Count Method',
                placeholder: 'Select count method',
                hint: 'Select the method for calculating token count, affects context trimming accuracy',
                options: {
                    channelDefault: 'Use Channel Default',
                    gemini: 'Gemini API',
                    openaiCustom: 'Custom OpenAI Format',
                    openaiCustomDesc: 'Use custom API endpoint',
                    openaiResponses: 'OpenAI Responses API',
                    anthropic: 'Anthropic API',
                    local: 'Local Estimation',
                    localDesc: '~4 chars = 1 token'
                },
                defaultDesc: {
                    gemini: 'Default uses Gemini countTokens API',
                    anthropic: 'Default uses Anthropic count_tokens API',
                    openai: 'Default uses local estimation (OpenAI has no official API)'
                },
                apiConfig: {
                    title: 'API Configuration',
                    url: 'API URL',
                    urlHint: 'Leave empty to use channel URL',
                    apiKey: 'API Key',
                    apiKeyPlaceholder: 'Enter API Key',
                    apiKeyHint: 'Leave empty to use channel API Key',
                    model: 'Model',
                    modelHint: 'Model name for token counting'
                }
            }
        },

        tools: {
            executing: 'Executing...',
            executed: 'Executed',
            failed: 'Execution Failed',
            cancelled: 'Cancelled',
            approve: 'Approve',
            reject: 'Reject',
            autoExecuted: 'Auto Executed',
            terminate: 'Terminate',
            saveToPath: 'Save to path',
            openFile: 'Open File',
            openFolder: 'Open Folder',
            viewDetails: 'View Details',
            hideDetails: 'Hide Details',
            parameters: 'Parameters',
            result: 'Result',
            error: 'Error',
            duration: 'Duration',
            file: {
                readFile: 'Read File',
                writeFile: 'Write File',
                deleteFile: 'Delete File',
                createDirectory: 'Create Directory',
                listFiles: 'List Files',
                applyDiff: 'Apply Diff',
                filesRead: 'Files read',
                filesWritten: 'Files written',
                filesDeleted: 'Files deleted',
                directoriesCreated: 'Directories created',
                changesApplied: 'Changes applied',
                applyDiffPanel: {
                    title: 'Apply Diff',
                    changes: 'changes',
                    diffApplied: 'Diff applied',
                    pending: 'Pending review',
                    accepted: 'Accepted',
                    rejected: 'Rejected',
                    line: 'From line',
                    diffNumber: '#',
                    collapse: 'Collapse',
                    expandRemaining: 'Expand remaining {count} lines',
                    copied: 'Copied',
                    copyNew: 'Copy new content',
                    deletedLines: 'Deleted',
                    addedLines: 'Added',
                    userEdited: 'User Edited',
                    userEditedContent: 'User modified content'
                },
                createDirectoryPanel: {
                    title: 'Create Directory',
                    total: 'Total {count}',
                    noDirectories: 'No directories to create',
                    success: 'Success',
                    failed: 'Failed'
                },
                deleteFilePanel: {
                    title: 'Delete File',
                    total: 'Total {count}',
                    noFiles: 'No files to delete',
                    success: 'Success',
                    failed: 'Failed'
                },
                listFilesPanel: {
                    title: 'List Files',
                    recursive: 'Recursive',
                    totalStat: '{dirCount} directories, {folderCount} folders, {fileCount} files',
                    copyAll: 'Copy all list',
                    copyList: 'Copy list',
                    dirStat: '{folderCount} folders, {fileCount} files',
                    collapse: 'Collapse',
                    expandRemaining: 'Expand remaining {count}',
                    emptyDirectory: 'Directory is empty'
                },
                readFilePanel: {
                    title: 'Read File',
                    total: 'Total {count}',
                    lines: '{count} lines',
                    copied: 'Copied',
                    copyContent: 'Copy content',
                    binaryFile: 'Binary file',
                    unknownSize: 'Unknown size',
                    collapse: 'Collapse',
                    expandRemaining: 'Expand remaining {count} lines',
                    emptyFile: 'File is empty'
                },
                writeFilePanel: {
                    title: 'Write File',
                    total: 'Total {count}',
                    lines: '{count} lines',
                    copied: 'Copied',
                    copyContent: 'Copy content',
                    collapse: 'Collapse',
                    expandRemaining: 'Expand remaining {count} lines',
                    noContent: 'No content to write',
                    viewContent: 'Content',
                    viewDiff: 'Diff',
                    loadingDiff: 'Loading diff...',
                    actions: {
                        created: 'Created',
                        modified: 'Modified',
                        unchanged: 'Unchanged',
                        write: 'Write'
                    }
                }
            },
            search: {
                findFiles: 'Find Files',
                searchInFiles: 'Search in Files',
                filesFound: 'Files found',
                matchesFound: 'Matches found',
                noResults: 'No results',
                findFilesPanel: {
                    title: 'Find Files',
                    totalFiles: 'Total {count} files',
                    fileCount: '{count} files',
                    truncated: 'Truncated',
                    collapse: 'Collapse',
                    expandRemaining: 'Expand remaining {count} files',
                    noFiles: 'No matching files found'
                },
                searchInFilesPanel: {
                    title: 'Search Content',
                    replaceTitle: 'Search and Replace',
                    regex: 'Regex',
                    matchCount: '{count} matches',
                    fileCount: '{count} files',
                    truncated: 'Truncated',
                    keywords: 'Keywords:',
                    replaceWith: 'Replace with:',
                    emptyString: '(empty string)',
                    path: 'Path:',
                    pattern: 'Pattern:',
                    noResults: 'No matching content found',
                    collapse: 'Collapse',
                    expandRemaining: 'Expand remaining {count} matches',
                    replacements: 'Replaced {count} occurrences',
                    replacementsInFile: '{count} replacements',
                    filesModified: '{count} files',
                    viewMatches: 'Matches',
                    viewDiff: 'Diff',
                    loadingDiff: 'Loading diff...'
                }
            },
            terminal: {
                executeCommand: 'Execute Command',
                command: 'Command',
                output: 'Output',
                exitCode: 'Exit Code',
                running: 'Running',
                terminated: 'Terminated',
                terminateCommand: 'Terminate Command',
                executeCommandPanel: {
                    title: 'Terminal',
                    status: {
                        failed: 'Failed',
                        terminated: 'Terminated',
                        success: 'Success',
                        exitCode: 'Exit Code: {code}',
                        running: 'Running...',
                        pending: 'Pending'
                    },
                    terminate: 'Terminate',
                    terminateTooltip: 'Terminate Process',
                    copyOutput: 'Copy Output',
                    copied: 'Copied',
                    output: 'Output',
                    truncatedInfo: 'Showing last {outputLines} lines (total {totalLines} lines)',
                    autoScroll: 'Auto Scroll',
                    waitingOutput: 'Waiting for output...',
                    noOutput: 'No output',
                    executing: 'Command executing...'
                }
            },
            lsp: {
                getSymbols: 'Get Symbols',
                gotoDefinition: 'Go to Definition',
                findReferences: 'Find References',
                getSymbolsPanel: {
                    title: 'File Symbols',
                    totalFiles: 'Total {count} files',
                    totalSymbols: 'Total {count} symbols',
                    noSymbols: 'No symbols found',
                    symbolCount: '{count} symbols',
                    collapse: 'Collapse',
                    expandRemaining: 'Expand remaining {count}',
                    copyAll: 'Copy All',
                    copied: 'Copied'
                },
                gotoDefinitionPanel: {
                    title: 'Definition',
                    definitionFound: 'Definition found',
                    noDefinition: 'No definition found',
                    lines: '{count} lines',
                    copyCode: 'Copy Code',
                    copied: 'Copied'
                },
                findReferencesPanel: {
                    title: 'References',
                    totalReferences: 'Total {count} references',
                    totalFiles: '{count} files',
                    noReferences: 'No references found',
                    referencesInFile: '{count} references',
                    collapse: 'Collapse',
                    expandRemaining: 'Expand remaining {count}'
                }
            },
            mcp: {
                mcpTool: 'MCP Tool',
                serverName: 'Server Name',
                toolName: 'Tool Name',
                mcpToolPanel: {
                    requestParams: 'Request Parameters',
                    errorInfo: 'Error Information',
                    responseResult: 'Response Result',
                    waitingResponse: 'Waiting for response...'
                }
            },
            subagents: {
                title: 'Sub-Agent',
                task: 'Task',
                context: 'Context',
                completed: 'Completed',
                failed: 'Failed',
                executing: 'Executing...',
                partialResponse: 'Partial Response'
            },
            media: {
                generateImage: 'Generate Image',
                resizeImage: 'Resize Image',
                cropImage: 'Crop Image',
                rotateImage: 'Rotate Image',
                removeBackground: 'Remove Background',
                generating: 'Generating...',
                processing: 'Processing...',
                imagesGenerated: 'Images generated',
                saveImage: 'Save Image',
                saveTo: 'Save to',
                saved: 'Saved',
                saveFailed: 'Save failed',
                cropImagePanel: {
                    title: 'Crop Image',
                    cancel: 'Cancel',
                    cancelCrop: 'Cancel Crop',
                    status: {
                        needDependency: 'Needs Dependency',
                        cancelled: 'Cancelled',
                        failed: 'Failed',
                        success: 'Success',
                        error: 'Error',
                        processing: 'Processing...',
                        waiting: 'Waiting'
                    },
                    checkingDependency: 'Checking dependency status...',
                    dependencyMessage: 'Cropping requires the sharp library to process images.',
                    batchCrop: 'Batch Crop ({count})',
                    cropTask: 'Crop Task',
                    coordsHint: 'Coordinate range 0-1000 (normalized), auto-converted to actual pixels',
                    cancelledMessage: 'User cancelled the crop operation',
                    resultTitle: 'Crop Results ({count} images)',
                    original: 'Original:',
                    cropped: 'Cropped:',
                    cropResultN: 'Crop Result {n}',
                    saved: 'Saved',
                    overwriteSave: 'Overwrite Save',
                    save: 'Save',
                    openInEditor: 'Open in Editor',
                    savePaths: 'Save Paths:',
                    croppingImages: 'Cropping images...',
                    openFileFailed: 'Failed to open file:',
                    saveFailed: 'Save failed'
                },
                generateImagePanel: {
                    title: 'Image Generation',
                    cancel: 'Cancel',
                    cancelGeneration: 'Cancel Generation',
                    status: {
                        needDependency: 'Needs Dependency',
                        cancelled: 'Cancelled',
                        failed: 'Failed',
                        success: 'Success',
                        error: 'Error',
                        generating: 'Generating...',
                        waiting: 'Waiting'
                    },
                    batchTasks: 'Batch Tasks ({count})',
                    generateTask: 'Generation Task',
                    outputPath: 'Output Path',
                    aspectRatio: 'Aspect Ratio',
                    imageSize: 'Image Size',
                    referenceImages: '{count} references',
                    cancelledMessage: 'User cancelled image generation',
                    tasksFailed: '{count} tasks failed',
                    resultTitle: 'Generated Results ({count} images)',
                    saved: 'Saved',
                    overwriteSave: 'Overwrite Save',
                    save: 'Save',
                    openInEditor: 'Open in Editor',
                    savePaths: 'Save Paths:',
                    generatingImages: 'Generating images...',
                    openFileFailed: 'Failed to open file:',
                    saveFailed: 'Save failed'
                },
                removeBackgroundPanel: {
                    title: 'Remove Background',
                    cancel: 'Cancel',
                    cancelRemove: 'Cancel Remove',
                    status: {
                        needDependency: 'Needs Dependency',
                        cancelled: 'Cancelled',
                        failed: 'Failed',
                        success: 'Success',
                        error: 'Error',
                        processing: 'Processing...',
                        waiting: 'Waiting',
                        disabled: 'Disabled'
                    },
                    checkingDependency: 'Checking dependency status...',
                    dependencyMessage: 'Background removal requires the sharp library to process images.',
                    batchTasks: 'Batch Tasks ({count})',
                    removeTask: 'Remove Background Task',
                    subjectDescription: 'Subject Description',
                    maskPath: 'Mask: {path}',
                    needSharp: {
                        title: 'Sharp library required',
                        message: 'Mask generated, but sharp library is required to complete full background removal.',
                        installCmd: 'pnpm add sharp'
                    },
                    cancelledMessage: 'User cancelled background removal',
                    tasksFailed: '{count} tasks failed',
                    resultTitle: 'Processing Results ({count} images)',
                    maskImage: 'Mask Image',
                    resultImage: 'Result Image {n}',
                    saved: 'Saved',
                    overwriteSave: 'Overwrite Save',
                    save: 'Save',
                    openInEditor: 'Open in Editor',
                    savePaths: 'Save Paths:',
                    processingImages: 'Processing images...',
                    openFileFailed: 'Failed to open file:',
                    saveFailed: 'Save failed'
                },
                resizeImagePanel: {
                    title: 'Resize Image',
                    cancel: 'Cancel',
                    cancelResize: 'Cancel Resize',
                    status: {
                        needDependency: 'Needs Dependency',
                        cancelled: 'Cancelled',
                        failed: 'Failed',
                        success: 'Success',
                        error: 'Error',
                        processing: 'Processing...',
                        waiting: 'Waiting'
                    },
                    checkingDependency: 'Checking dependency status...',
                    dependencyMessage: 'Resizing requires the sharp library to process images.',
                    batchResize: 'Batch Resize ({count})',
                    resizeTask: 'Resize Task',
                    sizeHint: 'Image will be stretched to fill target dimensions (aspect ratio not preserved)',
                    cancelledMessage: 'User cancelled resize operation',
                    resultTitle: 'Resize Results ({count} images)',
                    resizeResultN: 'Resize Result {n}',
                    dimensions: {
                        original: 'Original:',
                        resized: 'Resized:'
                    },
                    saved: 'Saved',
                    overwriteSave: 'Overwrite Save',
                    save: 'Save',
                    openInEditor: 'Open in Editor',
                    savePaths: 'Save Paths:',
                    resizingImages: 'Resizing images...',
                    openFileFailed: 'Failed to open file:',
                    saveFailed: 'Save failed'
                },
                rotateImagePanel: {
                    title: 'Rotate Image',
                    cancel: 'Cancel',
                    cancelRotate: 'Cancel Rotate',
                    status: {
                        needDependency: 'Needs Dependency',
                        cancelled: 'Cancelled',
                        failed: 'Failed',
                        success: 'Success',
                        error: 'Error',
                        processing: 'Processing...',
                        waiting: 'Waiting'
                    },
                    checkingDependency: 'Checking dependency status...',
                    dependencyMessage: 'Rotation requires the sharp library to process images.',
                    batchRotate: 'Batch Rotate ({count})',
                    rotateTask: 'Rotate Task',
                    angleHint: 'Positive angles rotate counterclockwise, negative angles rotate clockwise. PNG/WebP fills transparent, JPG fills black',
                    angleFormat: {
                        counterclockwise: 'counterclockwise',
                        clockwise: 'clockwise'
                    },
                    cancelledMessage: 'User cancelled rotate operation',
                    resultTitle: 'Rotate Results ({count} images)',
                    rotateResultN: 'Rotate Result {n}',
                    dimensions: {
                        rotation: 'Rotation:',
                        size: 'Size:'
                    },
                    saved: 'Saved',
                    overwriteSave: 'Overwrite Save',
                    save: 'Save',
                    openInEditor: 'Open in Editor',
                    savePaths: 'Save Paths:',
                    rotatingImages: 'Rotating images...',
                    openFileFailed: 'Failed to open file:',
                    saveFailed: 'Save failed'
                }
            }
        }
    },

    app: {
        retryPanel: {
            title: 'Request failed, retrying automatically',
            cancelTooltip: 'Cancel retry',
            defaultError: 'Request failed'
        }
    },

    errors: {
        networkError: 'Network error, please check your connection',
        apiError: 'API request failed',
        timeout: 'Request timeout',
        invalidConfig: 'Invalid configuration',
        fileNotFound: 'File not found',
        permissionDenied: 'Permission denied',
        unknown: 'Unknown error',
        connectionFailed: 'Connection failed',
        authFailed: 'Authentication failed',
        rateLimited: 'Rate limited, please try again later',
        serverError: 'Server error',
        invalidResponse: 'Invalid response format',
        cancelled: 'Operation cancelled'
    },

    composables: {
        useChat: {
            errors: {
                sendFailed: 'Failed to send message',
                retryFailed: 'Retry failed',
                editRetryFailed: 'Edit retry failed',
                deleteFailed: 'Delete failed',
                streamError: 'Stream response error',
                loadHistoryFailed: 'Failed to load history'
            }
        },
        useConversations: {
            defaultTitle: 'Untitled',
            newChatTitle: 'New Chat',
            errors: {
                loadFailed: 'Failed to load conversations',
                createFailed: 'Failed to create conversation',
                deleteFailed: 'Failed to delete conversation',
                updateTitleFailed: 'Failed to update title'
            },
            relativeTime: {
                justNow: 'Just now',
                minutesAgo: '{minutes} minutes ago',
                hoursAgo: '{hours} hours ago',
                daysAgo: '{days} days ago'
            }
        },
        useAttachments: {
            errors: {
                validationFailed: 'Attachment validation failed',
                createThumbnailFailed: 'Failed to create thumbnail',
                createVideoThumbnailFailed: 'Failed to create video thumbnail',
                readFileFailed: 'Failed to read file',
                loadVideoFailed: 'Failed to load video',
                readResultNotString: 'Read result is not a string'
            }
        }
    },

    stores: {
        terminalStore: {
            errors: {
                killTerminalFailed: 'Failed to kill terminal',
                refreshOutputFailed: 'Failed to refresh terminal output'
            }
        },
        chatStore: {
            defaultTitle: 'Untitled',
            errors: {
                loadConversationsFailed: 'Failed to load conversations',
                createConversationFailed: 'Failed to create conversation',
                deleteConversationFailed: 'Failed to delete conversation',
                sendMessageFailed: 'Failed to send message',
                streamError: 'Stream response error',
                loadHistoryFailed: 'Failed to load history',
                retryFailed: 'Retry failed',
                editRetryFailed: 'Edit retry failed',
                deleteFailed: 'Delete failed',
                noConversationSelected: 'No conversation selected',
                unknownError: 'Unknown error',
                restoreFailed: 'Restore failed',
                restoreCheckpointFailed: 'Failed to restore checkpoint',
                restoreRetryFailed: 'Restore and retry failed',
                restoreDeleteFailed: 'Restore and delete failed',
                noConfigSelected: 'No config selected',
                summarizeFailed: 'Summarize failed',
                restoreEditFailed: 'Restore and edit failed'
            },
            relativeTime: {
                justNow: 'Just now',
                minutesAgo: '{minutes}m ago',
                hoursAgo: '{hours}h ago',
                daysAgo: '{days}d ago'
            }
        }
    }
};

export default en;