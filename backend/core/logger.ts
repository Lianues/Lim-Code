/**
 * LimCode - 生产环境日志系统
 *
 * 轻量级、结构化日志，专为 VS Code 扩展环境设计：
 * - 支持日志级别过滤（DEBUG / INFO / WARN / ERROR）
 * - 结构化 JSON 输出，方便机器解析和搜索
 * - 可选的 VS Code OutputChannel 输出
 * - 零外部依赖
 *
 * 用法：
 * ```ts
 * import { Logger } from '../../core/logger';
 *
 * const log = Logger.get('SummarizeService');
 * log.info('summary.start', { conversationId, messageCount: 10 });
 * log.warn('summary.empty_response', { conversationId });
 * log.error('summary.failed', { conversationId, error: err.message });
 * ```
 */

/** 日志级别 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    /** 完全禁用日志 */
    SILENT = 99
}

/** 日志级别名称 */
const LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.SILENT]: 'SILENT'
};

/** 全局配置 */
let globalMinLevel: LogLevel = LogLevel.INFO;
let outputChannelWriter: ((line: string) => void) | undefined;

/**
 * 轻量级结构化日志器
 *
 * 每个模块通过 `Logger.get('ModuleName')` 获取命名日志器实例，
 * 实例会被缓存，相同名称返回同一个实例。
 */
export class Logger {
    /** 实例缓存 */
    private static instances = new Map<string, Logger>();

    private constructor(private readonly module: string) {}

    /**
     * 获取/创建命名日志器
     * @param module 模块名（如 'SummarizeService'、'ContextTrimService'）
     */
    static get(module: string): Logger {
        let instance = Logger.instances.get(module);
        if (!instance) {
            instance = new Logger(module);
            Logger.instances.set(module, instance);
        }
        return instance;
    }

    /**
     * 设置全局最低日志级别
     */
    static setLevel(level: LogLevel): void {
        globalMinLevel = level;
    }

    /**
     * 获取当前全局日志级别
     */
    static getLevel(): LogLevel {
        return globalMinLevel;
    }

    /**
     * 设置 VS Code OutputChannel 写入器
     *
     * 设置后，日志同时输出到 console 和 OutputChannel。
     * 传 undefined 取消 OutputChannel 输出。
     *
     * @example
     * // 在 extension.ts 的 activate 中：
     * const channel = vscode.window.createOutputChannel('LimCode');
     * Logger.setOutputChannel((line) => channel.appendLine(line));
     */
    static setOutputChannel(writer: ((line: string) => void) | undefined): void {
        outputChannelWriter = writer;
    }

    // ---- 日志方法 ----

    debug(event: string, data?: Record<string, unknown>): void {
        this.write(LogLevel.DEBUG, event, data);
    }

    info(event: string, data?: Record<string, unknown>): void {
        this.write(LogLevel.INFO, event, data);
    }

    warn(event: string, data?: Record<string, unknown>): void {
        this.write(LogLevel.WARN, event, data);
    }

    error(event: string, data?: Record<string, unknown>): void {
        this.write(LogLevel.ERROR, event, data);
    }

    // ---- 内部实现 ----

    private write(level: LogLevel, event: string, data?: Record<string, unknown>): void {
        if (level < globalMinLevel) return;

        const levelName = LEVEL_NAMES[level] ?? 'UNKNOWN';
        const timestamp = new Date().toISOString();

        // 构建结构化日志行
        // 格式: [时间][级别][模块] event {数据}
        const prefix = `[${timestamp}][${levelName}][${this.module}]`;
        let line: string;

        if (data && Object.keys(data).length > 0) {
            // 安全序列化：防止循环引用等导致崩溃
            let jsonStr: string;
            try {
                jsonStr = JSON.stringify(data);
            } catch {
                jsonStr = '{"_serializeError": true}';
            }
            line = `${prefix} ${event} ${jsonStr}`;
        } else {
            line = `${prefix} ${event}`;
        }

        // 输出到 console
        switch (level) {
            case LogLevel.ERROR:
                console.error(line);
                break;
            case LogLevel.WARN:
                console.warn(line);
                break;
            default:
                console.log(line);
                break;
        }

        // 输出到 OutputChannel（如果已配置）
        if (outputChannelWriter) {
            try {
                outputChannelWriter(line);
            } catch {
                // OutputChannel 写入失败不应影响主逻辑
            }
        }
    }
}
