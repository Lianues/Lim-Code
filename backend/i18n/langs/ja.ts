/**
 * LimCode Backend - 日本語言語パック
 */

import type { BackendLanguageMessages } from '../types';

const ja: BackendLanguageMessages = {
    core: {
        registry: {
            moduleAlreadyRegistered: 'モジュール "{moduleId}" は既に登録されています',
            duplicateApiName: 'モジュール "{moduleId}" に重複した API 名があります: {apiName}',
            registeringModule: '[ModuleRegistry] モジュールを登録中: {moduleId} ({moduleName} v{version})',
            moduleNotRegistered: 'モジュールが登録されていません: {moduleId}',
            unregisteringModule: '[ModuleRegistry] モジュールの登録を解除中: {moduleId}',
            apiNotFound: 'API が見つかりません: {moduleId}.{apiName}',
            missingRequiredParams: '必須パラメータが不足しています: {params}'
        }
    },

    modules: {
        config: {
            errors: {
                configNotFound: '設定が見つかりません: {configId}',
                configExists: '設定は既に存在します: {configId}、overwrite オプションを使用して置き換えてください',
                invalidConfig: '無効な設定',
                validationFailed: '設定の検証に失敗しました: {errors}',
                saveFailed: '設定の保存に失敗しました',
                loadFailed: '設定の読み込みに失敗しました'
            },
            validation: {
                nameRequired: '名前は必須です',
                typeRequired: 'タイプは必須です',
                invalidUrl: 'API URL が無効です',
                apiKeyEmpty: 'API Key が空です。使用前に設定が必要です',
                modelNotSelected: '利用可能なモデルがありますが、選択されていません',
                temperatureRange: 'temperature は 0.0 から 2.0 の間である必要があります',
                maxOutputTokensMin: 'maxOutputTokens は 0 より大きい必要があります',
                maxOutputTokensHigh: 'maxOutputTokens が大きすぎます。高遅延の原因になる可能性があります',
                openaiNotImplemented: 'OpenAI 設定の検証はまだ実装されていません',
                anthropicNotImplemented: 'Anthropic 設定の検証はまだ実装されていません'
            }
        },

        conversation: {
            defaultTitle: '会話 {conversationId}',
            errors: {
                conversationNotFound: '会話が見つかりません: {conversationId}',
                conversationExists: '会話は既に存在します: {conversationId}',
                messageNotFound: 'メッセージが見つかりません: {messageId}',
                messageIndexOutOfBounds: 'メッセージインデックスが範囲外です: {index}',
                snapshotNotFound: 'スナップショットが見つかりません: {snapshotId}',
                snapshotNotBelongToConversation: 'スナップショットはこの会話に属していません',
                saveFailed: '会話の保存に失敗しました',
                loadFailed: '会話の読み込みに失敗しました'
            }
        },

        mcp: {
            errors: {
                connectionFailed: '接続に失敗しました: {serverName}',
                serverNotFound: 'サーバーが見つかりません: {serverId}',
                serverNotFoundWithAvailable: 'サーバーが見つかりません: {serverId}。利用可能なサーバー: {available}',
                serverDisabled: 'サーバーが無効です: {serverId}',
                serverNotConnected: 'サーバーが接続されていません: {serverName}',
                clientNotConnected: 'クライアントが接続されていません',
                toolCallFailed: 'ツール呼び出しに失敗しました',
                requestTimeout: 'リクエストがタイムアウトしました ({timeout}ms)',
                invalidServerId: 'ID には英数字、アンダースコア、ハイフンのみ使用できます',
                serverIdExists: 'サーバー ID "{serverId}" は既に存在します'
            },
            status: {
                connecting: '接続中...',
                connected: '接続済み',
                disconnected: '切断済み',
                error: 'エラー'
            }
        },

        checkpoint: {
            description: {
                before: '実行前',
                after: '実行後'
            },
            restore: {
                success: '"{toolName}" {phase}の状態に復元しました',
                filesUpdated: '{count} 個のファイルが更新されました',
                filesDeleted: '{count} 個のファイルが削除されました',
                filesUnchanged: '{count} 個のファイルは変更なし'
            },
            defaultConversationTitle: '会話 {conversationId}',
            errors: {
                createFailed: 'チェックポイントの作成に失敗しました',
                restoreFailed: 'チェックポイントの復元に失敗しました',
                deleteFailed: 'チェックポイントの削除に失敗しました'
            }
        },

        settings: {
            errors: {
                loadFailed: '設定の読み込みに失敗しました',
                saveFailed: '設定の保存に失敗しました',
                invalidValue: '無効な設定値'
            },
            storage: {
                pathNotAbsolute: 'パスは絶対パスである必要があります: {path}',
                pathNotDirectory: 'パスはディレクトリである必要があります: {path}',
                createDirectoryFailed: 'ディレクトリの作成に失敗しました: {error}',
                migrationFailed: '移行に失敗しました: {error}',
                migrationSuccess: 'ストレージの移行が完了しました',
                migratingFiles: 'ファイルを移行中...',
                migratingConversations: '会話を移行中...',
                migratingCheckpoints: 'チェックポイントを移行中...',
                migratingConfigs: '設定を移行中...'
            }
        },

        dependencies: {
            descriptions: {
                sharp: '背景除去でマスク適用に使用する高性能画像処理ライブラリ',
                transformers: 'ローカル AI 背景除去エンジン (RMBG-2.0)、2024 SOTA レベル、髪の毛レベルの精度、完全オフライン'
            },
            errors: {
                requiresContext: 'DependencyManager は初回呼び出し時に ExtensionContext が必要です',
                unknownDependency: '不明な依存関係: {name}',
                nodeModulesNotFound: 'インストール後に node_modules ディレクトリが見つかりません',
                moduleNotFound: 'インストール後に {name} モジュールが見つかりません',
                installFailed: 'インストールに失敗しました: {error}',
                uninstallFailed: '{name} のアンインストールに失敗しました',
                loadFailed: '{name} の読み込みに失敗しました'
            },
            progress: {
                installing: '{name} をインストール中...',
                downloading: '{name} をダウンロード中...',
                installSuccess: '{name} のインストールが完了しました！'
            }
        },

        channel: {
            formatters: {
                gemini: {
                    errors: {
                        invalidResponse: '無効な Gemini API レスポンス: 候補がありません',
                        apiError: 'API がエラーステータスを返しました: {code}'
                    }
                },
                anthropic: {
                    errors: {
                        invalidResponse: '無効な Anthropic API レスポンス: コンテンツがありません'
                    }
                },
                openai: {
                    errors: {
                        invalidResponse: '無効な OpenAI API レスポンス: 選択肢がありません'
                    }
                }
            },
            errors: {
                configNotFound: '設定が見つかりません: {configId}',
                configDisabled: '設定が無効です: {configId}',
                unsupportedChannelType: 'サポートされていないチャンネルタイプ: {type}',
                configValidationFailed: '設定の検証に失敗しました: {configId}',
                buildRequestFailed: 'リクエストの構築に失敗しました: {error}',
                apiError: 'API がエラーステータスを返しました: {status}',
                parseResponseFailed: 'レスポンスの解析に失敗しました: {error}',
                httpRequestFailed: 'HTTP リクエストに失敗しました: {error}',
                parseStreamChunkFailed: 'ストリームチャンクの解析に失敗しました: {error}',
                streamRequestFailed: 'ストリームリクエストに失敗しました: {error}',
                requestTimeout: 'リクエストがタイムアウトしました ({timeout}ms)',
                requestTimeoutNoResponse: 'リクエストがタイムアウトしました ({timeout}ms 内に応答なし)',
                requestCancelled: 'リクエストがキャンセルされました',
                requestAborted: 'リクエストが中止されました',
                noResponseBody: 'レスポンスボディがありません'
            },
            modelList: {
                errors: {
                    apiKeyRequired: 'API Key は必須です',
                    fetchModelsFailed: 'モデルの取得に失敗しました: {error}',
                    unsupportedConfigType: 'サポートされていない設定タイプ: {type}'
                }
            }
        },

        api: {
            channel: {
                errors: {
                    listChannelsFailed: 'チャンネル設定一覧の取得に失敗しました',
                    channelNotFound: 'チャンネル設定が見つかりません: {channelId}',
                    getChannelFailed: 'チャンネル設定の取得に失敗しました',
                    channelAlreadyExists: 'チャンネル設定は既に存在します: {channelId}',
                    createChannelFailed: 'チャンネル設定の作成に失敗しました',
                    updateChannelFailed: 'チャンネル設定の更新に失敗しました',
                    deleteChannelFailed: 'チャンネル設定の削除に失敗しました',
                    setChannelStatusFailed: 'チャンネルステータスの設定に失敗しました'
                }
            },
            settings: {
                errors: {
                    getSettingsFailed: '設定の取得に失敗しました',
                    updateSettingsFailed: '設定の更新に失敗しました',
                    setActiveChannelFailed: 'アクティブチャンネルの設定に失敗しました',
                    setToolStatusFailed: 'ツールステータスの設定に失敗しました',
                    batchSetToolStatusFailed: 'ツールステータスの一括設定に失敗しました',
                    setDefaultToolModeFailed: 'デフォルトツールモードの設定に失敗しました',
                    updateUISettingsFailed: 'UI 設定の更新に失敗しました',
                    updateProxySettingsFailed: 'プロキシ設定の更新に失敗しました',
                    resetSettingsFailed: '設定のリセットに失敗しました',
                    toolRegistryNotAvailable: 'ツールレジストリが利用できません',
                    getToolsListFailed: 'ツール一覧の取得に失敗しました',
                    getToolConfigFailed: 'ツール設定の取得に失敗しました',
                    updateToolConfigFailed: 'ツール設定の更新に失敗しました',
                    updateListFilesConfigFailed: 'list_files 設定の更新に失敗しました',
                    updateApplyDiffConfigFailed: 'apply_diff 設定の更新に失敗しました',
                    getCheckpointConfigFailed: 'チェックポイント設定の取得に失敗しました',
                    updateCheckpointConfigFailed: 'チェックポイント設定の更新に失敗しました',
                    getSummarizeConfigFailed: '要約設定の取得に失敗しました',
                    updateSummarizeConfigFailed: '要約設定の更新に失敗しました',
                    getGenerateImageConfigFailed: '画像生成設定の取得に失敗しました',
                    updateGenerateImageConfigFailed: '画像生成設定の更新に失敗しました'
                }
            },
            models: {
                errors: {
                    configNotFound: '設定が見つかりません',
                    getModelsFailed: 'モデル一覧の取得に失敗しました',
                    addModelsFailed: 'モデルの追加に失敗しました',
                    removeModelFailed: 'モデルの削除に失敗しました',
                    modelNotInList: 'モデルがリストにありません',
                    setActiveModelFailed: 'アクティブモデルの設定に失敗しました'
                }
            },
            mcp: {
                errors: {
                    listServersFailed: 'MCP サーバー一覧の取得に失敗しました',
                    serverNotFound: 'MCP サーバーが見つかりません: {serverId}',
                    getServerFailed: 'MCP サーバーの取得に失敗しました',
                    createServerFailed: 'MCP サーバーの作成に失敗しました',
                    updateServerFailed: 'MCP サーバーの更新に失敗しました',
                    deleteServerFailed: 'MCP サーバーの削除に失敗しました',
                    setServerStatusFailed: 'MCP サーバーステータスの設定に失敗しました',
                    connectServerFailed: 'MCP サーバーへの接続に失敗しました',
                    disconnectServerFailed: 'MCP サーバーの切断に失敗しました'
                }
            },
            chat: {
                errors: {
                    configNotFound: '設定が見つかりません: {configId}',
                    configDisabled: '設定が無効です: {configId}',
                    maxToolIterations: '最大ツール呼び出し回数に達しました ({maxIterations})',
                    unknownError: '不明なエラー',
                    toolExecutionSuccess: 'ツールの実行に成功しました',
                    mcpToolCallFailed: 'MCP ツール呼び出しに失敗しました',
                    invalidMcpToolName: '無効な MCP ツール名: {toolName}',
                    toolNotFound: 'ツールが見つかりません: {toolName}',
                    toolExecutionFailed: 'ツールの実行に失敗しました',
                    noHistory: '会話履歴が空です',
                    lastMessageNotModel: '最後のメッセージがモデルメッセージではありません',
                    noFunctionCalls: '保留中のファンクション呼び出しがありません',
                    userRejectedTool: 'ユーザーがツールの実行を拒否しました',
                    notEnoughRounds: '会話ラウンド数が不足しています。現在 {currentRounds} ラウンド、{keepRounds} ラウンド保持、要約は不要です',
                    notEnoughContent: '会話ラウンド数が不足しています。現在 {currentRounds} ラウンド、{keepRounds} ラウンド保持、要約するコンテンツがありません',
                    noMessagesToSummarize: '要約するメッセージがありません',
                    summarizeAborted: '要約リクエストが中止されました',
                    emptySummary: 'AI が生成した要約が空です',
                    messageNotFound: 'メッセージが見つかりません: インデックス {messageIndex}',
                    canOnlyEditUserMessage: 'ユーザーメッセージのみ編集できます。現在のメッセージロール: {role}'
                },
                prompts: {
                    defaultSummarizePrompt: `上記の会話内容を簡潔に要約してください。書式マーカーなしで直接要約を出力してください。

要件：
1. 重要な情報とコンテキストのポイントを保持する
2. 冗長な内容とツール呼び出しの詳細を削除する
3. トピック、議論された問題、結論を要約する
4. 重要な技術的詳細と決定を保持する
5. プレフィックス、タイトル、書式マーカーなしで直接要約内容を出力する`,
                    summaryPrefix: '[会話要約]'
                }
            }
        }
    },

    tools: {
        errors: {
            toolNotFound: 'ツールが見つかりません: {toolName}',
            executionFailed: 'ツールの実行に失敗しました: {error}',
            invalidParams: '無効なパラメータ',
            timeout: '実行がタイムアウトしました'
        },

        file: {
            errors: {
                fileNotFound: 'ファイルが見つかりません: {path}',
                readFailed: 'ファイルの読み取りに失敗しました: {error}',
                writeFailed: 'ファイルの書き込みに失敗しました: {error}',
                deleteFailed: 'ファイルの削除に失敗しました: {error}',
                permissionDenied: '権限が拒否されました: {path}'
            },
            diffManager: {
                saved: '変更を保存しました: {filePath}',
                saveFailed: '保存に失敗しました: {error}',
                savedShort: '保存完了: {filePath}',
                rejected: '変更を拒否しました: {filePath}',
                rejectFailed: '拒否に失敗しました: {error}',
                diffTitle: '{filePath} (AI の変更 - Ctrl+S で保存)'
            },
            readFile: {
                cannotReadFile: 'このファイルを読み取ることができません'
            }
        },

        terminal: {
            errors: {
                executionFailed: 'コマンドの実行に失敗しました',
                timeout: 'コマンドの実行がタイムアウトしました',
                killed: 'コマンドが終了されました'
            },
            shellCheck: {
                wslNotInstalled: 'WSL がインストールされていないか、有効になっていません',
                shellNotFound: '見つかりません: {shellPath}',
                shellNotInPath: '{shellPath} が PATH にありません'
            }
        },

        search: {
            google_search: {
                errors: {
                    unsupportedChannel: '現在のチャンネルタイプ "{channel}" は Google 検索をサポートしていません。この機能は現在 Gemini チャンネルでのみサポートされています。'
                }
            },
            errors: {
                searchFailed: '検索に失敗しました: {error}',
                invalidPattern: '無効な検索パターン: {pattern}'
            }
        },

        media: {
            errors: {
                processingFailed: '処理に失敗しました: {error}',
                invalidFormat: '無効な形式: {format}',
                dependencyMissing: '依存関係が不足しています: {dependency}'
            }
        },
        
        common: {
            taskNotFound: 'タスク {id} が見つからないか、既に完了しています',
            cancelTaskFailed: 'タスクのキャンセルに失敗しました: {error}',
            toolAlreadyExists: 'ツールは既に存在します: {name}'
        },
        
        skills: {
            description: 'Skills のオン/オフを切り替えます。Skills はユーザー定義のナレッジモジュールで、専門的なコンテキストと指示を提供します。各パラメータは skill 名です - true で有効、false で無効にします。',
            errors: {
                managerNotInitialized: 'Skills マネージャーが初期化されていません'
            }
        }
    },
    
    workspace: {
        noWorkspaceOpen: 'ワークスペースが開いていません',
        singleWorkspace: 'ワークスペース: {path}',
        multiRootMode: 'マルチルートワークスペースモード:',
        useWorkspaceFormat: '特定のワークスペース内のファイルにアクセスするには「ワークスペース名/パス」形式を使用してください'
    },
    
    multimodal: {
        cannotReadFile: '{ext} ファイルを読み取れません：マルチモーダルツールが有効になっていません。チャンネル設定で「マルチモーダルツール」オプションを有効にしてください。',
        cannotReadBinaryFile: 'バイナリファイル {ext} を読み取れません：このファイル形式はサポートされていません。',
        cannotReadImage: '{ext} 画像を読み取れません：現在のチャンネルタイプは画像の読み取りをサポートしていません。',
        cannotReadDocument: '{ext} ドキュメントを読み取れません：現在のチャンネルタイプはドキュメントの読み取りをサポートしていません。OpenAI 形式は画像のみサポートし、ドキュメントはサポートしていません。'
    },
    
    webview: {
        errors: {
            noWorkspaceOpen: 'ワークスペースが開いていません',
            workspaceNotFound: 'ワークスペースが見つかりません',
            invalidFileUri: '無効なファイル URI',
            pathNotFile: 'パスがファイルではありません',
            fileNotExists: 'ファイルが存在しません',
            fileNotInWorkspace: 'ファイルが現在のワークスペースにありません',
            fileNotInAnyWorkspace: 'ファイルが開いているワークスペースにありません',
            fileInOtherWorkspace: 'ファイルは別のワークスペースに属しています: {workspaceName}',
            conversationFileNotExists: '会話ファイルが存在しません',
            cannotRevealInExplorer: 'エクスプローラーで表示できません',
            
            deleteMessageFailed: 'メッセージの削除に失敗しました',
            
            getModelsFailed: 'モデル一覧の取得に失敗しました',
            addModelsFailed: 'モデルの追加に失敗しました',
            removeModelFailed: 'モデルの削除に失敗しました',
            setActiveModelFailed: 'アクティブモデルの設定に失敗しました',
            
            updateUISettingsFailed: 'UI 設定の更新に失敗しました',
            getSettingsFailed: '設定の取得に失敗しました',
            updateSettingsFailed: '設定の更新に失敗しました',
            setActiveChannelFailed: 'アクティブチャンネルの設定に失敗しました',
            
            getToolsFailed: 'ツール一覧の取得に失敗しました',
            setToolEnabledFailed: 'ツールステータスの設定に失敗しました',
            getToolConfigFailed: 'ツール設定の取得に失敗しました',
            updateToolConfigFailed: 'ツール設定の更新に失敗しました',
            getAutoExecConfigFailed: '自動実行設定の取得に失敗しました',
            getMcpToolsFailed: 'MCP ツール一覧の取得に失敗しました',
            setToolAutoExecFailed: 'ツールの自動実行設定に失敗しました',
            updateListFilesConfigFailed: 'list_files 設定の更新に失敗しました',
            updateApplyDiffConfigFailed: 'apply_diff 設定の更新に失敗しました',
            updateExecuteCommandConfigFailed: 'ターミナル設定の更新に失敗しました',
            checkShellFailed: 'シェルの確認に失敗しました',
            
            killTerminalFailed: 'ターミナルの終了に失敗しました',
            getTerminalOutputFailed: 'ターミナル出力の取得に失敗しました',
            
            cancelImageGenFailed: '画像生成のキャンセルに失敗しました',
            
            cancelTaskFailed: 'タスクのキャンセルに失敗しました',
            getTasksFailed: 'タスク一覧の取得に失敗しました',
            
            getCheckpointConfigFailed: 'チェックポイント設定の取得に失敗しました',
            updateCheckpointConfigFailed: 'チェックポイント設定の更新に失敗しました',
            getCheckpointsFailed: 'チェックポイント一覧の取得に失敗しました',
            restoreCheckpointFailed: 'チェックポイントの復元に失敗しました',
            deleteCheckpointFailed: 'チェックポイントの削除に失敗しました',
            deleteAllCheckpointsFailed: 'すべてのチェックポイントの削除に失敗しました',
            getConversationsWithCheckpointsFailed: 'チェックポイント付き会話の取得に失敗しました',
            
            openDiffPreviewFailed: 'diff プレビューを開くのに失敗しました',
            diffContentNotFound: 'Diff 内容が見つからないか、期限切れです',
            loadDiffContentFailed: 'Diff 内容の読み込みに失敗しました',
            invalidDiffData: '無効な diff データ',
            noFileContent: 'ファイルコンテンツがありません',
            unsupportedToolType: 'サポートされていないツールタイプ: {toolName}',
            acceptDiffFailed: 'Diff 変更の保存に失敗しました',
            rejectDiffFailed: 'Diff 変更の拒否に失敗しました',

            getRelativePathFailed: '相対パスの取得に失敗しました',
            previewAttachmentFailed: '添付ファイルのプレビューに失敗しました',
            readImageFailed: '画像の読み取りに失敗しました',
            openFileFailed: 'ファイルを開くのに失敗しました',
            saveImageFailed: '画像の保存に失敗しました',
            
            openMcpConfigFailed: 'MCP 設定ファイルを開くのに失敗しました',
            getMcpServersFailed: 'MCP サーバー一覧の取得に失敗しました',
            validateMcpServerIdFailed: 'MCP サーバー ID の検証に失敗しました',
            createMcpServerFailed: 'MCP サーバーの作成に失敗しました',
            updateMcpServerFailed: 'MCP サーバーの更新に失敗しました',
            deleteMcpServerFailed: 'MCP サーバーの削除に失敗しました',
            connectMcpServerFailed: 'MCP サーバーへの接続に失敗しました',
            disconnectMcpServerFailed: 'MCP サーバーの切断に失敗しました',
            setMcpServerEnabledFailed: 'MCP サーバーステータスの設定に失敗しました',
            
            getSummarizeConfigFailed: '要約設定の取得に失敗しました',
            updateSummarizeConfigFailed: '要約設定の更新に失敗しました',
            summarizeFailed: 'コンテキストの要約に失敗しました',
            
            getGenerateImageConfigFailed: '画像生成設定の取得に失敗しました',
            updateGenerateImageConfigFailed: '画像生成設定の更新に失敗しました',
            
            getGoogleSearchConfigFailed: 'Google 検索設定の取得に失敗しました',
            updateGoogleSearchConfigFailed: 'Google 検索設定の更新に失敗しました',
            
            getContextAwarenessConfigFailed: 'コンテキスト認識設定の取得に失敗しました',
            updateContextAwarenessConfigFailed: 'コンテキスト認識設定の更新に失敗しました',
            getOpenTabsFailed: '開いているタブの取得に失敗しました',
            getActiveEditorFailed: 'アクティブエディターの取得に失敗しました',
            
            getSystemPromptConfigFailed: 'システムプロンプト設定の取得に失敗しました',
            updateSystemPromptConfigFailed: 'システムプロンプト設定の更新に失敗しました',
            
            getPinnedFilesConfigFailed: 'ピン留めファイル設定の取得に失敗しました',
            checkPinnedFilesExistenceFailed: 'ファイルの存在確認に失敗しました',
            updatePinnedFilesConfigFailed: 'ピン留めファイル設定の更新に失敗しました',
            addPinnedFileFailed: 'ピン留めファイルの追加に失敗しました',
            removePinnedFileFailed: 'ピン留めファイルの削除に失敗しました',
            setPinnedFileEnabledFailed: 'ピン留めファイルステータスの設定に失敗しました',
            
            listDependenciesFailed: '依存関係一覧の取得に失敗しました',
            installDependencyFailed: '依存関係のインストールに失敗しました',
            uninstallDependencyFailed: '依存関係のアンインストールに失敗しました',
            getInstallPathFailed: 'インストールパスの取得に失敗しました',
            
            showNotificationFailed: '通知の表示に失敗しました',
            rejectToolCallsFailed: 'ツール呼び出しの拒否に失敗しました',
            
            getStorageConfigFailed: 'ストレージ設定の取得に失敗しました',
            updateStorageConfigFailed: 'ストレージ設定の更新に失敗しました',
            validateStoragePathFailed: 'ストレージパスの検証に失敗しました',
            migrateStorageFailed: 'ストレージの移行に失敗しました'
        },
        
        messages: {
            historyDiffPreview: '{filePath} (履歴差分プレビュー)',
            newFileContentPreview: '{filePath} (新規コンテンツプレビュー)',
            fullFileDiffPreview: '{filePath} (完全ファイル差分プレビュー)',
            searchReplaceDiffPreview: '{filePath} (検索置換差分プレビュー)'
        },
        dialogs: {
            selectStorageFolder: 'ストレージフォルダを選択',
            selectFolder: 'フォルダを選択'
        }
    },

    errors: {
        unknown: '不明なエラー',
        timeout: '操作がタイムアウトしました',
        cancelled: '操作がキャンセルされました',
        networkError: 'ネットワークエラー',
        invalidRequest: '無効なリクエスト',
        internalError: '内部エラー'
    }
};

export default ja;