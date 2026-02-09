/**
 * LimCode - 日本語言語パック
 * コンポーネントディレクトリ構造に従って翻訳を編成
 */

import type { LanguageMessages } from '../types';

const ja: LanguageMessages = {
    common: {
        save: '保存',
        cancel: 'キャンセル',
        confirm: '確認',
        delete: '削除',
        edit: '編集',
        add: '追加',
        remove: '削除',
        enable: '有効化',
        disable: '無効化',
        enabled: '有効',
        disabled: '無効',
        loading: '読み込み中...',
        error: 'エラー',
        success: '成功',
        warning: '警告',
        info: '情報',
        close: '閉じる',
        back: '戻る',
        next: '次へ',
        done: '完了',
        yes: 'はい',
        no: 'いいえ',
        ok: 'OK',
        copy: 'コピー',
        paste: '貼り付け',
        reset: 'リセット',
        default: 'デフォルト',
        custom: 'カスタム',
        auto: '自動',
        manual: '手動',
        none: 'なし',
        all: 'すべて',
        select: '選択',
        search: '検索',
        filter: 'フィルター',
        sort: '並べ替え',
        refresh: '更新',
        retry: '再試行',
        settings: '設定',
        help: 'ヘルプ',
        about: 'について',
        version: 'バージョン',
        name: '名前',
        description: '説明',
        status: 'ステータス',
        type: 'タイプ',
        size: 'サイズ',
        path: 'パス',
        time: '時間',
        date: '日付',
        actions: '操作',
        more: 'もっと見る',
        less: '折りたたむ',
        expand: '展開',
        collapse: '折りたたむ',
        preview: 'プレビュー',
        download: 'ダウンロード',
        upload: 'アップロード',
        import: 'インポート',
        export: 'エクスポート',
        create: '作成',
        update: '更新',
        apply: '適用',
        install: 'インストール',
        uninstall: 'アンインストール',
        start: '開始',
        stop: '停止',
        pause: '一時停止',
        resume: '再開',
        running: '実行中',
        stopped: '停止済み',
        pending: '保留中',
        completed: '完了',
        failed: '失敗',
        unknown: '不明'
    },

    components: {
        announcement: {
            title: '更新情報',
            gotIt: '了解'
        },
        attachment: {
            preview: 'プレビュー',
            download: 'ダウンロード',
            close: '閉じる',
            downloadFile: 'ファイルをダウンロード',
            unsupportedPreview: 'このファイル形式はプレビューできません',
            imageFile: '画像ファイル',
            videoFile: '動画ファイル',
            audioFile: '音声ファイル',
            documentFile: 'ドキュメントファイル',
            otherFile: 'その他のファイル'
        },

        common: {
            confirmDialog: {
                title: '確認',
                message: 'この操作を実行してもよろしいですか？',
                confirm: '確認',
                cancel: 'キャンセル'
            },
            inputDialog: {
                title: '入力',
                confirm: 'OK',
                cancel: 'キャンセル'
            },
            deleteDialog: {
                title: 'メッセージを削除',
                message: 'このメッセージを削除してもよろしいですか？',
                messageWithCount: 'このメッセージを削除してもよろしいですか？これにより後続の {count} 件のメッセージも削除され、合計 {total} 件のメッセージが削除されます。',
                checkpointHint: 'このメッセージの前にバックアップが検出されました。削除前にそのバックアップポイントに復元して、ファイルの変更を回復することができます。',
                cancel: 'キャンセル',
                delete: '削除',
                restoreToUserMessage: 'ユーザーメッセージ前に復元',
                restoreToAssistantMessage: 'アシスタントメッセージ前に復元',
                restoreToToolBatch: 'バッチツール実行前に復元',
                restoreToTool: '{toolName} 実行前に復元',
                restoreToAfterUserMessage: 'ユーザーメッセージ後に復元',
                restoreToAfterAssistantMessage: 'アシスタントメッセージ後に復元',
                restoreToAfterToolBatch: 'バッチツール実行後に復元',
                restoreToAfterTool: '{toolName} 実行後に復元'
            },
            editDialog: {
                title: 'メッセージを編集',
                placeholder: '新しいメッセージ内容を入力...（添付ファイルを貼り付け、ファイルをドラッグしてバッジを追加、Ctrl+Shift+ドラッグで @path を挿入、@ でファイル検索）',
                addAttachment: '添付ファイルを追加',
                checkpointHint: 'このメッセージの前にツール実行のバックアップが検出されました。ツール実行前に復元してから編集することで、ファイルの変更を回復できます。',
                cancel: 'キャンセル',
                save: '保存',
                restoreToUserMessage: 'ユーザーメッセージ前に復元',
                restoreToAssistantMessage: 'アシスタントメッセージ前に復元',
                restoreToToolBatch: 'バッチツール実行前に復元',
                restoreToTool: '{toolName} 実行前に復元',
                restoreToAfterUserMessage: 'ユーザーメッセージ後に復元',
                restoreToAfterAssistantMessage: 'アシスタントメッセージ後に復元',
                restoreToAfterToolBatch: 'バッチツール実行後に復元',
                restoreToAfterTool: '{toolName} 実行後に復元'
            },
            retryDialog: {
                title: 'メッセージを再試行',
                message: 'このメッセージを再試行してもよろしいですか？これによりこのメッセージと後続のメッセージが削除され、新しい AI レスポンスをリクエストします。',
                checkpointHint: 'このメッセージの前にツール実行のバックアップが検出されました。ツール実行前に復元してから再試行できます。',
                cancel: 'キャンセル',
                retry: '再試行',
                restoreToUserMessage: 'ユーザーメッセージ前に復元',
                restoreToAssistantMessage: 'アシスタントメッセージ前に復元',
                restoreToToolBatch: 'バッチツール実行前に復元',
                restoreToTool: '{toolName} 実行前に復元',
                restoreToAfterUserMessage: 'ユーザーメッセージ後に復元',
                restoreToAfterAssistantMessage: 'アシスタントメッセージ後に復元',
                restoreToAfterToolBatch: 'バッチツール実行後に復元',
                restoreToAfterTool: '{toolName} 実行後に復元'
            },
            dependencyWarning: {
                title: '依存関係が必要です',
                defaultMessage: 'この機能には以下の依存関係が必要です：',
                hint: '移動先：',
                linkText: '拡張機能の依存関係'
            },
            emptyState: {
                noData: 'データがありません',
                noResults: '検索結果がありません'
            },
            tooltip: {
                copied: 'コピーしました',
                copyFailed: 'コピーに失敗しました'
            },
            modal: {
                close: '閉じる'
            },
            markdown: {
                copyCode: 'コードをコピー',
                wrapEnable: '折り返し',
                wrapDisable: '折り返しなし',
                copied: 'コピーしました',
                imageLoadFailed: '画像の読み込みに失敗しました'
            },
            markdownRenderer: {
                mermaid: {
                    title: 'Mermaid 図',
                    copyCode: 'Mermaid コードをコピー',
                    zoomIn: '拡大',
                    zoomOut: '縮小',
                    resetZoom: 'ズームをリセット',
                    tip: 'ホイールでズーム、ドラッグで移動',
                    closePreview: 'プレビューを閉じる'
                }
            },
            scrollToTop: 'トップへ戻る',
            scrollToBottom: '一番下へ戻る'
        },

        header: {
            newChat: '新しい会話',
            history: '履歴',
            settings: '設定',
            model: 'モデル',
            channel: 'チャンネル'
        },

        tabs: {
            newChat: '新しい会話',
            newTab: '新しいタブ',
            closeTab: 'タブを閉じる'
        },

        history: {
            title: '会話履歴',
            empty: '会話履歴がありません',
            deleteConfirm: 'この会話を削除してもよろしいですか？',
            searchPlaceholder: '会話を検索...',
            clearSearch: '検索をクリア',
            noSearchResults: '一致する会話がありません',
            today: '今日',
            yesterday: '昨日',
            thisWeek: '今週',
            earlier: 'それ以前',
            noTitle: 'タイトルなし',
            currentWorkspace: '現在のワークスペース',
            allWorkspaces: 'すべてのワークスペース',
            backToChat: '会話に戻る',
            showHistory: '履歴を表示：',
            revealInExplorer: 'エクスプローラーで表示',
            deleteConversation: '会話を削除',
            messages: '件のメッセージ'
        },

        home: {
            welcome: 'LimCode へようこそ',
            welcomeMessage: 'より効率的にコードを書くための AI コーディングアシスタント',
            welcomeHint: '下の入力欄にメッセージを入力して会話を開始',
            quickStart: 'クイックスタート',
            recentChats: '最近の会話',
            noRecentChats: '会話履歴がありません',
            viewAll: 'すべて表示'
        },

        input: {
            placeholder: 'メッセージを入力...',
            placeholderHint: 'メッセージを入力...（Enter で送信、添付ファイルを貼り付け、Shift+ドラッグまたは@でパスを追加、Ctrl+Shift+ドラッグで @path を挿入）',
            send: 'メッセージを送信',
            stopGenerating: '生成を停止',
            attachFile: 'ファイルを添付',
            pinnedFiles: 'ピン留めファイル',
            skills: 'Skills',
            summarizeContext: 'コンテキストを要約',
            selectChannel: 'チャンネルを選択',
            selectModel: 'モデルを選択',
            clickToPreview: 'クリックしてプレビュー',
            remove: '削除',
            tokenUsage: '使用量',
            context: 'コンテキスト',
            fileNotExists: 'ファイルが存在しません',
            queue: {
                title: 'キューメッセージ',
                sendNow: '今すぐ送信',
                remove: '削除',
                queued: 'キューに追加',
                drag: 'ドラッグして並べ替え',
                edit: '編集'
            },
            mode: {
                selectMode: 'モードを選択',
                manageMode: 'モードを管理',
                search: 'モードを検索...',
                noResults: '一致するモードがありません'
            },
            channelSelector: {
                placeholder: '設定を選択',
                searchPlaceholder: 'チャンネルを検索...',
                noMatch: '一致するチャンネルがありません'
            },
            modelSelector: {
                placeholder: 'モデルを選択',
                searchPlaceholder: 'モデルを検索...',
                noMatch: '一致するモデルがありません',
                addInSettings: '設定でモデルを追加してください'
            },
            pinnedFilesPanel: {
                title: 'ピン留めファイル',
                description: 'ピン留めされたファイルの内容は毎回の会話で AI に送信されます',
                loading: '読み込み中...',
                empty: 'ピン留めファイルがありません',
                notExists: '存在しません',
                dragHint: 'Shift を押しながらワークスペース内のテキストファイルをここにドラッグして追加',
                dropHint: 'ファイルを追加するにはマウスを離してください'
            },
            skillsPanel: {
                title: 'Skills',
                description: 'Skills はユーザー定義のナレッジモジュールです。チェックボックス：会話で有効化。スイッチ：詳細内容を AI に送信。',
                loading: '読み込み中...',
                empty: '利用可能な Skills がありません。右上のフォルダーアイコンでディレクトリを開き、SKILL.md ファイルを含むフォルダーを作成すると追加できます。',
                notExists: '存在しません',
                enableTooltip: '現在の会話でこの Skill を有効にする',
                sendContentTooltip: '有効時に Skill の内容を AI に送信する',
                hint: 'AI も toggle_skills ツールで Skill 内容を送信するかどうかを決定できます',
                openDirectory: 'Skills ディレクトリを開く',
                refresh: 'Skills リストを更新'
            },
            promptContext: {
                title: 'プロンプトコンテキスト',
                description: 'これらの内容は XML 形式でメッセージの前に付加され、AI に追加コンテキストを提供します',
                empty: 'コンテキスト内容がありません',
                emptyHint: 'ファイルをここにドラッグするか、+ をクリックしてカスタムテキストを追加',
                addText: 'カスタムテキストを追加',
                addFile: 'ファイル内容を追加',
                titlePlaceholder: 'タイトルを入力...',
                contentPlaceholder: '内容を入力...',
                typeFile: 'ファイル',
                typeText: 'テキスト',
                typeSnippet: 'スニペット',
                hint: '内容は <context> タグで囲まれて AI に送信されます',
                dropHint: 'ファイル内容を追加するにはマウスを離してください',
                fileAdded: 'ファイル内容を追加しました: {path}',
                readFailed: 'ファイルの読み取りに失敗しました',
                addFailed: '追加に失敗しました: {error}'
            },
            filePicker: {
                title: 'ファイルを選択',
                subtitle: '@ の後に入力してパスをフィルタリング',
                loading: '検索中...',
                empty: '一致するファイルが見つかりません',
                navigate: 'ナビゲート',
                select: '選択',
                close: '閉じる',
                ctrlClickHint: '@path テキストとして挿入'
            },
            notifications: {
                summarizeFailed: '要約に失敗しました: {error}',
                summarizeSuccess: '{count} 件のメッセージを正常に要約しました',
                summarizeError: '要約に失敗しました: {error}',
                holdShiftToDrag: 'Shift キーを押しながらファイルをドラッグしてください',
                fileNotInWorkspace: 'ファイルがワークスペース内にありません',
                fileNotInAnyWorkspace: 'ファイルが開いているワークスペースにありません',
                fileInOtherWorkspace: 'ファイルは別のワークスペースに属しています: {workspaceName}',
                fileAdded: 'ピン留めファイルを追加しました: {path}',
                addFailed: '追加に失敗しました: {error}',
                cannotGetFilePath: 'ファイルパスを取得できません。VSCode エクスプローラーまたはタブからドラッグしてください',
                fileNotMatchOrNotInWorkspace: 'ファイルがワークスペース内にないか、ファイル名が一致しません',
                removeFailed: '削除に失敗しました: {error}'
            }
        },

        message: {
            roles: {
                user: 'ユーザー',
                tool: 'ツール',
                assistant: 'アシスタント'
            },
            actions: {
                viewRaw: '返り値を見る'
            },
            emptyResponse: '（モデルの返答が空です）',
            stats: {
                responseDuration: '応答時間',
                tokenRate: 'トークン速度'
            },
            thought: {
                thinking: '考え中...',
                thoughtProcess: '思考プロセス'
            },
            contextBlocks: {
                clickToView: 'クリックして完全な内容を表示'
            },
            summary: {
                title: 'コンテキスト要約',
                compressed: '{count} 件のメッセージを圧縮しました',
                deleteTitle: '要約を削除'
            },
            checkpoint: {
                userMessageBefore: 'ユーザーメッセージ前のチェックポイント',
                userMessageAfter: 'ユーザーメッセージ後のチェックポイント',
                assistantMessageBefore: 'アシスタントメッセージ前のチェックポイント',
                assistantMessageAfter: 'アシスタントメッセージ後のチェックポイント',
                toolBatchBefore: 'バッチツール実行前のチェックポイント',
                toolBatchAfter: 'バッチツール実行後のチェックポイント',
                userMessageUnchanged: 'ユーザーメッセージ · 変更なし',
                assistantMessageUnchanged: 'アシスタントメッセージ · 変更なし',
                toolBatchUnchanged: 'バッチツール実行完了 · 変更なし',
                toolExecutionUnchanged: 'ツール実行完了 · 変更なし',
                restoreTooltip: 'ワークスペースをこのチェックポイントに復元',
                fileCount: '{count} 個のファイル',
                yesterday: '昨日',
                daysAgo: '{days} 日前',
                restoreConfirmTitle: 'チェックポイントを復元',
                restoreConfirmMessage: 'ワークスペースをこのチェックポイントに復元してもよろしいですか？これにより、現在のワークスペース内の対応するファイルが上書きされ、この操作は元に戻せません。',
                restoreConfirmBtn: '復元'
            },
            continue: {
                title: '会話が一時停止中',
                description: 'ツールの実行が完了しました。新しいメッセージを送信するか、「続行」をクリックして AI の応答を続けることができます',
                button: '続行'
            },
            error: {
                title: 'リクエストに失敗しました',
                retry: '再試行',
                dismiss: '閉じる'
            },
            tool: {
                parameters: 'パラメータ',
                result: '結果',
                error: 'エラー',
                paramCount: '{count} 個のパラメータ',
                streamingArgs: 'パラメータを生成中...',
                confirmExecution: 'クリックして実行を確認',
                confirm: '実行を確認',
                saveAll: 'すべて保存',
                rejectAll: 'すべて拒否',
                reject: '拒否',
                confirmed: '確認済み',
                rejected: '拒否済み',
                viewDiff: '差分を表示',
                viewDiffInVSCode: 'VSCode で差分を表示',
                openDiffFailed: 'diff プレビューを開くのに失敗しました',
                todoWrite: {
                    label: 'TODO',
                    labelWithCount: 'TODO · {count}',
                    mergePrefix: 'マージ · ',
                    description: '未着手 {pending} · 進行中 {inProgress} · 完了 {completed}'
                },
                todoUpdate: {
                    label: 'TODO 更新',
                    labelWithCount: 'TODO 更新 · {count}',
                    description: '追加 {add} · 状態 {setStatus} · 内容 {setContent} · キャンセル {cancel} · 削除 {remove}'
                },
                createPlan: {
                    label: 'プランを作成',
                    fallbackTitle: 'プラン'
                },
                todoPanel: {
                    title: 'TODO リスト',
                    modePlan: 'プラン',
                    modeUpdate: '更新',
                    modeMerge: 'マージ',
                    sourceCurrentInput: '今回のツール入力',
                    sourceSnapshot: '当時のスナップショット',
                    statusPending: '未着手',
                    statusInProgress: '進行中',
                    statusCompleted: '完了',
                    statusCancelled: 'キャンセル',
                    totalItems: '合計 {count} 件',
                    copyAsMarkdown: 'Markdown としてコピー',
                    copyMarkdown: 'Markdown をコピー',
                    copied: 'コピー済み',
                    empty: 'TODO はありません',
                    markdownCancelledSuffix: '（キャンセル）',
                    markdownInProgressSuffix: '（進行中）',
                    copyFailed: 'コピーに失敗しました'
                },
                planCard: {
                    title: 'プラン',
                    executeLabel: '実行:',
                    executed: '実行済み',
                    executing: '実行中...',
                    executePlan: 'プランを実行',
                    loadChannelsFailed: 'チャンネルの読み込みに失敗しました',
                    loadModelsFailed: 'モデルの読み込みに失敗しました',
                    executePlanFailed: 'プランの実行に失敗しました',
                    promptPrefix: '以下のプランに従って実行してください:\n\n{plan}'
                }
            },
            attachment: {
                clickToPreview: 'クリックしてプレビュー',
                removeAttachment: '添付ファイルを削除'
            }
        },

        settings: {
            title: '設定',
            tabs: {
                channel: 'チャンネル',
                tools: 'ツール',
                autoExec: '自動実行',
                mcp: 'MCP',
                subagents: 'サブエージェント',
                checkpoint: 'チェックポイント',
                summarize: '要約',
                imageGen: '画像生成',
                dependencies: '拡張機能の依存関係',
                context: 'コンテキスト',
                prompt: 'プロンプト',
                tokenCount: 'トークンカウント',
                appearance: '外観',
                general: '一般'
            },
            channelSettings: {
                selector: {
                    placeholder: '設定を選択',
                    rename: '名前を変更',
                    add: '新規設定',
                    delete: '設定を削除',
                    inputPlaceholder: '設定名を入力',
                    confirm: '確認',
                    cancel: 'キャンセル'
                },
                dialog: {
                    new: {
                        title: '新規設定',
                        nameLabel: '設定名',
                        namePlaceholder: '例：マイ Gemini',
                        typeLabel: 'API タイプ',
                        typePlaceholder: 'API タイプを選択',
                        cancel: 'キャンセル',
                        create: '作成'
                    },
                    delete: {
                        title: '設定を削除',
                        message: '設定 "{name}" を削除してもよろしいですか？この操作は元に戻せません。',
                        atLeastOne: '少なくとも 1 つの設定を保持する必要があります',
                        cancel: 'キャンセル',
                        confirm: '確認'
                    }
                },
                form: {
                    apiUrl: {
                        label: 'API URL',
                        placeholder: 'API URL を入力',
                        placeholderResponses: 'API ベースアドレスを入力してください（例：https://api.openai.com/v1）'
                    },
                    apiKey: {
                        label: 'API Key',
                        placeholder: 'API Key を入力',
                        show: '表示',
                        hide: '非表示',
                        useAuthorization: 'Authorization形式で送信',
                        useAuthorizationHintGemini: 'x-goog-api-keyをAuthorization: Bearer形式に変換して送信',
                        useAuthorizationHintAnthropic: 'x-api-keyをAuthorization: Bearer形式に変換して送信'
                    },
                    stream: {
                        label: 'ストリーム出力'
                    },
                    channelType: {
                        label: 'チャンネルタイプ',
                        gemini: 'Gemini API',
                        openai: 'OpenAI API',
                        'openai-responses': 'OpenAI Responses API',
                        anthropic: 'Anthropic API'
                    },
                    toolMode: {
                        label: 'ツール呼び出し形式',
                        placeholder: 'ツール呼び出し形式を選択',
                        functionCall: {
                            label: 'Function Calling',
                            description: 'ネイティブ関数呼び出しを使用'
                        },
                        xml: {
                            label: 'XML プロンプト',
                            description: 'XML 形式のプロンプトを使用'
                        },
                        json: {
                            label: 'JSON 境界マーカー',
                            description: 'JSON 形式 + 境界マーカーを使用（推奨）'
                        },
                        hint: {
                            functionCall: 'Function Calling: API ネイティブの関数呼び出し機能を使用',
                            xml: 'XML プロンプト: ツールを XML 形式に変換してシステムプロンプトに挿入',
                            json: 'JSON 境界マーカー: JSON 形式 + <<<TOOL_CALL>>> 境界マーカーを使用（推奨）'
                        },
                        openaiWarning: 'OpenAI Function Call モードはマルチモーダルツール（read_file で画像を読み取り、generate_image、remove_background、crop_image、resize_image、rotate_image など）をサポートしていません。マルチモーダル機能を使用するには、XML または JSON モードに切り替えてください。'
                    },
                    multimodal: {
                        label: 'マルチモーダルツールを有効化',
                        supportedTypes: 'サポートされるファイル形式：',
                        image: '画像',
                        imageFormats: 'PNG、JPEG、WebP',
                        document: 'ドキュメント',
                        documentFormats: 'PDF',
                        capabilities: 'マルチモーダルツールの機能：',
                        table: {
                            channel: 'チャンネル / モード',
                            readImage: '画像を読み取り',
                            readDocument: 'ドキュメントを読み取り',
                            generateImage: '画像を生成',
                            historyMultimodal: '履歴マルチモーダル'
                        },
                        channels: {
                            geminiAll: 'Gemini（すべて）',
                            anthropicAll: 'Anthropic（すべて）',
                            openaiXmlJson: 'OpenAI（XML/JSON）',
                            openaiResponses: 'OpenAI（Responses）',
                            openaiFunction: 'OpenAI（Function Call）'
                        },
                        legend: {
                            supported: 'サポート',
                            notSupported: '非サポート'
                        },
                        notes: {
                            requireEnable: 'このオプションを有効にすると、read_file で画像/ドキュメントを読み取り、generate_image、remove_background、crop_image、resize_image、rotate_image などのマルチモーダルツールを使用できます',
                            userAttachment: 'ユーザーが送信した添付ファイルはこの設定の影響を受けず、常にチャンネルのネイティブ機能に従って処理されます',
                            geminiAnthropic: 'Gemini / Anthropic: ツールは画像とドキュメントを直接返すことができ、画像生成機能をサポートします',
                            openaiResponses: 'OpenAI Responses：画像、PDF の読み取りをネイティブにサポートし、推論プロセスのリアルタイム表示をサポートします',
                            openaiXmlJson: 'OpenAI XML/JSON: 画像の読み取りと生成をサポートしますが、ドキュメントはサポートしていません'
                        }
                    },
                    timeout: {
                        label: 'タイムアウト (ms)',
                        placeholder: '30000'
                    },
                    maxContextTokens: {
                        label: '最大コンテキストトークン',
                        placeholder: '128000',
                        hint: 'コンテキスト使用量の表示上限値'
                    },
                    contextManagement: {
                        title: 'コンテキスト管理',
                        enableTitle: 'コンテキストしきい値検出を有効化',
                        threshold: {
                            label: 'コンテキストしきい値',
                            placeholder: '80% または 100000',
                            hint: '合計トークン数がこのしきい値を超えると、古い会話ラウンドを自動的に破棄します。パーセンテージ（例：80%）または絶対値（例：100000）の 2 つの形式をサポートしています'
                        },
                        extraCut: {
                            label: '追加カット量',
                            placeholder: '0 または 10%',
                            hint: 'トリミング時に追加でカットするトークン数。実際の保持 = しきい値 - 追加カット量。パーセンテージまたは絶対値をサポート、デフォルトは 0'
                        },
                        autoSummarize: {
                            label: '自動要約（近日公開）',
                            enableTitle: '自動要約を有効化',
                            hint: '有効にすると、古いラウンドを破棄する前に要約します（機能開発中）'
                        }
                    },
                    toolOptions: {
                        title: 'ツール設定'
                    },
                    advancedOptions: {
                        title: '詳細オプション'
                    },
                    customBody: {
                        title: 'カスタム Body',
                        enableTitle: 'カスタム Body を有効化'
                    },
                    customHeaders: {
                        title: 'カスタムヘッダー',
                        enableTitle: 'カスタムヘッダーを有効化'
                    },
                    autoRetry: {
                        title: '自動リトライ',
                        enableTitle: '自動リトライを有効化',
                        retryCount: {
                            label: 'リトライ回数',
                            hint: 'API がエラーを返した場合の最大リトライ回数（1-10）'
                        },
                        retryInterval: {
                            label: 'リトライ間隔 (ms)',
                            hint: '各リトライ間の待機時間（1000-60000 ミリ秒）'
                        }
                    },
                    enabled: {
                        label: 'この設定を有効化'
                    }
                }
            },
            tools: {
                title: 'ツール設定',
                description: '利用可能なツールを管理および設定',
                enableAll: 'すべて有効化',
                disableAll: 'すべて無効化',
                toolName: 'ツール名',
                toolDescription: 'ツールの説明',
                toolEnabled: '有効ステータス'
            },
            autoExec: {
                title: '自動実行',
                intro: {
                    title: 'ツール実行の確認',
                    description: 'AI がツールを呼び出す際にユーザーの確認が必要かどうかを設定します。チェックすると自動実行（確認不要）、チェックを外すと実行前に確認が必要です。'
                },
                actions: {
                    refresh: '更新',
                    enableAll: 'すべて自動実行',
                    disableAll: 'すべて確認必要'
                },
                status: {
                    loading: 'ツールリストを読み込み中...',
                    empty: '利用可能なツールがありません',
                    autoExecute: '自動実行',
                    needConfirm: '確認必要'
                },
                categories: {
                    file: 'ファイル操作',
                    search: '検索',
                    terminal: 'ターミナル',
                    lsp: 'コードインテリジェンス',
                    media: 'メディア処理',
                    plan: 'プラン',
                    mcp: 'MCP ツール',
                    other: 'その他'
                },
                badges: {
                    dangerous: '危険'
                },
                tips: {
                    dangerousDefault: '• 「危険」とマークされたツールは、デフォルトでユーザーの確認が必要です',
                    deleteFileWarning: '• delete_file: ファイル削除は元に戻せないため、確認を有効にすることをお勧めします',
                    executeCommandWarning: '• execute_command: ターミナルコマンドの実行はシステムに影響を与える可能性があります',
                    mcpToolsDefault: '• MCP ツール: 接続された MCP サーバーから提供され、デフォルトで自動実行されます',
                    useWithCheckpoint: '• 誤操作時に復元できるよう、チェックポイント機能と併用することをお勧めします'
                }
            },
            mcp: {
                title: 'MCP 設定',
                description: 'Model Context Protocol サーバーを設定',
                addServer: 'サーバーを追加',
                serverName: 'サーバー名',
                serverCommand: '起動コマンド',
                serverArgs: 'コマンド引数',
                serverEnv: '環境変数',
                serverStatus: 'サーバーステータス',
                connecting: '接続中',
                connected: '接続済み',
                disconnected: '切断済み',
                error: 'エラー'
            },
            checkpoint: {
                title: 'チェックポイント設定',
                loading: '設定を読み込み中...',
                sections: {
                    enable: {
                        label: 'チェックポイント機能を有効化',
                        description: 'ツール実行前後にコードベースのスナップショットを自動作成し、ワンクリックでロールバックをサポート'
                    },
                    messages: {
                        title: 'メッセージタイプのチェックポイント',
                        description: 'ユーザーメッセージとモデルメッセージのチェックポイントを作成するかどうかを選択（ツール呼び出しとは独立）',
                        beforeLabel: 'メッセージ前',
                        afterLabel: 'メッセージ後',
                        types: {
                            user: {
                                name: 'ユーザーメッセージ',
                                description: 'ユーザーが送信したメッセージ'
                            },
                            model: {
                                name: 'モデルメッセージ',
                                description: 'モデルからの応答メッセージ（ツール呼び出しを除く）'
                            }
                        },
                        options: {
                            modelOuterLayerOnly: {
                                label: 'ツールが連続して呼び出される場合、最外層にのみモデルメッセージのチェックポイントを作成',
                                hint: '有効にすると、モデルメッセージの「メッセージ前」チェックポイントは最初のイテレーションでのみ作成され、「メッセージ後」チェックポイントは最後のイテレーション（ツール呼び出しなし）でのみ作成されます。無効にすると、各イテレーションでチェックポイントが作成されます。'
                            },
                            mergeUnchanged: {
                                label: 'メッセージ前後で内容が変更されていない場合、チェックポイントをマージして表示',
                                hint: '有効にすると、メッセージ前後のチェックポイント内容が同じ場合、単一の「変更なし」チェックポイントとしてマージ表示されます。無効にすると、前後のチェックポイントは常に別々に表示されます。'
                            }
                        }
                    },
                    tools: {
                        title: 'ツールバックアップ設定',
                        description: '実行前後にバックアップが必要なツールを選択',
                        beforeLabel: '実行前',
                        afterLabel: '実行後',
                        empty: '利用可能なツールがありません'
                    },
                    other: {
                        title: 'その他の設定',
                        maxCheckpoints: {
                            label: '最大チェックポイント数',
                            placeholder: '-1',
                            hint: 'この数を超えると古いチェックポイントを自動的にクリーンアップします。-1 は無制限を意味します'
                        }
                    },
                    cleanup: {
                        title: 'チェックポイントのクリーンアップ',
                        description: '会話ごとにチェックポイントをクリーンアップしてストレージを解放',
                        searchPlaceholder: '会話タイトルを検索...',
                        loading: '読み込み中...',
                        noMatch: '一致する会話が見つかりません',
                        noCheckpoints: 'チェックポイントがありません',
                        refresh: 'リストを更新',
                        checkpointCount: '{count} 個のチェックポイント',
                        confirmDelete: {
                            title: '削除の確認',
                            message: 'すべてのチェックポイントを削除してもよろしいですか？',
                            stats: '{count} 個のチェックポイントを削除し、{size} のストレージを解放します',
                            warning: 'この操作は元に戻せません',
                            cancel: 'キャンセル',
                            delete: '削除'
                        },
                        timeFormat: {
                            justNow: 'たった今',
                            minutesAgo: '{count} 分前',
                            hoursAgo: '{count} 時間前',
                            daysAgo: '{count} 日前'
                        }
                    }
                }
            },
            summarize: {
                title: 'コンテキスト要約',
                description: '会話履歴を圧縮してトークン使用量を削減',
                enableSummarize: '要約を有効化',
                tokenThreshold: 'トークンしきい値',
                summaryModel: '要約モデル',
                summaryPrompt: '要約プロンプト'
            },
            imageGen: {
                title: '画像生成',
                description: 'AI 画像生成ツールを設定',
                enableImageGen: '画像生成を有効化',
                provider: 'プロバイダー',
                model: 'モデル',
                outputPath: '出力パス',
                maxImages: '最大画像数'
            },
            dependencies: {
                title: '拡張機能の依存関係',
                description: 'オプション機能に必要な依存関係を管理',
                installed: 'インストール済み',
                notInstalled: '未インストール',
                installing: 'インストール中',
                installFailed: 'インストール失敗',
                install: 'インストール',
                uninstall: 'アンインストール',
                required: '必須',
                optional: 'オプション'
            },
            context: {
                title: 'コンテキスト認識',
                description: 'AI に送信されるワークスペースコンテキスト情報を設定',
                includeFileTree: 'ファイルツリーを含める',
                includeOpenFiles: '開いているファイルを含める',
                includeSelection: '選択内容を含める',
                maxDepth: '最大深度',
                excludePatterns: '除外パターン',
                pinnedFiles: 'ピン留めファイル',
                addPinnedFile: 'ピン留めファイルを追加'
            },
            prompt: {
                title: 'システムプロンプト',
                description: 'システムプロンプトの構造と内容をカスタマイズ',
                systemPrompt: 'システムプロンプト',
                customPrompt: 'カスタムプロンプト',
                templateVariables: 'テンプレート変数',
                preview: 'プレビュー',
                sections: {
                    environment: '環境情報',
                    tools: 'ツール',
                    context: 'コンテキスト',
                    instructions: '指示'
                }
            },
            general: {
                title: '一般設定',
                description: '基本的な設定オプション',
                proxy: {
                    title: 'ネットワークプロキシ',
                    description: 'API リクエスト用の HTTP プロキシを設定',
                    enable: 'プロキシを有効化',
                    url: 'プロキシ URL',
                    urlPlaceholder: 'http://127.0.0.1:7890',
                    urlError: '有効なプロキシアドレス（http:// または https://）を入力してください'
                },
                language: {
                    title: 'インターフェース言語',
                    description: '表示言語を選択',
                    auto: 'システムに従う',
                    autoDescription: 'VS Code の言語設定に自動的に従う'
                },
                appInfo: {
                    title: 'アプリケーション情報',
                    name: 'LimCode - Vibe Coding アシスタント',
                    version: 'バージョン',
                    repository: 'リポジトリ',
                    developer: '開発者'
                }
            },
            contextSettings: {
                loading: '読み込み中...',
                workspaceFiles: {
                    title: 'ワークスペースファイルツリー',
                    description: 'ワークスペースのディレクトリ構造を AI に送信',
                    sendFileTree: 'ワークスペースファイルツリーを送信',
                    maxDepth: '最大深度',
                    unlimitedHint: '-1 は無制限を意味します'
                },
                openTabs: {
                    title: '開いているタブ',
                    description: '現在開いているファイルリストを AI に送信',
                    sendOpenTabs: '開いているタブを送信',
                    maxCount: '最大数'
                },
                activeEditor: {
                    title: '現在のアクティブエディター',
                    description: '現在編集中のファイルパスを AI に送信',
                    sendActiveEditor: '現在のアクティブエディターのパスを送信'
                },
                diagnostics: {
                    title: '診断情報',
                    description: 'ワークスペースのエラー、警告などの診断情報を AI に送信して、コードの問題を修正します',
                    enableDiagnostics: '診断情報を有効化',
                    severityTypes: '問題の種類',
                    severity: {
                        error: 'エラー',
                        warning: '警告',
                        information: '情報',
                        hint: 'ヒント'
                    },
                    workspaceOnly: 'ワークスペース内のファイルのみ',
                    openFilesOnly: '開いているファイルのみ',
                    maxPerFile: 'ファイルあたりの最大数',
                    maxFiles: '最大ファイル数'
                },
                ignorePatterns: {
                    title: '無視パターン',
                    description: '一致するファイル/フォルダーはコンテキストに表示されません（ワイルドカードをサポート）',
                    removeTooltip: '削除',
                    emptyHint: 'カスタム無視パターンがありません',
                    inputPlaceholder: 'パターンを入力、例: **/node_modules, *.log',
                    addButton: '追加',
                    helpTitle: 'ワイルドカードのヘルプ:',
                    helpItems: {
                        wildcard: '* - 任意の文字に一致（パス区切りを除く）',
                        recursive: '** - 任意のディレクトリレベルに一致',
                        examples: '例: **/node_modules, *.log, .git'
                    }
                },
                preview: {
                    title: '現在の状態プレビュー',
                    autoRefreshBadge: 'リアルタイム更新',
                    description: 'AI に送信されるコンテキスト情報のプレビュー（2 秒ごとに自動更新）',
                    activeEditorLabel: '現在のアクティブエディター：',
                    openTabsLabel: '開いているタブ（{count} 個）：',
                    noValue: 'なし',
                    moreItems: '... さらに {count} 個'
                },
                saveSuccess: '保存しました',
                saveFailed: '保存に失敗しました'
            },
            dependencySettings: {
                title: '拡張機能の依存関係管理',
                description: 'オプションの拡張機能に必要な依存関係を管理します。これらの依存関係はローカルファイルシステムにインストールされ、プラグインにはパッケージ化されません。',
                installPath: 'インストールパス：',
                installed: 'インストール済み',
                installing: 'インストール中...',
                uninstalling: 'アンインストール中...',
                install: 'インストール',
                uninstall: 'アンインストール',
                estimatedSize: '約 {size}MB',
                empty: '依存関係を必要とするツールがありません',
                progress: {
                    processing: '{dependency} を処理中...',
                    complete: '{dependency} の処理が完了しました',
                    failed: '{dependency} の処理に失敗しました',
                    installSuccess: '{name} のインストールが成功しました！',
                    installFailed: '{name} のインストールに失敗しました',
                    uninstallSuccess: '{name} がアンインストールされました',
                    uninstallFailed: '{name} のアンインストールに失敗しました',
                    unknownError: '不明なエラー'
                },
                panel: {
                    installedCount: '{installed}/{total}'
                }
            },
            generateImageSettings: {
                description: '画像生成ツールにより、AI は画像生成モデルを呼び出して画像を作成できます。生成された画像はワークスペースに保存され、マルチモーダル形式で AI に返されて表示されます。',
                api: {
                    title: 'API 設定',
                    url: 'API URL',
                    urlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
                    urlHint: '画像生成 API のベース URL',
                    apiKey: 'API Key',
                    apiKeyPlaceholder: 'API Key を入力',
                    apiKeyHint: '画像生成 API のシークレットキー',
                    model: 'モデル名',
                    modelPlaceholder: 'gemini-3-pro-Image-preview',
                    modelHint: '例: gemini-3-pro-Image-preview',
                    show: '表示',
                    hide: '非表示'
                },
                aspectRatio: {
                    title: 'アスペクト比パラメータ',
                    enable: 'アスペクト比パラメータを有効化',
                    fixedRatio: '固定アスペクト比',
                    placeholder: '固定しない（AI が選択可能）',
                    options: {
                        auto: '自動',
                        square: '正方形',
                        landscape: '横長',
                        portrait: '縦長',
                        mobilePortrait: 'モバイル縦画面',
                        widescreen: 'ワイドスクリーン',
                        ultrawide: 'ウルトラワイド'
                    },
                    hints: {
                        disabled: '無効時：AI はこのパラメータを設定できず、API 呼び出しにこのパラメータは含まれません',
                        fixed: '固定：AI は {ratio} に固定されることが通知され、変更できません',
                        flexible: '固定しない：AI は aspect_ratio パラメータを使用して選択できます'
                    }
                },
                imageSize: {
                    title: '画像サイズパラメータ',
                    enable: '画像サイズパラメータを有効化',
                    fixedSize: '固定画像サイズ',
                    placeholder: '固定しない（AI が選択可能）',
                    options: {
                        auto: '自動'
                    },
                    hints: {
                        disabled: '無効時：AI はこのパラメータを設定できず、API 呼び出しにこのパラメータは含まれません',
                        fixed: '固定：AI は {size} に固定されることが通知され、変更できません',
                        flexible: '固定しない：AI は image_size パラメータを使用して選択できます'
                    }
                },
                batch: {
                    title: 'バッチ生成制限',
                    maxTasks: '最大バッチタスク数',
                    maxTasksHint: 'AI の 1 回の呼び出しで許可される最大タスク数（異なるプロンプトの画像）。範囲 1-20。',
                    maxImagesPerTask: 'タスクあたりの最大画像数',
                    maxImagesPerTaskHint: '各タスク（単一のプロンプト）で保存される最大画像数。範囲 1-10。',
                    summary: '現在の設定：AI は 1 回の呼び出しで最大 {maxTasks} タスクを開始でき、各タスクで最大 {maxImages} 枚の画像を保存できます'
                },
                usage: {
                    title: '使用方法',
                    step1: '上記の API URL、API Key、モデル名を設定',
                    step2: 'ツールが「ツール設定」で有効になっていることを確認',
                    step3: '会話で AI に generate_image ツールを呼び出して画像を生成させる',
                    step4: '生成された画像はワークスペースの generated_images ディレクトリに保存されます',
                    warning: '画像生成機能を使用する前に API Key を設定してください'
                }
            },
            mcpSettings: {
                toolbar: {
                    addServer: 'サーバーを追加',
                    editJson: 'JSON を編集',
                    refresh: '更新'
                },
                loading: '読み込み中...',
                empty: {
                    title: 'MCP サーバーがありません',
                    description: '「サーバーを追加」ボタンをクリックして、最初の MCP サーバーを設定してください'
                },
                serverCard: {
                    connect: '接続',
                    disconnect: '切断',
                    connecting: '接続中...',
                    edit: '編集',
                    delete: '削除',
                    tools: 'ツール',
                    resources: 'リソース',
                    prompts: 'プロンプト'
                },
                status: {
                    connected: '接続済み',
                    connecting: '接続中...',
                    error: '接続エラー',
                    disconnected: '未接続'
                },
                form: {
                    addTitle: 'MCP サーバーを追加',
                    editTitle: 'MCP サーバーを編集',
                    serverId: 'サーバー ID',
                    serverIdPlaceholder: 'オプション、空白の場合は自動生成',
                    serverIdHint: '英数字、アンダースコア、ハイフンのみ使用可能、JSON 設定でサーバーを識別するために使用',
                    serverIdError: 'ID には英数字、アンダースコア、ハイフンのみ使用できます',
                    serverName: 'サーバー名',
                    serverNamePlaceholder: '例: マイ MCP サーバー',
                    description: '説明',
                    descriptionPlaceholder: 'オプションの説明',
                    required: '*',
                    transportType: 'トランスポートタイプ',
                    command: 'コマンド',
                    commandPlaceholder: '例: npx, python, node',
                    args: '引数',
                    argsPlaceholder: 'スペース区切り、例: -m mcp_server',
                    env: '環境変数 (JSON)',
                    envPlaceholder: '{"KEY": "value"}',
                    url: 'URL',
                    urlPlaceholderSse: 'https://example.com/sse',
                    urlPlaceholderHttp: 'https://example.com/mcp',
                    headers: 'ヘッダー (JSON)',
                    headersPlaceholder: '{"Authorization": "Bearer token"}',
                    options: 'オプション',
                    enabled: '有効',
                    autoConnect: '自動接続',
                    cleanSchema: 'スキーマをクリーンアップ',
                    cleanSchemaHint: 'JSON Schema から互換性のないフィールド（$schema、additionalProperties など）を削除します。一部の API（Gemini など）ではこのオプションを有効にする必要があります',
                    timeout: '接続タイムアウト (ms)',
                    cancel: 'キャンセル',
                    create: '作成',
                    save: '保存'
                },
                validation: {
                    nameRequired: 'サーバー名を入力してください',
                    idInvalid: 'ID が無効です',
                    idChecking: 'ID を検証中、お待ちください',
                    commandRequired: 'コマンドを入力してください',
                    urlRequired: 'URL を入力してください',
                    createFailed: '作成に失敗しました',
                    updateFailed: '更新に失敗しました'
                },
                delete: {
                    title: 'MCP サーバーを削除',
                    message: 'サーバー "{name}" を削除してもよろしいですか？この操作は元に戻せません。',
                    confirm: '削除',
                    cancel: 'キャンセル'
                }
            },
            subagents: {
                selectAgent: 'サブエージェントを選択',
                noAgents: 'サブエージェントなし',
                create: '作成',
                rename: '名前を変更',
                delete: '削除',
                disabled: '無効',
                enabled: 'このサブエージェントを有効化',
                globalConfig: 'グローバル設定',
                maxConcurrentAgents: '最大同時実行数',
                maxConcurrentAgentsHint: 'AI が一度に呼び出せるサブエージェントの最大数（-1 で無制限）',
                basicInfo: '基本情報',
                description: '説明',
                descriptionPlaceholder: 'メイン AI がこのサブエージェントを使用すべき状況を説明',
                maxIterations: '最大イテレーション数',
                maxIterationsHint: 'このサブエージェントの最大ツール呼び出し回数（-1 で無制限）',
                maxRuntime: '最大実行時間',
                maxRuntimeHint: '最大実行時間（秒、-1 で無制限）',
                systemPrompt: 'システムプロンプト',
                systemPromptPlaceholder: 'サブエージェントのシステムプロンプトを入力...',
                channelModel: 'チャンネルとモデル',
                channel: 'チャンネル',
                selectChannel: 'チャンネルを選択',
                model: 'モデル',
                selectModel: 'モデルを選択',
                tools: 'ツール設定',
                toolsDescription: 'このサブエージェントが使用できるツールを設定',
                toolMode: {
                    label: 'ツールモード',
                    all: 'すべてのツール',
                    builtin: '組み込みのみ',
                    mcp: 'MCP のみ',
                    whitelist: 'ホワイトリスト',
                    blacklist: 'ブラックリスト'
                },
                builtinTools: '組み込みツール',
                mcpTools: 'MCP ツール',
                noTools: '利用可能なツールなし',
                whitelistHint: 'チェックされたツールのみ使用可能',
                blacklistHint: 'チェックされたツールはブロックされます',
                emptyState: 'サブエージェントがまだありません。下のボタンをクリックして作成してください',
                createFirst: 'サブエージェントを作成',
                deleteConfirm: {
                    title: 'サブエージェントを削除',
                    message: 'このサブエージェントを削除してもよろしいですか？この操作は元に戻せません。'
                },
                createDialog: {
                    title: 'サブエージェントを作成',
                    nameLabel: '名前',
                    namePlaceholder: '例：コードレビューエキスパート',
                    nameRequired: 'サブエージェントの名前を入力してください',
                    nameDuplicate: '同じ名前のサブエージェントが既に存在します'
                }
            },
            modelManager: {
                title: 'モデルリスト',
                fetchModels: 'モデルを取得',
                clearAll: 'すべてクリア',
                clearAllTooltip: 'すべてのモデルをクリア',
                empty: 'モデルがありません。「モデルを取得」をクリックするか、手動で追加してください',
                addPlaceholder: 'モデル ID を手動入力',
                addTooltip: '追加',
                removeTooltip: '削除',
                enabledTooltip: '現在有効なモデル',
                filterPlaceholder: 'モデルをフィルター...',
                clearFilter: 'フィルターをクリア',
                noResults: '一致するモデルがありません',
                clearDialog: {
                    title: 'すべてのモデルをクリア',
                    message: 'すべての {count} モデルをクリアしてもよろしいですか？この操作は元に戻せません。',
                    confirm: 'クリア',
                    cancel: 'キャンセル'
                },
                errors: {
                    addFailed: 'モデルの追加に失敗しました',
                    removeFailed: 'モデルの削除に失敗しました',
                    setActiveFailed: 'アクティブモデルの設定に失敗しました'
                }
            },
            modelSelectionDialog: {
                title: '追加するモデルを選択',
                selectAll: 'すべて選択',
                deselectAll: 'すべて解除',
                close: '閉じる',
                loading: '読み込み中...',
                error: 'モデルリストの読み込みに失敗しました',
                retry: '再試行',
                empty: '利用可能なモデルがありません',
                added: '追加済み',
                selectionCount: '{count} モデルを選択',
                cancel: 'キャンセル',
                add: '追加 ({count})',
                filterPlaceholder: 'モデルを絞り込み...',
                clearFilter: 'フィルタをクリア',
                noResults: '一致するモデルがありません'
            },
            promptSettings: {
                loading: '読み込み中...',
                enable: 'カスタムシステムプロンプトテンプレートを有効化',
                enableDescription: '有効にすると、モジュールプレースホルダーを使用してシステムプロンプトの構造と内容をカスタマイズできます',
                modes: {
                    label: 'プロンプトモード',
                    add: 'モードを追加',
                    rename: '名前変更',
                    delete: 'モードを削除',
                    confirmDelete: 'このモードを削除してもよろしいですか？この操作は取り消しできません。',
                    cannotDeleteDefault: 'デフォルトモードは削除できません',
                    unsavedChanges: '現在のモードには未保存の変更があります。破棄して切り替えてもよろしいですか？',
                    newModeName: '新しいモードの名前を入力してください',
                    newModeDefault: '新しいモード',
                    renameModePrompt: '新しいモード名を入力してください'
                },
                templateSection: {
                    title: 'システムプロンプトテンプレート',
                    resetButton: 'デフォルトにリセット',
                    description: 'システムプロンプトを直接記述し、{{$VARIABLE}} 形式で変数を参照します。送信時に実際の内容に置き換えられます',
                    placeholder: 'システムプロンプトを入力、{{$ENVIRONMENT}} などの変数を使用できます...'
                },
                staticSection: {
                    title: '静的システムプロンプト',
                    description: 'システムプロンプトに含まれ、内容は比較的安定しており、APIプロバイダーによるキャッシュで応答を高速化できます。{{$VARIABLE}} 形式で静的変数を参照します。',
                    placeholder: '静的システムプロンプトを入力、{{$ENVIRONMENT}}、{{$TOOLS}} などの変数を使用できます...'
                },
                dynamicSection: {
                    title: '動的コンテキストテンプレート',
                    description: '各リクエスト時に動的に生成されメッセージ末尾に追加されます。リアルタイム情報（時刻、ファイルツリー、タブなど）を含み、履歴には保存されません。',
                    placeholder: '動的コンテキストテンプレートを入力、{{$WORKSPACE_FILES}}、{{$OPEN_TABS}} などの変数を使用できます...',
                    enableTooltip: '動的コンテキストテンプレートを有効/無効にする',
                    disabledNotice: '動的コンテキストテンプレートは無効です。AI に動的コンテキストメッセージは送信されません。'
                },
                toolPolicy: {
                    title: 'ツールポリシー',
                    description: 'このモードで利用可能なツールを制限します。未設定の場合は Code モードのツールセットを継承します（全体のツールスイッチも適用されます）。',
                    inherit: '継承（デフォルト）',
                    custom: 'カスタム（許可リスト）',
                    inheritHint: 'このモードは Code モードのツールセットを継承します。',
                    searchPlaceholder: 'ツールを検索…',
                    selectAll: 'すべて選択',
                    clear: 'クリア',
                    loadingTools: 'ツール一覧を読み込み中...',
                    noTools: '利用可能なツールがありません',
                    disabledBadge: '無効',
                    emptyWarning: 'カスタムツールリストが有効ですが、ツールが選択されていません。',
                    emptyCannotSave: 'カスタムツールリストには少なくとも 1 つのツールを選択してください'
                },
                saveButton: '設定を保存',
                saveSuccess: '保存しました',
                saveFailed: '保存に失敗しました',
                tokenCount: {
                    label: 'トークン数',
                    staticLabel: '静的テンプレート',
                    dynamicLabel: '動的コンテキスト',
                    staticTooltip: '静的テンプレート自体のトークン数（{{$TOOLS}} などのプレースホルダーの実際のコンテンツは含まれません）',
                    dynamicTooltip: '動的コンテキストの実際のトークン数（ファイルツリー、診断などの実際のコンテンツを含む）',
                    channelTooltip: 'トークン計算に使用するチャンネルを選択',
                    refreshTooltip: 'トークン数を更新',
                    failed: 'カウント失敗',
                    hint: '静的テンプレートはテンプレート自体、動的コンテキストは実際に入力されたコンテンツです。実際のリクエストにはツール定義なども含まれます。'
                },
                modulesReference: {
                    title: '利用可能な変数リファレンス',
                    insertTooltip: 'テンプレートの末尾に挿入'
                },
                staticModules: {
                    title: '静的変数',
                    badge: 'キャッシュ可能',
                    description: 'これらの変数はシステムプロンプトに含まれ、内容は比較的安定しており、APIプロバイダーによるキャッシュで応答を高速化できます。'
                },
                dynamicModules: {
                    title: '動的変数',
                    badge: 'リアルタイム',
                    description: 'これらの変数は最後のメッセージにコンテキストとして動的に挿入され、現在時刻やファイル状態などのリアルタイム情報を含み、会話履歴には保存されません。'
                },
                modules: {
                    ENVIRONMENT: {
                        name: '環境情報',
                        description: 'ワークスペースパス、オペレーティングシステム、現在時刻、タイムゾーン情報を含みます'
                    },
                    WORKSPACE_FILES: {
                        name: 'ワークスペースファイルツリー',
                        description: 'ワークスペース内のファイルとディレクトリ構造をリストします。コンテキスト認識設定の深度と無視パターンの影響を受けます',
                        requiresConfig: 'コンテキスト認識 > ワークスペースファイルツリーを送信'
                    },
                    OPEN_TABS: {
                        name: '開いているタブ',
                        description: 'エディターで現在開いているファイルタブをリストします',
                        requiresConfig: 'コンテキスト認識 > 開いているタブを送信'
                    },
                    ACTIVE_EDITOR: {
                        name: 'アクティブエディター',
                        description: '現在編集中のファイルのパスを表示します',
                        requiresConfig: 'コンテキスト認識 > アクティブエディターを送信'
                    },
                    DIAGNOSTICS: {
                        name: '診断情報',
                        description: 'ワークスペースのエラー、警告などの診断情報を表示し、AI がコードの問題を修正するのを助けます',
                        requiresConfig: 'コンテキスト認識 > 診断情報を有効化'
                    },
                    PINNED_FILES: {
                        name: 'ピン留めファイルの内容',
                        description: 'ユーザーがピン留めしたファイルの完全な内容を表示します',
                        requiresConfig: '入力ボックス横のピン留めファイルボタンでファイルを追加する必要があります'
                    },
                    SKILLS: {
                        name: 'Skills の内容',
                        description: '現在有効な Skills の内容を表示します。Skills はユーザー定義のナレッジモジュールで、AI が toggle_skills ツールで動的に有効/無効にできます。',
                        requiresConfig: 'AI が toggle_skills ツールで skills を有効にします'
                    },
                    TOOLS: {
                        name: 'ツール定義',
                        description: 'チャンネル設定に基づいて XML または Function Call 形式でツール定義を生成します（この変数はシステムによって自動的に入力されます）'
                    },
                    MCP_TOOLS: {
                        name: 'MCP ツール',
                        description: 'MCP サーバーからの追加ツール定義（この変数はシステムによって自動的に入力されます）',
                        requiresConfig: 'MCP 設定でサーバーを設定して接続する必要があります'
                    }
                },
                exampleOutput: '出力例：',
                requiresConfigLabel: '必要な設定：'
            },
            summarizeSettings: {
                description: 'コンテキスト要約機能は会話履歴を圧縮してトークン使用量を削減できます。会話が長くなりすぎた場合、手動または自動で要約をトリガーして、古い会話内容を要約に圧縮できます。',
                manualSection: {
                    title: '手動要約',
                    description: '入力ボックスの右側にある圧縮ボタンをクリックすると、手動でコンテキスト要約をトリガーできます。要約された内容は元の会話履歴を置き換えます。'
                },
                autoSection: {
                    title: '自動要約',
                    comingSoon: '近日公開',
                    enable: '自動要約を有効化',
                    enableHint: 'トークン使用量がしきい値を超えたときに自動的に要約をトリガー',
                    threshold: 'トリガーしきい値',
                    thresholdUnit: '%',
                    thresholdHint: 'トークン使用量がこのパーセンテージに達したときに自動要約をトリガー'
                },
                optionsSection: {
                    title: '要約オプション',
                    keepRounds: '最近のラウンドを保持',
                    keepRoundsUnit: 'ラウンド',
                    keepRoundsHint: '最近の N ラウンドの会話を要約から除外し、コンテキストの連続性を確保',
                    prompt: '要約プロンプト',
                    promptPlaceholder: '要約時に使用するプロンプトを入力...',
                    promptHint: 'AI が要約を実行する際に使用する指示'
                },
                modelSection: {
                    title: '専用要約モデル',
                    useSeparate: '専用要約モデルを使用',
                    useSeparateHint: '有効にすると、要約は会話で使用するモデルではなく、以下で指定したモデルを使用します。\nコストを節約するために、より安価なモデルを選択できます。',
                    currentModelHint: '現在、会話モデルを要約に使用しています',
                    selectChannel: 'チャンネルを選択',
                    selectChannelPlaceholder: '要約用のチャンネルを選択',
                    selectChannelHint: '有効なチャンネルのみ表示されます',
                    selectModel: 'モデルを選択',
                    selectModelPlaceholder: '要約用のモデルを選択',
                    selectModelHint: 'このチャンネルの設定に追加されたモデルのみ表示されます。\nモデルを追加するには、チャンネル設定に移動して設定してください。',
                    warningHint: 'チャンネルとモデルを選択してください。そうしないと、会話モデルが要約に使用されます'
                }
            },
            settingsPanel: {
                title: '設定',
                backToChat: '会話に戻る',
                sections: {
                    channel: {
                        title: 'チャンネル設定',
                        description: 'API チャンネルとモデルを設定'
                    },
                    tools: {
                        title: 'ツール設定',
                        description: '利用可能なツールを管理および設定'
                    },
                    autoExec: {
                        title: '自動実行',
                        description: 'ツール実行時の確認動作を設定'
                    },
                    mcp: {
                        title: 'MCP 設定',
                        description: 'Model Context Protocol サーバーを設定'
                    },
                    checkpoint: {
                        title: 'チェックポイント設定',
                        description: 'コードベースのスナップショットバックアップとロールバックを設定'
                    },
                    summarize: {
                        title: 'コンテキスト要約',
                        description: '会話履歴を圧縮してトークン使用量を削減'
                    },
                    imageGen: {
                        title: '画像生成',
                        description: 'AI 画像生成ツールを設定'
                    },
                    context: {
                        title: 'コンテキスト認識',
                        description: 'AI に送信されるワークスペースコンテキスト情報を設定'
                    },
                    prompt: {
                        title: 'システムプロンプト',
                        description: 'システムプロンプトの構造と内容をカスタマイズ'
                    },
                    tokenCount: {
                        title: 'トークンカウント',
                        description: 'トークン数を計算するための API を設定'
                    },
                    subagents: {
                        title: 'サブエージェント',
                        description: 'AI が呼び出せる専門サブエージェントを設定'
                    },
                    appearance: {
                        title: '外観',
                        description: 'UI の外観に関する設定'
                    },
                    general: {
                        title: '一般設定',
                        description: '基本的な設定オプション'
                    }
                },
                proxy: {
                    title: 'ネットワークプロキシ',
                    description: 'API リクエスト用の HTTP プロキシを設定',
                    enable: 'プロキシを有効化',
                    url: 'プロキシアドレス',
                    urlPlaceholder: 'http://127.0.0.1:7890',
                    urlError: '有効なプロキシアドレス（http:// または https://）を入力してください',
                    save: '保存',
                    saveSuccess: '保存しました',
                    saveFailed: '保存に失敗しました'
                },
                language: {
                    title: 'インターフェース言語',
                    description: '表示言語を選択',
                    placeholder: '言語を選択',
                    autoDescription: 'VS Code の言語設定に自動的に従う'
                },
                appInfo: {
                    title: 'アプリケーション情報',
                    name: 'Lim Code - Vibe Coding アシスタント',
                    version: 'バージョン：1.0.84',
                    repository: 'リポジトリ',
                    developer: '開発者'
                }
            },
            toolSettings: {
                files: {
                    applyDiff: {
                        autoApply: '変更を自動適用',
                        enableAutoApply: '自動適用を有効化',
                        enableAutoApplyDesc: '有効にすると、AI の変更は指定された遅延後に自動的に保存され、手動確認は不要です',
                        autoSaveDelay: '自動保存遅延',
                        delayTime: '遅延時間',
                        delayTimeDesc: '変更が表示されてから自動保存するまでの待機時間',
                        delay1s: '1 秒',
                        delay2s: '2 秒',
                        delay3s: '3 秒',
                        delay5s: '5 秒',
                        delay10s: '10 秒',
                        infoEnabled: '現在の設定：AI がファイルを変更すると、{delay} 後に自動的に保存され、実行が続行されます。',
                        infoDisabled: '現在の設定：AI がファイルを変更した後、エディターで Ctrl+S を手動で押して変更を確認して保存する必要があります。',

                        format: '差分形式',
                        formatDesc: 'AI が apply_diff を呼び出すときのパラメータ形式を選択します（デフォルトは統一 diff 推奨）',
                        formatUnified: '統一 diff（unified diff patch）',
                        formatSearchReplace: '旧形式（search/replace）'
                    },
                    listFiles: {
                        ignoreList: '無視リスト',
                        ignoreListHint: '（ワイルドカードをサポート、例: *.log, temp*）',
                        inputPlaceholder: '無視するファイルまたはディレクトリパターンを入力...',
                        deleteTooltip: '削除',
                        addButton: '追加'
                    }
                },
                search: {
                    findFiles: {
                        excludeList: '除外パターン',
                        excludeListHint: '（glob 形式、例: **/node_modules/**）',
                        inputPlaceholder: '除外するファイルまたはディレクトリパターンを入力...',
                        deleteTooltip: '削除',
                        addButton: '追加'
                    },
                    searchInFiles: {
                        excludeList: '除外パターン',
                        excludeListHint: '（glob 形式、例: **/node_modules/**）',
                        inputPlaceholder: '除外するファイルまたはディレクトリパターンを入力...',
                        deleteTooltip: '削除',
                        addButton: '追加'
                    }
                },
                terminal: {
                    executeCommand: {
                        shellEnv: 'シェル環境',
                        defaultBadge: 'デフォルト',
                        available: '利用可能',
                        unavailable: '利用不可',
                        setDefaultTooltip: 'デフォルトに設定',
                        executablePath: '実行ファイルパス（オプション）：',
                        executablePathPlaceholder: '空白の場合、システム PATH のパスを使用',
                        execTimeout: '実行タイムアウト',
                        timeoutHint: 'この時間を超えるコマンドは自動的に終了されます',
                        timeout30s: '30 秒',
                        timeout1m: '1 分',
                        timeout2m: '2 分',
                        timeout5m: '5 分',
                        timeout10m: '10 分',
                        timeoutUnlimited: '無制限',
                        maxOutputLines: '最大出力行数',
                        maxOutputLinesHint: 'AI に送信されるターミナル出力の最後の N 行、出力過多を避けるため',
                        unlimitedLines: '無制限',
                        tips: {
                            onlyEnabledUsed: '• 有効で利用可能なシェルのみが AI で使用されます',
                            statusMeaning: '• ✓ は利用可能、✗ は利用不可を意味します',
                            windowsRecommend: '• Windows では PowerShell の使用をお勧めします（UTF-8 をサポート）',
                            gitBashRequire: '• Git Bash には Git for Windows のインストールが必要です',
                            wslRequire: '• WSL には Windows Subsystem for Linux の有効化が必要です',
                            confirmSettings: '• 実行確認の設定については、「自動実行」設定タブに移動してください'
                        }
                    }
                },
                media: {
                    common: {
                        returnImageToAI: '画像を直接 AI に返す',
                        returnImageDesc: '有効にすると、処理結果の画像 base64 がツールレスポンスとして直接 AI に返され、AI は画像コンテンツを直接表示・分析できます。',
                        returnImageDescDetail: '無効にすると、テキスト説明（ファイルパスなど）のみが返され、AI が画像を表示するには read_file ツールを呼び出す必要があります。'
                    },
                    cropImage: {
                        title: '画像のトリミング',
                        description: '有効にすると、AI はトリミング効果を直接確認し、領域が正しいかどうかを判断できます。無効にするとトークン消費を節約できます。'
                    },
                    generateImage: {
                        title: '画像生成',
                        description: '有効にすると、AI は生成された画像効果を直接確認し、再生成や調整が必要かどうかを判断できます。無効にするとトークン消費を節約できます。'
                    },
                    removeBackground: {
                        title: '背景除去',
                        description: '有効にすると、AI は背景除去効果を直接確認し、主題の説明の調整や再処理が必要かどうかを判断できます。無効にするとトークン消費を節約できます。'
                    },
                    resizeImage: {
                        title: '画像のリサイズ',
                        description: '有効にすると、AI はリサイズ効果を直接確認し、サイズが適切かどうかを判断できます。無効にするとトークン消費を節約できます。'
                    },
                    rotateImage: {
                        title: '画像の回転',
                        description: '有効にすると、AI は回転効果を直接確認し、角度が正しいかどうかを判断できます。無効にするとトークン消費を節約できます。'
                    }
                },
                common: {
                    loading: '読み込み中...',
                    loadingConfig: '設定を読み込み中...',
                    saving: '保存中...',
                    error: 'エラー',
                    retry: '再試行'
                }
            },
            toolsSettings: {
                maxIterations: {
                    label: 'ターンあたりの最大ツール呼び出し回数',
                    hint: 'AI の無限ツール呼び出しループを防止、-1 で無制限',
                    unit: '回'
                },
                actions: {
                    refresh: '更新',
                    enableAll: 'すべて有効化',
                    disableAll: 'すべて無効化'
                },
                loading: 'ツールリストを読み込み中...',
                empty: '利用可能なツールがありません',
                categories: {
                    file: 'ファイル操作',
                    search: '検索',
                    terminal: 'ターミナル',
                    lsp: 'コードインテリジェンス',
                    media: 'メディア処理',
                    plan: 'プラン',
                    todo: 'TODO',
                    other: 'その他'
                },
                dependency: {
                    required: '依存関係が必要',
                    requiredTooltip: 'このツールを使用するには依存関係のインストールが必要です',
                    disabledTooltip: 'ツールが無効か、依存関係が不足しています'
                },
                config: {
                    tooltip: 'ツールを設定'
                }
            },
            tokenCountSettings: {
                description: '正確なトークン数を計算するための API を設定します。有効にすると、リクエストを送信する前に対応するチャンネルのトークンカウント API を呼び出して、より正確なコンテキスト管理のために正確なトークン数を取得します。',
                hint: '設定されていないか、API 呼び出しが失敗した場合は、推定方法にフォールバックします。',
                enableChannel: 'このチャンネルのトークンカウントを有効化',
                baseUrl: 'API URL',
                apiKey: 'API Key',
                apiKeyPlaceholder: 'API Key を入力',
                model: 'モデル名',
                geminiUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens?key={key}',
                geminiUrlHint: '{model} と {key} をプレースホルダーとして使用',
                geminiModelPlaceholder: 'gemini-2.5-pro',
                anthropicUrlPlaceholder: 'https://api.anthropic.com/v1/messages/count_tokens',
                anthropicModelPlaceholder: 'claude-sonnet-4-5',
                comingSoon: '近日公開',
                customApi: 'カスタム API',
                openaiDocTitle: 'OpenAI 互換 API インターフェース',
                openaiDocDesc: 'OpenAI はスタンドアロンのトークンカウント API を提供していません。自己ホスティングまたはサードパーティの互換トークンカウントサービスがある場合は、ここで設定できます。',
                openaiUrlPlaceholder: 'https://your-api.example.com/count-tokens',
                openaiUrlHint: 'カスタムトークンカウント API エンドポイント',
                openaiModelPlaceholder: 'gpt-4o',
                apiDocumentation: 'API 仕様',
                requestExample: 'リクエスト例',
                requestBody: '// リクエストボディ',
                responseFormat: '// レスポンス形式',
                openaiDocNote: 'API は total_tokens フィールドを含む JSON レスポンスを返す必要があります。リクエストボディは OpenAI Messages 形式を使用します。',
                saveSuccess: '設定を保存しました',
                saveFailed: '保存に失敗しました'
            },
            appearanceSettings: {
                loadingText: {
                    title: 'ストリーミング Loading テキスト',
                    description: 'AI がストリーミング出力中に、メッセージ下部のアニメーション指示器に表示されるテキストです。',
                    placeholder: '例：考え中…',
                    defaultHint: '空欄の場合は既定値を使用：{text}'
                },
                saveSuccess: '保存しました',
                saveFailed: '保存に失敗しました'
            },
            storageSettings: {
                title: 'ストレージパス',
                description: '会話履歴、チェックポイントなどのデータの保存場所を設定',
                currentPath: '現在のストレージパス',
                customPath: 'カスタムパス',
                customPathPlaceholder: 'カスタムストレージパスを入力...',
                customPathHint: '空白の場合はデフォルトパス（拡張機能ストレージディレクトリ）を使用',
                browse: '参照',
                apply: '適用',
                reset: 'デフォルトにリセット',
                migrate: 'データを移行',
                migrateHint: '既存のデータを新しいパスに移行',
                migrating: '移行中...',
                validating: '検証中...',
                validation: {
                    valid: 'パスは有効です',
                    invalid: 'パスは無効です',
                    checking: '確認中...'
                },
                dialog: {
                    migrateTitle: 'データ移行の確認',
                    migrateMessage: '既存のデータを新しいパスに移行しますか？すべての会話履歴とチェックポイントがコピーされます。',
                    migrateWarning: '移行中はウィンドウを閉じないでください',
                    confirm: '移行を確認',
                    cancel: 'キャンセル'
                },
                notifications: {
                    pathUpdated: 'ストレージパスが更新されました',
                    pathReset: 'ストレージパスがデフォルトにリセットされました',
                    migrationSuccess: 'データ移行が完了しました。変更を有効にするにはウィンドウを再読み込みしてください',
                    migrationFailed: 'データ移行に失敗しました: {error}',
                    validationFailed: 'パスの検証に失敗しました: {error}'
                },
                reloadWindow: 'ウィンドウを再読み込み'
            }
        },

        channels: {
            common: {
                temperature: {
                    label: '温度 (Temperature)',
                    hint: '0.0 - 1.0、デフォルト 1.0',
                    toggleHint: '有効にすると、このパラメータが API に送信されます'
                },
                maxTokens: {
                    label: '最大出力トークン',
                    placeholder: '4096',
                    toggleHint: '有効にすると、このパラメータが API に送信されます'
                },
                topP: {
                    label: 'Top-P',
                    hint: '0.0 - 1.0',
                    toggleHint: '有効にすると、このパラメータが API に送信されます'
                },
                topK: {
                    label: 'Top-K',
                    toggleHint: '有効にすると、このパラメータが API に送信されます'
                },
                thinking: {
                    title: '思考設定',
                    toggleHint: '有効にすると、思考パラメータが API に送信されます'
                },
                currentThinking: {
                    title: '最新ターンの思考設定',
                    sendSignatures: '最新の思考署名を送信',
                    sendSignaturesHint: '現在のステップの思考継続性を維持',
                    sendContent: '最新の思考内容を送信',
                    sendContentHint: '最新ターンの推論プロセスを送信',
                },
                historyThinking: {
                    title: '履歴ターンの思考設定',
                    sendSignatures: '履歴思考署名を送信',
                    sendSignaturesHint: '以前のターンの思考署名を送信',
                    sendContent: '履歴思考内容を送信',
                    sendContentHint: '完了した履歴ターンの思考プロセスを AI に送信',
                    roundsLabel: '履歴思考ラウンド数',
                    roundsHint: '最新以外のラウンドをいくつ送信するか。-1 ですべて、0 で送信なし、正の N で最近の N ラウンド（例：1 は最後から 2 番目のラウンドのみ）'
                }
            },
            anthropic: {
                thinking: {
                    budgetLabel: '思考バジェット (Budget Tokens)',
                    budgetPlaceholder: '10000',
                    budgetHint: '思考プロセスに使用する最大トークン数、5000-50000 を推奨'
                }
            },
            gemini: {
                thinking: {
                    includeThoughts: '思考内容を返す',
                    includeThoughtsHint: '有効にすると、API レスポンスにモデルの思考プロセスが含まれます',
                    mode: '思考強度モード',
                    modeHint: 'デフォルト: API デフォルトを使用 | レベル: プリセットレベルを選択 | バジェット: カスタムトークン数',
                    modeDefault: 'デフォルト',
                    modeLevel: 'レベル',
                    modeBudget: 'バジェット',
                    levelLabel: '思考レベル',
                    levelHint: 'minimal: 最小限の思考 | low: 少ない思考 | medium: 中程度 | high: 深い思考',
                    levelMinimal: '最小',
                    levelLow: '低',
                    levelMedium: '中',
                    levelHigh: '高',
                    budgetLabel: '思考バジェット (Token)',
                    budgetPlaceholder: '1024',
                    budgetHint: '思考プロセスに許可されるカスタムトークン数'
                },
                historyThinking: {
                    sendContentHint: '有効にすると、履歴会話の思考内容（要約を含む）が送信されます。これによりコンテキスト長が大幅に増加する可能性があります'
                }
            },
            openai: {
                frequencyPenalty: {
                    label: '頻度ペナルティ (Frequency Penalty)',
                    hint: '-2.0 - 2.0',
                    toggleHint: '有効にすると、このパラメータが API に送信されます'
                },
                presencePenalty: {
                    label: '存在ペナルティ (Presence Penalty)',
                    hint: '-2.0 - 2.0',
                    toggleHint: '有効にすると、このパラメータが API に送信されます'
                },
                thinking: {
                    effortLabel: '思考強度 (Effort)',
                    effortHint: 'none: 使用しない | minimal: 極小 | low: 少ない | medium: 中程度 | high: 多い | xhigh: 最大',
                    effortNone: 'なし',
                    effortMinimal: '極小',
                    effortLow: '低',
                    effortMedium: '中',
                    effortHigh: '高',
                    effortXHigh: '最高',
                    summaryLabel: '出力詳細度 (Summary)',
                    summaryHint: 'auto: 自動選択 | concise: 簡潔な出力 | detailed: 詳細な出力',
                    summaryAuto: '自動',
                    summaryConcise: '簡潔',
                    summaryDetailed: '詳細'
                },
                historyThinking: {
                    sendSignaturesHint: '有効にすると、履歴会話の思考署名が送信されます（OpenAI 未対応）。非推奨であり、最新以外のターンの署名が送信されます。',
                    sendContentHint: '有効にすると、履歴会話の reasoning_content（要約を含む）が送信されます。これによりコンテキスト長が大幅に増加する可能性があります。'
                }
            },
            'openai-responses': {
                maxOutputTokens: {
                    label: '最大出力トークン',
                    placeholder: '8192',
                    hint: 'API の max_output_tokens パラメータに対応'
                },
                thinking: {
                    effortLabel: '思考強度 (Effort)',
                    effortHint: 'none: 使用しない | minimal: 極小 | low: 少ない | medium: 中程度 | high: 多い | xhigh: 最大',
                    effortNone: 'なし (none)',
                    effortMinimal: '極小 (minimal)',
                    effortLow: '低 (low)',
                    effortMedium: '中 (medium)',
                    effortHigh: '高 (high)',
                    effortXHigh: '最大 (xhigh)',
                    summaryLabel: '出力詳細度 (Summary)',
                    summaryHint: 'auto: 自動選択 | concise: 簡潔な出力 | detailed: 詳細な出力',
                    summaryAuto: '自動',
                    summaryConcise: '簡潔',
                    summaryDetailed: '詳細'
                },
                historyThinking: {
                    sendSignaturesHint: '以前のターンの思考署名を送信',
                    sendContentHint: '有効にすると、履歴会話の reasoning_content が送信されます。これによりコンテキスト長が増加します'
                }
            },
            customBody: {
                hint: 'カスタムリクエストボディフィールドを追加、ネストされた JSON オーバーライドをサポート',
                modeSimple: 'シンプルモード',
                modeAdvanced: '高度モード',
                keyPlaceholder: 'キー名（例: extra_body）',
                valuePlaceholder: '値（JSON をサポート、例: {"key": "value"}）',
                empty: 'カスタム Body アイテムがありません',
                addItem: 'アイテムを追加',
                jsonError: 'JSON 形式エラー',
                jsonHint: '完全な JSON 形式、ネストされたオーバーライドをサポート',
                jsonPlaceholder: '{\n  "extra_body": {\n    "google": {\n      "thinking_config": {\n        "include_thoughts": false\n      }\n    }\n  }\n}',
                enabled: '有効',
                disabled: '無効',
                deleteTooltip: '削除'
            },
            customHeaders: {
                hint: 'カスタム HTTP リクエストヘッダーを追加、順番に API に送信',
                keyPlaceholder: 'Header-Name',
                valuePlaceholder: 'Header Value',
                keyDuplicate: 'キー名が重複しています',
                empty: 'カスタムヘッダーがありません',
                addHeader: 'ヘッダーを追加',
                enabled: '有効',
                disabled: '無効',
                deleteTooltip: '削除'
            },
            toolOptions: {
                cropImage: {
                    title: '画像のトリミング (crop_image)',
                    useNormalizedCoords: '正規化座標を使用 (0-1000)',
                    enabledTitle: '有効時',
                    enabledNote: 'Gemini など正規化座標を使用するモデルに適しています',
                    disabledTitle: '無効時',
                    disabledNote: 'モデルは実際のピクセル座標を計算する必要があります',
                    coordTopLeft: '= 左上隅',
                    coordBottomRight: '= 右下隅',
                    coordCenter: '= 中心点'
                }
            },
            tokenCountMethod: {
                title: 'トークンカウント方式',
                label: 'カウント方式',
                placeholder: 'カウント方式を選択',
                hint: 'トークン数を計算する方式を選択します。コンテキストトリミングの精度に影響します',
                options: {
                    channelDefault: 'チャンネルのデフォルトを使用',
                    gemini: 'Gemini API',
                    openaiCustom: 'カスタム OpenAI フォーマット',
                    openaiCustomDesc: 'カスタム API エンドポイントを使用',
                    openaiResponses: 'OpenAI Responses API',
                    anthropic: 'Anthropic API',
                    local: 'ローカル推定',
                    localDesc: '約4文字 = 1トークン'
                },
                defaultDesc: {
                    gemini: 'デフォルトは Gemini countTokens API を使用',
                    anthropic: 'デフォルトは Anthropic count_tokens API を使用',
                    openai: 'デフォルトはローカル推定を使用（OpenAI には公式 API がありません）'
                },
                apiConfig: {
                    title: 'API 設定',
                    url: 'API URL',
                    urlHint: '空の場合はチャンネルの URL を使用',
                    apiKey: 'API キー',
                    apiKeyPlaceholder: 'API キーを入力',
                    apiKeyHint: '空の場合はチャンネルの API キーを使用',
                    model: 'モデル',
                    modelHint: 'トークンカウントに使用するモデル名'
                }
            }
        },

        tools: {
            executing: '実行中...',
            executed: '実行済み',
            failed: '実行失敗',
            cancelled: 'キャンセル済み',
            approve: '承認',
            reject: '拒否',
            autoExecuted: '自動実行',
            terminate: '終了',
            saveToPath: 'パスに保存',
            openFile: 'ファイルを開く',
            openFolder: 'フォルダーを開く',
            viewDetails: '詳細を表示',
            hideDetails: '詳細を非表示',
            parameters: 'パラメータ',
            result: '結果',
            error: 'エラー',
            duration: '所要時間',
            file: {
                readFile: 'ファイルを読み取り',
                writeFile: 'ファイルを書き込み',
                deleteFile: 'ファイルを削除',
                createDirectory: 'ディレクトリを作成',
                listFiles: 'ファイル一覧',
                applyDiff: '差分を適用',
                filesRead: '読み取ったファイル',
                filesWritten: '書き込んだファイル',
                filesDeleted: '削除したファイル',
                directoriesCreated: '作成したディレクトリ',
                changesApplied: '適用した変更',
                applyDiffPanel: {
                    title: '差分を適用',
                    changes: '個の変更',
                    diffApplied: '差分が適用されました',
                    pending: 'レビュー待ち',
                    accepted: '承認済み',
                    rejected: '拒否済み',
                    line: '開始行',
                    diffNumber: '#',
                    collapse: '折りたたむ',
                    expandRemaining: '残り {count} 行を展開',
                    copied: 'コピーしました',
                    copyNew: '新しい内容をコピー',
                    deletedLines: '削除',
                    addedLines: '追加',
                    userEdited: 'ユーザー編集済み',
                    userEditedContent: 'ユーザーが修正した内容'
                },
                createDirectoryPanel: {
                    title: 'ディレクトリを作成',
                    total: '合計 {count} 個',
                    noDirectories: '作成するディレクトリがありません',
                    success: '成功',
                    failed: '失敗'
                },
                deleteFilePanel: {
                    title: 'ファイルを削除',
                    total: '合計 {count} 個',
                    noFiles: '削除するファイルがありません',
                    success: '成功',
                    failed: '失敗'
                },
                listFilesPanel: {
                    title: 'ファイル一覧',
                    recursive: '再帰的',
                    totalStat: '{dirCount} ディレクトリ、{folderCount} フォルダー、{fileCount} ファイル',
                    copyAll: 'すべてのリストをコピー',
                    copyList: 'リストをコピー',
                    dirStat: '{folderCount} フォルダー、{fileCount} ファイル',
                    collapse: '折りたたむ',
                    expandRemaining: '残り {count} 個を展開',
                    emptyDirectory: 'ディレクトリは空です'
                },
                readFilePanel: {
                    title: 'ファイルを読み取り',
                    total: '合計 {count} 個',
                    lines: '{count} 行',
                    copied: 'コピーしました',
                    copyContent: '内容をコピー',
                    binaryFile: 'バイナリファイル',
                    unknownSize: '不明なサイズ',
                    collapse: '折りたたむ',
                    expandRemaining: '残り {count} 行を展開',
                    emptyFile: 'ファイルは空です'
                },
                writeFilePanel: {
                    title: 'ファイルを書き込み',
                    total: '合計 {count} 個',
                    lines: '{count} 行',
                    copied: 'コピーしました',
                    copyContent: '内容をコピー',
                    collapse: '折りたたむ',
                    expandRemaining: '残り {count} 行を展開',
                    noContent: '書き込む内容がありません',
                    viewContent: '内容',
                    viewDiff: '差分',
                    loadingDiff: '差分を読み込み中...',
                    actions: {
                        created: '新規作成',
                        modified: '変更',
                        unchanged: '変更なし',
                        write: '書き込み'
                    }
                }
            },
            search: {
                findFiles: 'ファイルを検索',
                searchInFiles: 'ファイル内を検索',
                filesFound: 'ファイルが見つかりました',
                matchesFound: '一致が見つかりました',
                noResults: '結果なし',
                findFilesPanel: {
                    title: 'ファイルを検索',
                    totalFiles: '合計 {count} ファイル',
                    fileCount: '{count} ファイル',
                    truncated: '切り捨て',
                    collapse: '折りたたむ',
                    expandRemaining: '残り {count} ファイルを展開',
                    noFiles: '一致するファイルが見つかりません'
                },
                searchInFilesPanel: {
                    title: 'コンテンツを検索',
                    replaceTitle: '検索と置換',
                    regex: '正規表現',
                    matchCount: '{count} 一致',
                    fileCount: '{count} ファイル',
                    truncated: '切り捨て',
                    keywords: 'キーワード：',
                    replaceWith: '置換後：',
                    emptyString: '(空文字列)',
                    path: 'パス：',
                    pattern: 'パターン：',
                    noResults: '一致するコンテンツが見つかりません',
                    collapse: '折りたたむ',
                    expandRemaining: '残り {count} 一致を展開',
                    replacements: '{count} 箇所を置換しました',
                    replacementsInFile: '{count} 箇所を置換',
                    filesModified: '{count} ファイル',
                    viewMatches: '一致項目',
                    viewDiff: '差分',
                    loadingDiff: '差分を読み込み中...'
                }
            },
            terminal: {
                executeCommand: 'コマンドを実行',
                command: 'コマンド',
                output: '出力',
                exitCode: '終了コード',
                running: '実行中',
                terminated: '終了',
                terminateCommand: 'コマンドを終了',
                executeCommandPanel: {
                    title: 'ターミナル',
                    status: {
                        failed: '失敗',
                        terminated: '終了',
                        success: '成功',
                        exitCode: '終了コード: {code}',
                        running: '実行中...',
                        pending: '保留中'
                    },
                    terminate: '終了',
                    terminateTooltip: 'プロセスを終了',
                    copyOutput: '出力をコピー',
                    copied: 'コピーしました',
                    output: '出力',
                    truncatedInfo: '最後の {outputLines} 行を表示（合計 {totalLines} 行）',
                    autoScroll: '自動スクロール',
                    waitingOutput: '出力を待機中...',
                    noOutput: '出力なし',
                    executing: 'コマンド実行中...'
                }
            },
            lsp: {
                getSymbols: 'シンボルを取得',
                gotoDefinition: '定義へ移動',
                findReferences: '参照を検索',
                getSymbolsPanel: {
                    title: 'ファイルシンボル',
                    totalFiles: '合計 {count} ファイル',
                    totalSymbols: '合計 {count} シンボル',
                    noSymbols: 'シンボルが見つかりません',
                    symbolCount: '{count} シンボル',
                    collapse: '折りたたむ',
                    expandRemaining: '残り {count} 個を展開',
                    copyAll: 'すべてコピー',
                    copied: 'コピーしました'
                },
                gotoDefinitionPanel: {
                    title: '定義',
                    definitionFound: '定義が見つかりました',
                    noDefinition: '定義が見つかりません',
                    lines: '{count} 行',
                    copyCode: 'コードをコピー',
                    copied: 'コピーしました'
                },
                findReferencesPanel: {
                    title: '参照',
                    totalReferences: '合計 {count} 参照',
                    totalFiles: '{count} ファイル',
                    noReferences: '参照が見つかりません',
                    referencesInFile: '{count} 参照',
                    collapse: '折りたたむ',
                    expandRemaining: '残り {count} 個を展開'
                }
            },
            mcp: {
                mcpTool: 'MCP ツール',
                serverName: 'サーバー名',
                toolName: 'ツール名',
                mcpToolPanel: {
                    requestParams: 'リクエストパラメータ',
                    errorInfo: 'エラー情報',
                    responseResult: 'レスポンス結果',
                    waitingResponse: 'レスポンスを待機中...'
                }
            },
            subagents: {
                title: 'サブエージェント',
                task: 'タスク',
                context: 'コンテキスト',
                completed: '完了',
                failed: '失敗',
                executing: '実行中...',
                partialResponse: '部分レスポンス'
            },
            media: {
                generateImage: '画像を生成',
                resizeImage: '画像をリサイズ',
                cropImage: '画像をトリミング',
                rotateImage: '画像を回転',
                removeBackground: '背景を削除',
                generating: '生成中...',
                processing: '処理中...',
                imagesGenerated: '画像が生成されました',
                saveImage: '画像を保存',
                saveTo: '保存先',
                saved: '保存しました',
                saveFailed: '保存に失敗しました',
                cropImagePanel: {
                    title: '画像をトリミング',
                    cancel: 'キャンセル',
                    cancelCrop: 'トリミングをキャンセル',
                    status: {
                        needDependency: '依存関係が必要',
                        cancelled: 'キャンセル済み',
                        failed: '失敗',
                        success: '成功',
                        error: 'エラー',
                        processing: '処理中...',
                        waiting: '待機中'
                    },
                    checkingDependency: '依存関係のステータスを確認中...',
                    dependencyMessage: 'トリミング機能には画像処理用の sharp ライブラリが必要です。',
                    batchCrop: 'バッチトリミング ({count})',
                    cropTask: 'トリミングタスク',
                    coordsHint: '座標範囲 0-1000（正規化）、実際のピクセルに自動変換',
                    cancelledMessage: 'ユーザーがトリミング操作をキャンセルしました',
                    resultTitle: 'トリミング結果 ({count} 枚)',
                    original: '元の画像:',
                    cropped: 'トリミング後:',
                    cropResultN: 'トリミング結果 {n}',
                    saved: '保存しました',
                    overwriteSave: '上書き保存',
                    save: '保存',
                    openInEditor: 'エディターで開く',
                    savePaths: '保存パス:',
                    croppingImages: '画像をトリミング中...',
                    openFileFailed: 'ファイルを開くのに失敗しました:',
                    saveFailed: '保存に失敗しました'
                },
                generateImagePanel: {
                    title: '画像生成',
                    cancel: 'キャンセル',
                    cancelGeneration: '生成をキャンセル',
                    status: {
                        needDependency: '依存関係が必要',
                        cancelled: 'キャンセル済み',
                        failed: '失敗',
                        success: '成功',
                        error: 'エラー',
                        generating: '生成中...',
                        waiting: '待機中'
                    },
                    batchTasks: 'バッチタスク ({count})',
                    generateTask: '生成タスク',
                    outputPath: '出力パス',
                    aspectRatio: 'アスペクト比',
                    imageSize: '画像サイズ',
                    referenceImages: '{count} 枚の参照',
                    cancelledMessage: 'ユーザーが画像生成をキャンセルしました',
                    tasksFailed: '{count} タスクが失敗しました',
                    resultTitle: '生成結果 ({count} 枚)',
                    saved: '保存しました',
                    overwriteSave: '上書き保存',
                    save: '保存',
                    openInEditor: 'エディターで開く',
                    savePaths: '保存パス:',
                    generatingImages: '画像を生成中...',
                    openFileFailed: 'ファイルを開くのに失敗しました:',
                    saveFailed: '保存に失敗しました'
                },
                removeBackgroundPanel: {
                    title: '背景除去',
                    cancel: 'キャンセル',
                    cancelRemove: '除去をキャンセル',
                    status: {
                        needDependency: '依存関係が必要',
                        cancelled: 'キャンセル済み',
                        failed: '失敗',
                        success: '成功',
                        error: 'エラー',
                        processing: '処理中...',
                        waiting: '待機中',
                        disabled: '無効'
                    },
                    checkingDependency: '依存関係のステータスを確認中...',
                    dependencyMessage: '背景除去機能には画像処理用の sharp ライブラリが必要です。',
                    batchTasks: 'バッチタスク ({count})',
                    removeTask: '背景除去タスク',
                    subjectDescription: '主題の説明',
                    maskPath: 'マスク: {path}',
                    needSharp: {
                        title: 'sharp ライブラリが必要です',
                        message: 'マスクが生成されましたが、完全な背景除去には sharp ライブラリのインストールが必要です。',
                        installCmd: 'pnpm add sharp'
                    },
                    cancelledMessage: 'ユーザーが背景除去をキャンセルしました',
                    tasksFailed: '{count} タスクが失敗しました',
                    resultTitle: '処理結果 ({count} 枚)',
                    maskImage: 'マスク画像',
                    resultImage: '結果画像 {n}',
                    saved: '保存しました',
                    overwriteSave: '上書き保存',
                    save: '保存',
                    openInEditor: 'エディターで開く',
                    savePaths: '保存パス:',
                    processingImages: '画像を処理中...',
                    openFileFailed: 'ファイルを開くのに失敗しました:',
                    saveFailed: '保存に失敗しました'
                },
                resizeImagePanel: {
                    title: '画像をリサイズ',
                    cancel: 'キャンセル',
                    cancelResize: 'リサイズをキャンセル',
                    status: {
                        needDependency: '依存関係が必要',
                        cancelled: 'キャンセル済み',
                        failed: '失敗',
                        success: '成功',
                        error: 'エラー',
                        processing: '処理中...',
                        waiting: '待機中'
                    },
                    checkingDependency: '依存関係のステータスを確認中...',
                    dependencyMessage: 'リサイズ機能には画像処理用の sharp ライブラリが必要です。',
                    batchResize: 'バッチリサイズ ({count})',
                    resizeTask: 'リサイズタスク',
                    sizeHint: '画像はターゲットサイズに引き伸ばして埋められます（アスペクト比は維持されません）',
                    cancelledMessage: 'ユーザーがリサイズ操作をキャンセルしました',
                    resultTitle: 'リサイズ結果 ({count} 枚)',
                    resizeResultN: 'リサイズ結果 {n}',
                    dimensions: {
                        original: '元のサイズ:',
                        resized: 'リサイズ後:'
                    },
                    saved: '保存しました',
                    overwriteSave: '上書き保存',
                    save: '保存',
                    openInEditor: 'エディターで開く',
                    savePaths: '保存パス:',
                    resizingImages: '画像をリサイズ中...',
                    openFileFailed: 'ファイルを開くのに失敗しました:',
                    saveFailed: '保存に失敗しました'
                },
                rotateImagePanel: {
                    title: '画像を回転',
                    cancel: 'キャンセル',
                    cancelRotate: '回転をキャンセル',
                    status: {
                        needDependency: '依存関係が必要',
                        cancelled: 'キャンセル済み',
                        failed: '失敗',
                        success: '成功',
                        error: 'エラー',
                        processing: '処理中...',
                        waiting: '待機中'
                    },
                    checkingDependency: '依存関係のステータスを確認中...',
                    dependencyMessage: '回転機能には画像処理用の sharp ライブラリが必要です。',
                    batchRotate: 'バッチ回転 ({count})',
                    rotateTask: '回転タスク',
                    angleHint: '正の角度は反時計回り、負の角度は時計回りに回転。PNG/WebP は透明で埋め、JPG は黒で埋めます',
                    angleFormat: {
                        counterclockwise: '反時計回り',
                        clockwise: '時計回り'
                    },
                    cancelledMessage: 'ユーザーが回転操作をキャンセルしました',
                    resultTitle: '回転結果 ({count} 枚)',
                    rotateResultN: '回転結果 {n}',
                    dimensions: {
                        rotation: '回転:',
                        size: 'サイズ:'
                    },
                    saved: '保存しました',
                    overwriteSave: '上書き保存',
                    save: '保存',
                    openInEditor: 'エディターで開く',
                    savePaths: '保存パス:',
                    rotatingImages: '画像を回転中...',
                    openFileFailed: 'ファイルを開くのに失敗しました:',
                    saveFailed: '保存に失敗しました'
                }
            }
        }
    },

    app: {
        retryPanel: {
            title: 'リクエストに失敗しました。自動的に再試行しています',
            cancelTooltip: '再試行をキャンセル',
            defaultError: 'リクエストに失敗しました'
        }
    },

    errors: {
        networkError: 'ネットワークエラーです。接続を確認してください',
        apiError: 'API リクエストに失敗しました',
        timeout: 'リクエストがタイムアウトしました',
        invalidConfig: '無効な設定です',
        fileNotFound: 'ファイルが見つかりません',
        permissionDenied: '権限が拒否されました',
        unknown: '不明なエラー',
        connectionFailed: '接続に失敗しました',
        authFailed: '認証に失敗しました',
        rateLimited: 'リクエストが多すぎます。後でもう一度お試しください',
        serverError: 'サーバーエラー',
        invalidResponse: '無効なレスポンス形式です',
        cancelled: '操作がキャンセルされました'
    },

    composables: {
        useChat: {
            errors: {
                sendFailed: 'メッセージの送信に失敗しました',
                retryFailed: '再試行に失敗しました',
                editRetryFailed: '編集再試行に失敗しました',
                deleteFailed: '削除に失敗しました',
                streamError: 'ストリームレスポンスエラー',
                loadHistoryFailed: '履歴の読み込みに失敗しました'
            }
        },
        useConversations: {
            defaultTitle: 'タイトルなし',
            newChatTitle: '新しい会話',
            errors: {
                loadFailed: '会話の読み込みに失敗しました',
                createFailed: '会話の作成に失敗しました',
                deleteFailed: '会話の削除に失敗しました',
                updateTitleFailed: 'タイトルの更新に失敗しました'
            },
            relativeTime: {
                justNow: 'たった今',
                minutesAgo: '{minutes} 分前',
                hoursAgo: '{hours} 時間前',
                daysAgo: '{days} 日前'
            }
        },
        useAttachments: {
            errors: {
                validationFailed: '添付ファイルの検証に失敗しました',
                createThumbnailFailed: 'サムネイルの作成に失敗しました',
                createVideoThumbnailFailed: '動画サムネイルの作成に失敗しました',
                readFileFailed: 'ファイルの読み取りに失敗しました',
                loadVideoFailed: '動画の読み込みに失敗しました',
                readResultNotString: '読み取り結果が文字列ではありません'
            }
        }
    },

    stores: {
        terminalStore: {
            errors: {
                killTerminalFailed: 'ターミナルの終了に失敗しました',
                refreshOutputFailed: 'ターミナル出力の更新に失敗しました'
            }
        },
        chatStore: {
            defaultTitle: 'タイトルなし',
            errors: {
                loadConversationsFailed: '会話の読み込みに失敗しました',
                createConversationFailed: '会話の作成に失敗しました',
                deleteConversationFailed: '会話の削除に失敗しました',
                sendMessageFailed: 'メッセージの送信に失敗しました',
                streamError: 'ストリームレスポンスエラー',
                loadHistoryFailed: '履歴の読み込みに失敗しました',
                retryFailed: '再試行に失敗しました',
                editRetryFailed: '編集再試行に失敗しました',
                deleteFailed: '削除に失敗しました',
                noConversationSelected: '会話が選択されていません',
                unknownError: '不明なエラー',
                restoreFailed: '復元に失敗しました',
                restoreCheckpointFailed: 'チェックポイントの復元に失敗しました',
                restoreRetryFailed: '復元して再試行に失敗しました',
                restoreDeleteFailed: '復元して削除に失敗しました',
                noConfigSelected: '設定が選択されていません',
                summarizeFailed: '要約に失敗しました',
                restoreEditFailed: '復元して編集に失敗しました'
            },
            relativeTime: {
                justNow: 'たった今',
                minutesAgo: '{minutes}分前',
                hoursAgo: '{hours}時間前',
                daysAgo: '{days}日前'
            }
        }
    }
};

export default ja;