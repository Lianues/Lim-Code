/**
 * LimCode - i18n 类型定义
 * 按组件目录结构组织翻译
 */

/**
 * 支持的语言
 */
export type SupportedLanguage = 'auto' | 'zh-CN' | 'en' | 'ja';

/**
 * 语言选项
 */
export interface LanguageOption {
    value: SupportedLanguage;
    label: string;
    nativeLabel: string;
}

/**
 * 语言翻译对象
 * 按组件目录结构组织
 */
export interface LanguageMessages {
    /** 通用翻译 */
    common: {
        save: string;
        cancel: string;
        confirm: string;
        delete: string;
        edit: string;
        add: string;
        remove: string;
        enable: string;
        disable: string;
        enabled: string;
        disabled: string;
        loading: string;
        error: string;
        success: string;
        warning: string;
        info: string;
        close: string;
        back: string;
        next: string;
        done: string;
        yes: string;
        no: string;
        ok: string;
        copy: string;
        paste: string;
        reset: string;
        default: string;
        custom: string;
        auto: string;
        manual: string;
        none: string;
        all: string;
        select: string;
        search: string;
        filter: string;
        sort: string;
        refresh: string;
        retry: string;
        settings: string;
        help: string;
        about: string;
        version: string;
        name: string;
        description: string;
        status: string;
        type: string;
        size: string;
        path: string;
        time: string;
        date: string;
        actions: string;
        more: string;
        less: string;
        expand: string;
        collapse: string;
        preview: string;
        download: string;
        upload: string;
        import: string;
        export: string;
        create: string;
        update: string;
        apply: string;
        install: string;
        uninstall: string;
        start: string;
        stop: string;
        pause: string;
        resume: string;
        running: string;
        stopped: string;
        pending: string;
        completed: string;
        failed: string;
        unknown: string;
    };

    /** 组件翻译 - 按目录结构 */
    components: {
        /** announcement 目录 - 版本更新公告 */
        announcement: {
            title: string;
            gotIt: string;
        };
        
        /** attachment 目录 */
        attachment: {
            preview: string;
            download: string;
            close: string;
            downloadFile: string;
            unsupportedPreview: string;
            imageFile: string;
            videoFile: string;
            audioFile: string;
            documentFile: string;
            otherFile: string;
        };

        /** common 目录 */
        common: {
            confirmDialog: {
                title: string;
                message: string;
                confirm: string;
                cancel: string;
            };
            inputDialog: {
                title: string;
                confirm: string;
                cancel: string;
            };
            deleteDialog: {
                title: string;
                message: string;
                messageWithCount: string;
                checkpointHint: string;
                cancel: string;
                delete: string;
                restoreToUserMessage: string;
                restoreToAssistantMessage: string;
                restoreToToolBatch: string;
                restoreToTool: string;
                restoreToAfterUserMessage: string;
                restoreToAfterAssistantMessage: string;
                restoreToAfterToolBatch: string;
                restoreToAfterTool: string;
            };
            editDialog: {
                title: string;
                placeholder: string;
                addAttachment: string;
                checkpointHint: string;
                cancel: string;
                save: string;
                restoreToUserMessage: string;
                restoreToAssistantMessage: string;
                restoreToToolBatch: string;
                restoreToTool: string;
                restoreToAfterUserMessage: string;
                restoreToAfterAssistantMessage: string;
                restoreToAfterToolBatch: string;
                restoreToAfterTool: string;
            };
            retryDialog: {
                title: string;
                message: string;
                checkpointHint: string;
                cancel: string;
                retry: string;
                restoreToUserMessage: string;
                restoreToAssistantMessage: string;
                restoreToToolBatch: string;
                restoreToTool: string;
                restoreToAfterUserMessage: string;
                restoreToAfterAssistantMessage: string;
                restoreToAfterToolBatch: string;
                restoreToAfterTool: string;
            };
            dependencyWarning: {
                title: string;
                defaultMessage: string;
                hint: string;
                linkText: string;
            };
            emptyState: {
                noData: string;
                noResults: string;
            };
            tooltip: {
                copied: string;
                copyFailed: string;
            };
            modal: {
                close: string;
            };
            markdown: {
                copyCode: string;
                wrapEnable: string;
                wrapDisable: string;
                copied: string;
                imageLoadFailed: string;
            };
            markdownRenderer: {
                mermaid: {
                    title: string;
                    copyCode: string;
                    zoomIn: string;
                    zoomOut: string;
                    resetZoom: string;
                    tip: string;
                    closePreview: string;
                };
            };
            scrollToTop: string;
            scrollToBottom: string;
        };

        /** header 目录 */
        header: {
            newChat: string;
            history: string;
            settings: string;
            model: string;
            channel: string;
        };

        /** tabs 目录 - 多对话标签页 */
        tabs: {
            newChat: string;
            newTab: string;
            closeTab: string;
        };

        /** history 目录 */
        history: {
            title: string;
            empty: string;
            deleteConfirm: string;
            searchPlaceholder: string;
            clearSearch: string;
            noSearchResults: string;
            today: string;
            yesterday: string;
            thisWeek: string;
            earlier: string;
            noTitle: string;
            currentWorkspace: string;
            allWorkspaces: string;
            backToChat: string;
            showHistory: string;
            revealInExplorer: string;
            deleteConversation: string;
            messages: string;
        };

        /** home 目录 */
        home: {
            welcome: string;
            welcomeMessage: string;
            welcomeHint: string;
            quickStart: string;
            recentChats: string;
            noRecentChats: string;
            viewAll: string;
        };

        /** message 目录 */
        message: {
            roles: {
                user: string;
                tool: string;
                assistant: string;
            };
            actions: {
                viewRaw: string;
            };
            emptyResponse: string;
            stats: {
                responseDuration: string;
                tokenRate: string;
            };
            thought: {
                thinking: string;
                thoughtProcess: string;
            };
            contextBlocks: {
                clickToView: string;
            };
            summary: {
                title: string;
                compressed: string;
                deleteTitle: string;
                autoTriggered: string;
            };
            checkpoint: {
                userMessageBefore: string;
                userMessageAfter: string;
                assistantMessageBefore: string;
                assistantMessageAfter: string;
                toolBatchBefore: string;
                toolBatchAfter: string;
                userMessageUnchanged: string;
                assistantMessageUnchanged: string;
                toolBatchUnchanged: string;
                toolExecutionUnchanged: string;
                restoreTooltip: string;
                fileCount: string;
                yesterday: string;
                daysAgo: string;
                restoreConfirmTitle: string;
                restoreConfirmMessage: string;
                restoreConfirmBtn: string;
            };
            continue: {
                title: string;
                description: string;
                button: string;
            };
            error: {
                title: string;
                retry: string;
                dismiss: string;
            };
            tool: {
                parameters: string;
                result: string;
                error: string;
                paramCount: string;
                streamingArgs: string;
                confirmExecution: string;
                confirm: string;
                saveAll: string;
                rejectAll: string;
                reject: string;
                confirmed: string;
                rejected: string;
                viewDiff: string;
                viewDiffInVSCode: string;
                openDiffFailed: string;
                todoWrite: {
                    label: string;
                    labelWithCount: string;
                    mergePrefix: string;
                    description: string;
                };
                todoUpdate: {
                    label: string;
                    labelWithCount: string;
                    description: string;
                };
                createPlan: {
                    label: string;
                    fallbackTitle: string;
                };
                todoPanel: {
                    title: string;
                    modePlan: string;
                    modeUpdate: string;
                    modeMerge: string;
                    sourceCurrentInput: string;
                    sourceSnapshot: string;
                    statusPending: string;
                    statusInProgress: string;
                    statusCompleted: string;
                    statusCancelled: string;
                    totalItems: string;
                    copyAsMarkdown: string;
                    copyMarkdown: string;
                    copied: string;
                    empty: string;
                    markdownCancelledSuffix: string;
                    markdownInProgressSuffix: string;
                    copyFailed: string;
                };
                planCard: {
                    title: string;
                    executeLabel: string;
                    executed: string;
                    executing: string;
                    executePlan: string;
                    loadChannelsFailed: string;
                    loadModelsFailed: string;
                    executePlanFailed: string;
                    promptPrefix: string;
                };
            };
            attachment: {
                clickToPreview: string;
                removeAttachment: string;
            };
        };
        
        /** input 目录 */
        input: {
            placeholder: string;
            placeholderHint: string;
            send: string;
            stopGenerating: string;
            attachFile: string;
            pinnedFiles: string;
            skills: string;
            summarizeContext: string;
            selectChannel: string;
            selectModel: string;
            clickToPreview: string;
            remove: string;
            tokenUsage: string;
            context: string;
            fileNotExists: string;
            queue: {
                title: string;
                sendNow: string;
                remove: string;
                queued: string;
                drag: string;
                edit: string;
            };
            mode: {
                selectMode: string;
                manageMode: string;
                search: string;
                noResults: string;
            };
            channelSelector: {
                placeholder: string;
                searchPlaceholder: string;
                noMatch: string;
            };
            modelSelector: {
                placeholder: string;
                searchPlaceholder: string;
                noMatch: string;
                addInSettings: string;
            };
            pinnedFilesPanel: {
                title: string;
                description: string;
                loading: string;
                empty: string;
                notExists: string;
                dragHint: string;
                dropHint: string;
            };
            skillsPanel: {
                title: string;
                description: string;
                loading: string;
                empty: string;
                notExists: string;
                enableTooltip: string;
                sendContentTooltip: string;
                hint: string;
                openDirectory: string;
                refresh: string;
            };
            promptContext: {
                title: string;
                description: string;
                empty: string;
                emptyHint: string;
                addText: string;
                addFile: string;
                titlePlaceholder: string;
                contentPlaceholder: string;
                typeFile: string;
                typeText: string;
                typeSnippet: string;
                hint: string;
                dropHint: string;
                fileAdded: string;
                readFailed: string;
                addFailed: string;
            };
            filePicker: {
                title: string;
                subtitle: string;
                loading: string;
                empty: string;
                navigate: string;
                select: string;
                close: string;
                ctrlClickHint: string;
            };
            notifications: {
                summarizeFailed: string;
                summarizeSuccess: string;
                summarizeError: string;
                holdShiftToDrag: string;
                fileNotInWorkspace: string;
                fileNotInAnyWorkspace: string;
                fileInOtherWorkspace: string;
                fileAdded: string;
                addFailed: string;
                cannotGetFilePath: string;
                fileNotMatchOrNotInWorkspace: string;
                removeFailed: string;
            };
        };

        /** settings 目录 */
        settings: {
            title: string;
            tabs: {
                channel: string;
                tools: string;
                autoExec: string;
                mcp: string;
                subagents: string;
                checkpoint: string;
                summarize: string;
                imageGen: string;
                dependencies: string;
                context: string;
                prompt: string;
                tokenCount: string;
                appearance: string;
                general: string;
            };
            
            /** 工具设置页面 - settings/tools 目录 */
            toolSettings: {
                /** 文件工具设置 */
                files: {
                    applyDiff: {
                        autoApply: string;
                        enableAutoApply: string;
                        enableAutoApplyDesc: string;
                        autoSaveDelay: string;
                        delayTime: string;
                        delayTimeDesc: string;
                        delay1s: string;
                        delay2s: string;
                        delay3s: string;
                        delay5s: string;
                        delay10s: string;
                        infoEnabled: string;
                        infoDisabled: string;

                        format: string;
                        formatDesc: string;
                        formatUnified: string;
                        formatSearchReplace: string;

                        skipDiffView: string;
                        enableSkipDiffView: string;
                        enableSkipDiffViewDesc: string;

                        diffGuard: string;
                        enableDiffGuard: string;
                        enableDiffGuardDesc: string;
                        diffGuardThreshold: string;
                        diffGuardThresholdDesc: string;
                        diffGuardWarning: string;
                    };
                    listFiles: {
                        ignoreList: string;
                        ignoreListHint: string;
                        inputPlaceholder: string;
                        deleteTooltip: string;
                        addButton: string;
                    };
                };
                
                /** 搜索工具设置 */
                search: {
                    findFiles: {
                        excludeList: string;
                        excludeListHint: string;
                        inputPlaceholder: string;
                        deleteTooltip: string;
                        addButton: string;
                    };
                    searchInFiles: {
                        excludeList: string;
                        excludeListHint: string;
                        inputPlaceholder: string;
                        deleteTooltip: string;
                        addButton: string;
                    };
                };
                
                /** 历史工具设置 */
                history: {
                    searchSection: string;
                    maxSearchMatches: string;
                    maxSearchMatchesDesc: string;
                    searchContextLines: string;
                    searchContextLinesDesc: string;
                    readSection: string;
                    maxReadLines: string;
                    maxReadLinesDesc: string;
                    outputSection: string;
                    maxResultChars: string;
                    maxResultCharsDesc: string;
                    lineDisplayLimit: string;
                    lineDisplayLimitDesc: string;
                };

                /** 终端工具设置 */
                terminal: {
                    executeCommand: {
                        shellEnv: string;
                        defaultBadge: string;
                        available: string;
                        unavailable: string;
                        setDefaultTooltip: string;
                        executablePath: string;
                        executablePathPlaceholder: string;
                        execTimeout: string;
                        timeoutHint: string;
                        timeout30s: string;
                        timeout1m: string;
                        timeout2m: string;
                        timeout5m: string;
                        timeout10m: string;
                        timeoutUnlimited: string;
                        maxOutputLines: string;
                        maxOutputLinesHint: string;
                        unlimitedLines: string;
                        tips: {
                            onlyEnabledUsed: string;
                            statusMeaning: string;
                            windowsRecommend: string;
                            gitBashRequire: string;
                            wslRequire: string;
                            confirmSettings: string;
                        };
                    };
                };
                
                /** 媒体工具设置 */
                media: {
                    common: {
                        returnImageToAI: string;
                        returnImageDesc: string;
                        returnImageDescDetail: string;
                    };
                    cropImage: {
                        title: string;
                        description: string;
                    };
                    generateImage: {
                        title: string;
                        description: string;
                    };
                    removeBackground: {
                        title: string;
                        description: string;
                    };
                    resizeImage: {
                        title: string;
                        description: string;
                    };
                    rotateImage: {
                        title: string;
                        description: string;
                    };
                };
                
                /** 通用 */
                common: {
                    loading: string;
                    loadingConfig: string;
                    saving: string;
                    error: string;
                    retry: string;
                };
            };
            channelSettings: {
                selector: {
                    placeholder: string;
                    rename: string;
                    add: string;
                    delete: string;
                    inputPlaceholder: string;
                    confirm: string;
                    cancel: string;
                };
                dialog: {
                    new: {
                        title: string;
                        nameLabel: string;
                        namePlaceholder: string;
                        typeLabel: string;
                        typePlaceholder: string;
                        cancel: string;
                        create: string;
                    };
                    delete: {
                        title: string;
                        message: string;
                        atLeastOne: string;
                        cancel: string;
                        confirm: string;
                    };
                };
                form: {
                    apiUrl: {
                        label: string;
                        placeholder: string;
                        placeholderResponses: string;
                    };
                    apiKey: {
                        label: string;
                        placeholder: string;
                        show: string;
                        hide: string;
                        useAuthorization: string;
                        useAuthorizationHintGemini: string;
                        useAuthorizationHintAnthropic: string;
                    };
                    stream: {
                        label: string;
                    };
                    channelType: {
                        label: string;
                        gemini: string;
                        openai: string;
                        'openai-responses': string;
                        anthropic: string;
                    };
                    toolMode: {
                        label: string;
                        placeholder: string;
                        functionCall: {
                            label: string;
                            description: string;
                        };
                        xml: {
                            label: string;
                            description: string;
                        };
                        json: {
                            label: string;
                            description: string;
                        };
                        hint: {
                            functionCall: string;
                            xml: string;
                            json: string;
                        };
                        openaiWarning: string;
                    };
                    multimodal: {
                        label: string;
                        supportedTypes: string;
                        image: string;
                        imageFormats: string;
                        document: string;
                        documentFormats: string;
                        capabilities: string;
                        table: {
                            channel: string;
                            readImage: string;
                            readDocument: string;
                            generateImage: string;
                            historyMultimodal: string;
                        };
                        channels: {
                            geminiAll: string;
                            anthropicAll: string;
                            openaiXmlJson: string;
                            openaiResponses: string;
                            openaiFunction: string;
                        };
                        legend: {
                            supported: string;
                            notSupported: string;
                        };
                        notes: {
                            requireEnable: string;
                            userAttachment: string;
                            geminiAnthropic: string;
                            openaiResponses: string;
                            openaiXmlJson: string;
                        };
                    };
                    timeout: {
                        label: string;
                        placeholder: string;
                    };
                    maxContextTokens: {
                        label: string;
                        placeholder: string;
                        hint: string;
                    };
                    contextManagement: {
                        title: string;
                        enableTitle: string;
                        threshold: {
                            label: string;
                            placeholder: string;
                            hint: string;
                        };
                        extraCut: {
                            label: string;
                            placeholder: string;
                            hint: string;
                        };
                        autoSummarize: {
                            label: string;
                            enableTitle: string;
                            hint: string;
                        };
                        mode: {
                            label: string;
                            hint: string;
                            trim: string;
                            summarize: string;
                        };
                    };
                    toolOptions: {
                        title: string;
                    };
                    advancedOptions: {
                        title: string;
                    };
                    customBody: {
                        title: string;
                        enableTitle: string;
                    };
                    customHeaders: {
                        title: string;
                        enableTitle: string;
                    };
                    autoRetry: {
                        title: string;
                        enableTitle: string;
                        retryCount: {
                            label: string;
                            hint: string;
                        };
                        retryInterval: {
                            label: string;
                            hint: string;
                        };
                    };
                    enabled: {
                        label: string;
                    };
                };
            };
            tools: {
                title: string;
                description: string;
                enableAll: string;
                disableAll: string;
                toolName: string;
                toolDescription: string;
                toolEnabled: string;
            };
            autoExec: {
                title: string;
                intro: {
                    title: string;
                    description: string;
                };
                actions: {
                    refresh: string;
                    enableAll: string;
                    disableAll: string;
                };
                status: {
                    loading: string;
                    empty: string;
                    autoExecute: string;
                    needConfirm: string;
                };
                categories: {
                    file: string;
                    search: string;
                    terminal: string;
                    lsp: string;
                    media: string;
                    plan: string;
                    mcp: string;
                    other: string;
                };
                badges: {
                    dangerous: string;
                };
                tips: {
                    dangerousDefault: string;
                    deleteFileWarning: string;
                    executeCommandWarning: string;
                    mcpToolsDefault: string;
                    useWithCheckpoint: string;
                };
            };
            mcp: {
                title: string;
                description: string;
                addServer: string;
                serverName: string;
                serverCommand: string;
                serverArgs: string;
                serverEnv: string;
                serverStatus: string;
                connecting: string;
                connected: string;
                disconnected: string;
                error: string;
            };
            checkpoint: {
                title: string;
                loading: string;
                sections: {
                    enable: {
                        label: string;
                        description: string;
                    };
                    messages: {
                        title: string;
                        description: string;
                        beforeLabel: string;
                        afterLabel: string;
                        types: {
                            user: {
                                name: string;
                                description: string;
                            };
                            model: {
                                name: string;
                                description: string;
                            };
                        };
                        options: {
                            modelOuterLayerOnly: {
                                label: string;
                                hint: string;
                            };
                            mergeUnchanged: {
                                label: string;
                                hint: string;
                            };
                        };
                    };
                    tools: {
                        title: string;
                        description: string;
                        beforeLabel: string;
                        afterLabel: string;
                        empty: string;
                    };
                    other: {
                        title: string;
                        maxCheckpoints: {
                            label: string;
                            placeholder: string;
                            hint: string;
                        };
                    };
                    cleanup: {
                        title: string;
                        description: string;
                        searchPlaceholder: string;
                        loading: string;
                        noMatch: string;
                        noCheckpoints: string;
                        refresh: string;
                        checkpointCount: string;
                        confirmDelete: {
                            title: string;
                            message: string;
                            stats: string;
                            warning: string;
                            cancel: string;
                            delete: string;
                        };
                        timeFormat: {
                            justNow: string;
                            minutesAgo: string;
                            hoursAgo: string;
                            daysAgo: string;
                        };
                    };
                };
            };
            summarize: {
                title: string;
                description: string;
                enableSummarize: string;
                tokenThreshold: string;
                summaryModel: string;
                summaryPrompt: string;
            };
            imageGen: {
                title: string;
                description: string;
                enableImageGen: string;
                provider: string;
                model: string;
                outputPath: string;
                maxImages: string;
            };
            dependencies: {
                title: string;
                description: string;
                installed: string;
                notInstalled: string;
                installing: string;
                installFailed: string;
                install: string;
                uninstall: string;
                required: string;
                optional: string;
            };
            context: {
                title: string;
                description: string;
                includeFileTree: string;
                includeOpenFiles: string;
                includeSelection: string;
                maxDepth: string;
                excludePatterns: string;
                pinnedFiles: string;
                addPinnedFile: string;
            };
            prompt: {
                title: string;
                description: string;
                systemPrompt: string;
                customPrompt: string;
                templateVariables: string;
                preview: string;
                sections: {
                    environment: string;
                    tools: string;
                    context: string;
                    instructions: string;
                };
            };
            general: {
                title: string;
                description: string;
                proxy: {
                    title: string;
                    description: string;
                    enable: string;
                    url: string;
                    urlPlaceholder: string;
                    urlError: string;
                };
                language: {
                    title: string;
                    description: string;
                    auto: string;
                    autoDescription: string;
                };
                appInfo: {
                    title: string;
                    name: string;
                    version: string;
                    repository: string;
                    developer: string;
                };
            };
            contextSettings: {
                loading: string;
                workspaceFiles: {
                    title: string;
                    description: string;
                    sendFileTree: string;
                    maxDepth: string;
                    unlimitedHint: string;
                };
                openTabs: {
                    title: string;
                    description: string;
                    sendOpenTabs: string;
                    maxCount: string;
                };
                activeEditor: {
                    title: string;
                    description: string;
                    sendActiveEditor: string;
                };
                diagnostics: {
                    title: string;
                    description: string;
                    enableDiagnostics: string;
                    severityTypes: string;
                    severity: {
                        error: string;
                        warning: string;
                        information: string;
                        hint: string;
                    };
                    workspaceOnly: string;
                    openFilesOnly: string;
                    maxPerFile: string;
                    maxFiles: string;
                };
                ignorePatterns: {
                    title: string;
                    description: string;
                    removeTooltip: string;
                    emptyHint: string;
                    inputPlaceholder: string;
                    addButton: string;
                    helpTitle: string;
                    helpItems: {
                        wildcard: string;
                        recursive: string;
                        examples: string;
                    };
                };
                preview: {
                    title: string;
                    autoRefreshBadge: string;
                    description: string;
                    activeEditorLabel: string;
                    openTabsLabel: string;
                    noValue: string;
                    moreItems: string;
                };
                saveSuccess: string;
                saveFailed: string;
            };
            dependencySettings: {
                title: string;
                description: string;
                installPath: string;
                installed: string;
                installing: string;
                uninstalling: string;
                install: string;
                uninstall: string;
                estimatedSize: string;
                empty: string;
                progress: {
                    processing: string;
                    complete: string;
                    failed: string;
                    installSuccess: string;
                    installFailed: string;
                    uninstallSuccess: string;
                    uninstallFailed: string;
                    unknownError: string;
                };
                panel: {
                    installedCount: string;
                };
            };
            generateImageSettings: {
                description: string;
                api: {
                    title: string;
                    url: string;
                    urlPlaceholder: string;
                    urlHint: string;
                    apiKey: string;
                    apiKeyPlaceholder: string;
                    apiKeyHint: string;
                    model: string;
                    modelPlaceholder: string;
                    modelHint: string;
                    show: string;
                    hide: string;
                };
                aspectRatio: {
                    title: string;
                    enable: string;
                    fixedRatio: string;
                    placeholder: string;
                    options: {
                        auto: string;
                        square: string;
                        landscape: string;
                        portrait: string;
                        mobilePortrait: string;
                        widescreen: string;
                        ultrawide: string;
                    };
                    hints: {
                        disabled: string;
                        fixed: string;
                        flexible: string;
                    };
                };
                imageSize: {
                    title: string;
                    enable: string;
                    fixedSize: string;
                    placeholder: string;
                    options: {
                        auto: string;
                    };
                    hints: {
                        disabled: string;
                        fixed: string;
                        flexible: string;
                    };
                };
                batch: {
                    title: string;
                    maxTasks: string;
                    maxTasksHint: string;
                    maxImagesPerTask: string;
                    maxImagesPerTaskHint: string;
                    summary: string;
                };
                usage: {
                    title: string;
                    step1: string;
                    step2: string;
                    step3: string;
                    step4: string;
                    warning: string;
                };
            };
            mcpSettings: {
                toolbar: {
                    addServer: string;
                    editJson: string;
                    refresh: string;
                };
                loading: string;
                empty: {
                    title: string;
                    description: string;
                };
                serverCard: {
                    connect: string;
                    disconnect: string;
                    connecting: string;
                    edit: string;
                    delete: string;
                    tools: string;
                    resources: string;
                    prompts: string;
                };
                status: {
                    connected: string;
                    connecting: string;
                    error: string;
                    disconnected: string;
                };
                form: {
                    addTitle: string;
                    editTitle: string;
                    serverId: string;
                    serverIdPlaceholder: string;
                    serverIdHint: string;
                    serverIdError: string;
                    serverName: string;
                    serverNamePlaceholder: string;
                    description: string;
                    descriptionPlaceholder: string;
                    required: string;
                    transportType: string;
                    command: string;
                    commandPlaceholder: string;
                    args: string;
                    argsPlaceholder: string;
                    env: string;
                    envPlaceholder: string;
                    url: string;
                    urlPlaceholderSse: string;
                    urlPlaceholderHttp: string;
                    headers: string;
                    headersPlaceholder: string;
                    options: string;
                    enabled: string;
                    autoConnect: string;
                    cleanSchema: string;
                    cleanSchemaHint: string;
                    timeout: string;
                    cancel: string;
                    create: string;
                    save: string;
                };
                validation: {
                    nameRequired: string;
                    idInvalid: string;
                    idChecking: string;
                    commandRequired: string;
                    urlRequired: string;
                    createFailed: string;
                    updateFailed: string;
                };
                delete: {
                    title: string;
                    message: string;
                    confirm: string;
                    cancel: string;
                };
            };
            subagents: {
                selectAgent: string;
                noAgents: string;
                create: string;
                rename: string;
                delete: string;
                disabled: string;
                enabled: string;
                globalConfig: string;
                maxConcurrentAgents: string;
                maxConcurrentAgentsHint: string;
                basicInfo: string;
                description: string;
                descriptionPlaceholder: string;
                maxIterations: string;
                maxIterationsHint: string;
                maxRuntime: string;
                maxRuntimeHint: string;
                systemPrompt: string;
                systemPromptPlaceholder: string;
                channelModel: string;
                channel: string;
                selectChannel: string;
                model: string;
                selectModel: string;
                tools: string;
                toolsDescription: string;
                toolMode: {
                    label: string;
                    all: string;
                    builtin: string;
                    mcp: string;
                    whitelist: string;
                    blacklist: string;
                };
                builtinTools: string;
                mcpTools: string;
                noTools: string;
                whitelistHint: string;
                blacklistHint: string;
                emptyState: string;
                createFirst: string;
                deleteConfirm: {
                    title: string;
                    message: string;
                };
                createDialog: {
                    title: string;
                    nameLabel: string;
                    namePlaceholder: string;
                    nameRequired: string;
                    nameDuplicate: string;
                };
            };
            modelManager: {
                title: string;
                fetchModels: string;
                clearAll: string;
                clearAllTooltip: string;
                empty: string;
                addPlaceholder: string;
                addTooltip: string;
                removeTooltip: string;
                enabledTooltip: string;
                filterPlaceholder: string;
                clearFilter: string;
                noResults: string;
                clearDialog: {
                    title: string;
                    message: string;
                    confirm: string;
                    cancel: string;
                };
                errors: {
                    addFailed: string;
                    removeFailed: string;
                    setActiveFailed: string;
                };
            };
            modelSelectionDialog: {
                title: string;
                selectAll: string;
                deselectAll: string;
                close: string;
                loading: string;
                error: string;
                retry: string;
                empty: string;
                added: string;
                selectionCount: string;
                cancel: string;
                add: string;
                filterPlaceholder: string;
                clearFilter: string;
                noResults: string;
            };
            promptSettings: {
                loading: string;
                enable: string;
                enableDescription: string;
                modes: {
                    label: string;
                    add: string;
                    rename: string;
                    delete: string;
                    confirmDelete: string;
                    cannotDeleteDefault: string;
                    unsavedChanges: string;
                    newModeName: string;
                    newModeDefault: string;
                    renameModePrompt: string;
                };
                templateSection: {
                    title: string;
                    resetButton: string;
                    description: string;
                    placeholder: string;
                };
                staticSection: {
                    title: string;
                    description: string;
                    placeholder: string;
                };
                dynamicSection: {
                    title: string;
                    description: string;
                    placeholder: string;
                    enableTooltip: string;
                    disabledNotice: string;
                };
                toolPolicy: {
                    title: string;
                    description: string;
                    inherit: string;
                    custom: string;
                    inheritHint: string;
                    searchPlaceholder: string;
                    selectAll: string;
                    clear: string;
                    loadingTools: string;
                    noTools: string;
                    disabledBadge: string;
                    emptyWarning: string;
                    emptyCannotSave: string;
                };
                saveButton: string;
                saveSuccess: string;
                saveFailed: string;
                tokenCount: {
                    label: string;
                    staticLabel: string;
                    dynamicLabel: string;
                    staticTooltip: string;
                    dynamicTooltip: string;
                    channelTooltip: string;
                    refreshTooltip: string;
                    failed: string;
                    hint: string;
                };
                modulesReference: {
                    title: string;
                    insertTooltip: string;
                };
                staticModules: {
                    title: string;
                    badge: string;
                    description: string;
                };
                dynamicModules: {
                    title: string;
                    badge: string;
                    description: string;
                };
                modules: {
                    ENVIRONMENT: {
                        name: string;
                        description: string;
                    };
                    WORKSPACE_FILES: {
                        name: string;
                        description: string;
                        requiresConfig: string;
                    };
                    OPEN_TABS: {
                        name: string;
                        description: string;
                        requiresConfig: string;
                    };
                    ACTIVE_EDITOR: {
                        name: string;
                        description: string;
                        requiresConfig: string;
                    };
                    DIAGNOSTICS: {
                        name: string;
                        description: string;
                        requiresConfig: string;
                    };
                    PINNED_FILES: {
                        name: string;
                        description: string;
                        requiresConfig: string;
                    };
                    SKILLS: {
                        name: string;
                        description: string;
                        requiresConfig: string;
                    };
                    TOOLS: {
                        name: string;
                        description: string;
                    };
                    MCP_TOOLS: {
                        name: string;
                        description: string;
                        requiresConfig: string;
                    };
                };
                exampleOutput: string;
                requiresConfigLabel: string;
            };
            summarizeSettings: {
                description: string;
                manualSection: {
                    title: string;
                    description: string;
                };
                autoSection: {
                    title: string;
                    comingSoon: string;
                    enable: string;
                    enableHint: string;
                    threshold: string;
                    thresholdUnit: string;
                    thresholdHint: string;
                };
                optionsSection: {
                    title: string;
                    keepRounds: string;
                    keepRoundsUnit: string;
                    keepRoundsHint: string;
                    manualPrompt: string;
                    manualPromptPlaceholder: string;
                    manualPromptHint: string;
                    autoPrompt: string;
                    autoPromptPlaceholder: string;
                    autoPromptHint: string;
                    restoreBuiltin: string;
                };
                modelSection: {
                    title: string;
                    useSeparate: string;
                    useSeparateHint: string;
                    currentModelHint: string;
                    selectChannel: string;
                    selectChannelPlaceholder: string;
                    selectChannelHint: string;
                    selectModel: string;
                    selectModelPlaceholder: string;
                    selectModelHint: string;
                    warningHint: string;
                };
            };
            settingsPanel: {
                title: string;
                backToChat: string;
                sections: {
                    channel: {
                        title: string;
                        description: string;
                    };
                    tools: {
                        title: string;
                        description: string;
                    };
                    autoExec: {
                        title: string;
                        description: string;
                    };
                    mcp: {
                        title: string;
                        description: string;
                    };
                    checkpoint: {
                        title: string;
                        description: string;
                    };
                    summarize: {
                        title: string;
                        description: string;
                    };
                    imageGen: {
                        title: string;
                        description: string;
                    };
                    context: {
                        title: string;
                        description: string;
                    };
                    prompt: {
                        title: string;
                        description: string;
                    };
                    tokenCount: {
                        title: string;
                        description: string;
                    };
                    subagents: {
                        title: string;
                        description: string;
                    };
                    appearance: {
                        title: string;
                        description: string;
                    };
                    general: {
                        title: string;
                        description: string;
                    };
                };
                proxy: {
                    title: string;
                    description: string;
                    enable: string;
                    url: string;
                    urlPlaceholder: string;
                    urlError: string;
                    save: string;
                    saveSuccess: string;
                    saveFailed: string;
                };
                language: {
                    title: string;
                    description: string;
                    placeholder: string;
                    autoDescription: string;
                };
                appInfo: {
                    title: string;
                    name: string;
                    version: string;
                    repository: string;
                    developer: string;
                };
            };
            toolsSettings: {
                maxIterations: {
                    label: string;
                    hint: string;
                    unit: string;
                };
                actions: {
                    refresh: string;
                    enableAll: string;
                    disableAll: string;
                };
                loading: string;
                empty: string;
                categories: {
                    file: string;
                    search: string;
                    terminal: string;
                    lsp: string;
                    todo: string;
                    media: string;
                    plan: string;
                    history: string;
                    other: string;
                };
                dependency: {
                    required: string;
                    requiredTooltip: string;
                    disabledTooltip: string;
                };
                config: {
                    tooltip: string;
                };
            };
            tokenCountSettings: {
                description: string;
                hint: string;
                enableChannel: string;
                baseUrl: string;
                apiKey: string;
                apiKeyPlaceholder: string;
                model: string;
                geminiUrlPlaceholder: string;
                geminiUrlHint: string;
                geminiModelPlaceholder: string;
                anthropicUrlPlaceholder: string;
                anthropicModelPlaceholder: string;
                comingSoon: string;
                customApi: string;
                openaiDocTitle: string;
                openaiDocDesc: string;
                openaiUrlPlaceholder: string;
                openaiUrlHint: string;
                openaiModelPlaceholder: string;
                apiDocumentation: string;
                requestExample: string;
                requestBody: string;
                responseFormat: string;
                openaiDocNote: string;
                saveSuccess: string;
                saveFailed: string;
            };
            appearanceSettings: {
                loadingText: {
                    title: string;
                    description: string;
                    placeholder: string;
                    defaultHint: string;
                };
                saveSuccess: string;
                saveFailed: string;
            };
            storageSettings: {
                title: string;
                description: string;
                currentPath: string;
                customPath: string;
                customPathPlaceholder: string;
                customPathHint: string;
                browse: string;
                apply: string;
                reset: string;
                migrate: string;
                migrateHint: string;
                migrating: string;
                validating: string;
                validation: {
                    valid: string;
                    invalid: string;
                    checking: string;
                };
                dialog: {
                    migrateTitle: string;
                    migrateMessage: string;
                    migrateWarning: string;
                    confirm: string;
                    cancel: string;
                };
                notifications: {
                    pathUpdated: string;
                    pathReset: string;
                    migrationSuccess: string;
                    migrationFailed: string;
                    validationFailed: string;
                };
                reloadWindow: string;
            };
        };

        /** channels 目录 - 渠道配置选项 */
        channels: {
            /** 通用选项 */
            common: {
                temperature: {
                    label: string;
                    hint: string;
                    toggleHint: string;
                };
                maxTokens: {
                    label: string;
                    placeholder: string;
                    toggleHint: string;
                };
                topP: {
                    label: string;
                    hint: string;
                    toggleHint: string;
                };
                topK: {
                    label: string;
                    toggleHint: string;
                };
                thinking: {
                    title: string;
                    toggleHint: string;
                };
                currentThinking: {
                    title: string;
                    sendSignatures: string;
                    sendSignaturesHint: string;
                    sendContent: string;
                    sendContentHint: string;
                };
                historyThinking: {
                    title: string;
                    sendSignatures: string;
                    sendSignaturesHint: string;
                    sendContent: string;
                    sendContentHint: string;
                    roundsLabel: string;
                    roundsHint: string;
                };
            };
            
            /** Anthropic 专属 */
            anthropic: {
                thinking: {
                    typeLabel: string;
                    typeAdaptive: string;
                    typeEnabled: string;
                    typeAdaptiveHint: string;
                    typeEnabledHint: string;
                    budgetLabel: string;
                    budgetPlaceholder: string;
                    budgetHint: string;
                    effortLabel: string;
                    effortMax: string;
                    effortHigh: string;
                    effortMedium: string;
                    effortLow: string;
                    effortHint: string;
                };
            };
            
            /** Gemini 专属 */
            gemini: {
                thinking: {
                    includeThoughts: string;
                    includeThoughtsHint: string;
                    mode: string;
                    modeHint: string;
                    modeDefault: string;
                    modeLevel: string;
                    modeBudget: string;
                    levelLabel: string;
                    levelHint: string;
                    levelMinimal: string;
                    levelLow: string;
                    levelMedium: string;
                    levelHigh: string;
                    budgetLabel: string;
                    budgetPlaceholder: string;
                    budgetHint: string;
                };
                historyThinking: {
                    sendContentHint: string;
                };
            };
            
            /** OpenAI 专属 */
            openai: {
                frequencyPenalty: {
                    label: string;
                    hint: string;
                    toggleHint: string;
                };
                presencePenalty: {
                    label: string;
                    hint: string;
                    toggleHint: string;
                };
                thinking: {
                    effortLabel: string;
                    effortHint: string;
                    effortNone: string;
                    effortMinimal: string;
                    effortLow: string;
                    effortMedium: string;
                    effortHigh: string;
                    effortXHigh: string;
                    summaryLabel: string;
                    summaryHint: string;
                    summaryAuto: string;
                    summaryConcise: string;
                    summaryDetailed: string;
                };
                historyThinking: {
                    sendSignaturesHint: string;
                    sendContentHint: string;
                };
            };
            
            /** OpenAI Responses 专属 */
            'openai-responses': {
                maxOutputTokens: {
                    label: string;
                    placeholder: string;
                    hint: string;
                };
                thinking: {
                    effortLabel: string;
                    effortHint: string;
                    effortNone: string;
                    effortMinimal: string;
                    effortLow: string;
                    effortMedium: string;
                    effortHigh: string;
                    effortXHigh: string;
                    summaryLabel: string;
                    summaryHint: string;
                    summaryAuto: string;
                    summaryConcise: string;
                    summaryDetailed: string;
                };
                historyThinking: {
                    sendSignaturesHint?: string;
                    sendContentHint: string;
                };
            };
            
            /** 自定义请求体 */
            customBody: {
                hint: string;
                modeSimple: string;
                modeAdvanced: string;
                keyPlaceholder: string;
                valuePlaceholder: string;
                empty: string;
                addItem: string;
                jsonError: string;
                jsonHint: string;
                jsonPlaceholder: string;
                enabled: string;
                disabled: string;
                deleteTooltip: string;
            };
            
            /** 自定义请求头 */
            customHeaders: {
                hint: string;
                keyPlaceholder: string;
                valuePlaceholder: string;
                keyDuplicate: string;
                empty: string;
                addHeader: string;
                enabled: string;
                disabled: string;
                deleteTooltip: string;
            };
            
            /** 工具选项 */
            toolOptions: {
                cropImage: {
                    title: string;
                    useNormalizedCoords: string;
                    enabledTitle: string;
                    enabledNote: string;
                    disabledTitle: string;
                    disabledNote: string;
                    coordTopLeft: string;
                    coordBottomRight: string;
                    coordCenter: string;
                };
            };
            
            /** Token 计数方式 */
            tokenCountMethod: {
                title: string;
                label: string;
                placeholder: string;
                hint: string;
                options: {
                    channelDefault: string;
                    gemini: string;
                    openaiCustom: string;
                    openaiCustomDesc: string;
                    openaiResponses: string;
                    anthropic: string;
                    local: string;
                    localDesc: string;
                };
                defaultDesc: {
                    gemini: string;
                    anthropic: string;
                    openai: string;
                };
                apiConfig: {
                    title: string;
                    url: string;
                    urlHint: string;
                    apiKey: string;
                    apiKeyPlaceholder: string;
                    apiKeyHint: string;
                    model: string;
                    modelHint: string;
                };
            };
        };

        /** tools 目录 - 工具执行状态显示 */
        tools: {
            executing: string;
            executed: string;
            failed: string;
            cancelled: string;
            approve: string;
            reject: string;
            autoExecuted: string;
            terminate: string;
            saveToPath: string;
            openFile: string;
            openFolder: string;
            viewDetails: string;
            hideDetails: string;
            parameters: string;
            result: string;
            error: string;
            duration: string;
            /** 文件工具 */
            file: {
                readFile: string;
                writeFile: string;
                deleteFile: string;
                createDirectory: string;
                listFiles: string;
                applyDiff: string;
                filesRead: string;
                filesWritten: string;
                filesDeleted: string;
                directoriesCreated: string;
                changesApplied: string;
                /** apply_diff 内容面板 */
                applyDiffPanel: {
                    title: string;
                    changes: string;
                    diffApplied: string;
                    pending: string;
                    accepted: string;
                    rejected: string;
                    line: string;
                    diffNumber: string;
                    collapse: string;
                    expandRemaining: string;
                    copied: string;
                    copyNew: string;
                    deletedLines: string;
                    addedLines: string;
                    userEdited: string;
                    userEditedContent: string;
                };
                /** create_directory 内容面板 */
                createDirectoryPanel: {
                    title: string;
                    total: string;
                    noDirectories: string;
                    success: string;
                    failed: string;
                };
                /** delete_file 内容面板 */
                deleteFilePanel: {
                    title: string;
                    total: string;
                    noFiles: string;
                    success: string;
                    failed: string;
                };
                /** list_files 内容面板 */
                listFilesPanel: {
                    title: string;
                    recursive: string;
                    totalStat: string;
                    copyAll: string;
                    copyList: string;
                    dirStat: string;
                    collapse: string;
                    expandRemaining: string;
                    emptyDirectory: string;
                };
                /** read_file 内容面板 */
                readFilePanel: {
                    title: string;
                    total: string;
                    lines: string;
                    copied: string;
                    copyContent: string;
                    binaryFile: string;
                    unknownSize: string;
                    collapse: string;
                    expandRemaining: string;
                    emptyFile: string;
                };
                /** write_file 内容面板 */
                writeFilePanel: {
                    title: string;
                    total: string;
                    lines: string;
                    copied: string;
                    copyContent: string;
                    collapse: string;
                    expandRemaining: string;
                    noContent: string;
                    viewContent: string;
                    viewDiff: string;
                    loadingDiff: string;
                    actions: {
                        created: string;
                        modified: string;
                        unchanged: string;
                        write: string;
                    };
                };
            };
            /** 搜索工具 */
            search: {
                findFiles: string;
                searchInFiles: string;
                filesFound: string;
                matchesFound: string;
                noResults: string;
                /** find_files 内容面板 */
                findFilesPanel: {
                    title: string;
                    totalFiles: string;
                    fileCount: string;
                    truncated: string;
                    collapse: string;
                    expandRemaining: string;
                    noFiles: string;
                };
                /** search_in_files 内容面板 */
                searchInFilesPanel: {
                    title: string;
                    replaceTitle: string;
                    regex: string;
                    matchCount: string;
                    fileCount: string;
                    truncated: string;
                    keywords: string;
                    replaceWith: string;
                    emptyString: string;
                    path: string;
                    pattern: string;
                    noResults: string;
                    collapse: string;
                    expandRemaining: string;
                    replacements: string;
                    replacementsInFile: string;
                    filesModified: string;
                    viewMatches: string;
                    viewDiff: string;
                    loadingDiff: string;
                };
            };
            /** 历史检索工具 */
            history: {
                historySearch: string;
                searchHistory: string;
                readHistory: string;
                readAll: string;
                panel: {
                    searchTitle: string;
                    readTitle: string;
                    regex: string;
                    keywords: string;
                    lineRange: string;
                    noContent: string;
                    collapse: string;
                    expandRemaining: string;
                    copyContent: string;
                    copied: string;
                };
            };
            /** 终端工具 */
            terminal: {
                executeCommand: string;
                command: string;
                output: string;
                exitCode: string;
                running: string;
                terminated: string;
                terminateCommand: string;
                /** execute_command 内容面板 */
                executeCommandPanel: {
                    title: string;
                    status: {
                        failed: string;
                        terminated: string;
                        success: string;
                        exitCode: string;
                        running: string;
                        pending: string;
                    };
                    terminate: string;
                    terminateTooltip: string;
                    copyOutput: string;
                    copied: string;
                    output: string;
                    truncatedInfo: string;
                    autoScroll: string;
                    waitingOutput: string;
                    noOutput: string;
                    executing: string;
                };
            };
            /** 媒体工具 */
            media: {
                generateImage: string;
                resizeImage: string;
                cropImage: string;
                rotateImage: string;
                removeBackground: string;
                generating: string;
                processing: string;
                imagesGenerated: string;
                saveImage: string;
                saveTo: string;
                saved: string;
                saveFailed: string;
                /** crop_image 内容面板 */
                cropImagePanel: {
                    title: string;
                    cancel: string;
                    cancelCrop: string;
                    status: {
                        needDependency: string;
                        cancelled: string;
                        failed: string;
                        success: string;
                        error: string;
                        processing: string;
                        waiting: string;
                    };
                    checkingDependency: string;
                    dependencyMessage: string;
                    batchCrop: string;
                    cropTask: string;
                    coordsHint: string;
                    cancelledMessage: string;
                    resultTitle: string;
                    original: string;
                    cropped: string;
                    cropResultN: string;
                    saved: string;
                    overwriteSave: string;
                    save: string;
                    openInEditor: string;
                    savePaths: string;
                    croppingImages: string;
                    openFileFailed: string;
                    saveFailed: string;
                };
                /** generate_image 内容面板 */
                generateImagePanel: {
                    title: string;
                    cancel: string;
                    cancelGeneration: string;
                    status: {
                        needDependency: string;
                        cancelled: string;
                        failed: string;
                        success: string;
                        error: string;
                        generating: string;
                        waiting: string;
                    };
                    batchTasks: string;
                    generateTask: string;
                    outputPath: string;
                    aspectRatio: string;
                    imageSize: string;
                    referenceImages: string;
                    cancelledMessage: string;
                    tasksFailed: string;
                    resultTitle: string;
                    saved: string;
                    overwriteSave: string;
                    save: string;
                    openInEditor: string;
                    savePaths: string;
                    generatingImages: string;
                    openFileFailed: string;
                    saveFailed: string;
                };
                /** remove_background 内容面板 */
                removeBackgroundPanel: {
                    title: string;
                    cancel: string;
                    cancelRemove: string;
                    status: {
                        needDependency: string;
                        cancelled: string;
                        failed: string;
                        success: string;
                        error: string;
                        processing: string;
                        waiting: string;
                        disabled: string;
                    };
                    checkingDependency: string;
                    dependencyMessage: string;
                    batchTasks: string;
                    removeTask: string;
                    subjectDescription: string;
                    maskPath: string;
                    needSharp: {
                        title: string;
                        message: string;
                        installCmd: string;
                    };
                    cancelledMessage: string;
                    tasksFailed: string;
                    resultTitle: string;
                    maskImage: string;
                    resultImage: string;
                    saved: string;
                    overwriteSave: string;
                    save: string;
                    openInEditor: string;
                    savePaths: string;
                    processingImages: string;
                    openFileFailed: string;
                    saveFailed: string;
                };
                /** resize_image 内容面板 */
                resizeImagePanel: {
                    title: string;
                    cancel: string;
                    cancelResize: string;
                    status: {
                        needDependency: string;
                        cancelled: string;
                        failed: string;
                        success: string;
                        error: string;
                        processing: string;
                        waiting: string;
                    };
                    checkingDependency: string;
                    dependencyMessage: string;
                    batchResize: string;
                    resizeTask: string;
                    sizeHint: string;
                    cancelledMessage: string;
                    resultTitle: string;
                    resizeResultN: string;
                    dimensions: {
                        original: string;
                        resized: string;
                    };
                    saved: string;
                    overwriteSave: string;
                    save: string;
                    openInEditor: string;
                    savePaths: string;
                    resizingImages: string;
                    openFileFailed: string;
                    saveFailed: string;
                };
                /** rotate_image 内容面板 */
                rotateImagePanel: {
                    title: string;
                    cancel: string;
                    cancelRotate: string;
                    status: {
                        needDependency: string;
                        cancelled: string;
                        failed: string;
                        success: string;
                        error: string;
                        processing: string;
                        waiting: string;
                    };
                    checkingDependency: string;
                    dependencyMessage: string;
                    batchRotate: string;
                    rotateTask: string;
                    angleHint: string;
                    angleFormat: {
                        counterclockwise: string;
                        clockwise: string;
                    };
                    cancelledMessage: string;
                    resultTitle: string;
                    rotateResultN: string;
                    dimensions: {
                        rotation: string;
                        size: string;
                    };
                    saved: string;
                    overwriteSave: string;
                    save: string;
                    openInEditor: string;
                    savePaths: string;
                    rotatingImages: string;
                    openFileFailed: string;
                    saveFailed: string;
                };
            };
            /** LSP 工具 */
            lsp: {
                getSymbols: string;
                gotoDefinition: string;
                findReferences: string;
                /** get_symbols 内容面板 */
                getSymbolsPanel: {
                    title: string;
                    totalFiles: string;
                    totalSymbols: string;
                    noSymbols: string;
                    symbolCount: string;
                    collapse: string;
                    expandRemaining: string;
                    copyAll: string;
                    copied: string;
                };
                /** goto_definition 内容面板 */
                gotoDefinitionPanel: {
                    title: string;
                    definitionFound: string;
                    noDefinition: string;
                    lines: string;
                    copyCode: string;
                    copied: string;
                };
                /** find_references 内容面板 */
                findReferencesPanel: {
                    title: string;
                    totalReferences: string;
                    totalFiles: string;
                    noReferences: string;
                    referencesInFile: string;
                    collapse: string;
                    expandRemaining: string;
                };
            };
            /** MCP 工具 */
            mcp: {
                mcpTool: string;
                serverName: string;
                toolName: string;
                /** mcp_tool 内容面板 */
                mcpToolPanel: {
                    requestParams: string;
                    errorInfo: string;
                    responseResult: string;
                    waitingResponse: string;
                };
            };
            /** 子代理工具 */
            subagents: {
                title: string;
                task: string;
                context: string;
                completed: string;
                failed: string;
                executing: string;
                partialResponse: string;
            };
        };
    };

    /** App.vue 主应用组件 */
    app: {
        retryPanel: {
            title: string;
            cancelTooltip: string;
            defaultError: string;
        };
        autoSummaryPanel: {
            summarizing: string;
            manualSummarizing: string;
            cancelTooltip: string;
        };
    };

    /** 错误消息 */
    errors: {
        networkError: string;
        apiError: string;
        timeout: string;
        invalidConfig: string;
        fileNotFound: string;
        permissionDenied: string;
        unknown: string;
        connectionFailed: string;
        authFailed: string;
        rateLimited: string;
        serverError: string;
        invalidResponse: string;
        cancelled: string;
    };

    /** Composables 翻译 */
    composables: {
        useChat: {
            errors: {
                sendFailed: string;
                retryFailed: string;
                editRetryFailed: string;
                deleteFailed: string;
                streamError: string;
                loadHistoryFailed: string;
            };
        };
        useConversations: {
            defaultTitle: string;
            newChatTitle: string;
            errors: {
                loadFailed: string;
                createFailed: string;
                deleteFailed: string;
                updateTitleFailed: string;
            };
            relativeTime: {
                justNow: string;
                minutesAgo: string;
                hoursAgo: string;
                daysAgo: string;
            };
        };
        useAttachments: {
            errors: {
                validationFailed: string;
                createThumbnailFailed: string;
                createVideoThumbnailFailed: string;
                readFileFailed: string;
                loadVideoFailed: string;
                readResultNotString: string;
            };
        };
    };

    /** Stores 翻译 */
    stores: {
        terminalStore: {
            errors: {
                killTerminalFailed: string;
                refreshOutputFailed: string;
            };
        };
        chatStore: {
            defaultTitle: string;
            errors: {
                loadConversationsFailed: string;
                createConversationFailed: string;
                deleteConversationFailed: string;
                sendMessageFailed: string;
                streamError: string;
                loadHistoryFailed: string;
                retryFailed: string;
                editRetryFailed: string;
                deleteFailed: string;
                noConversationSelected: string;
                unknownError: string;
                restoreFailed: string;
                restoreCheckpointFailed: string;
                restoreRetryFailed: string;
                restoreDeleteFailed: string;
                noConfigSelected: string;
                summarizeFailed: string;
                restoreEditFailed: string;
            };
            relativeTime: {
                justNow: string;
                minutesAgo: string;
                hoursAgo: string;
                daysAgo: string;
            };
        };
    };
}