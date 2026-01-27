/**
 * LimCode Backend - i18n 国际化模块
 * 
 * 支持语言切换和翻译
 * 与前端共享相同的语言配置
 */

import type { SupportedLanguage, BackendLanguageMessages } from './types';
import zhCN from './langs/zh-CN';
import en from './langs/en';
import ja from './langs/ja';

/**
 * 语言包
 */
const messages: Record<string, BackendLanguageMessages> = {
    'zh-CN': zhCN,
    'en': en,
    'ja': ja
};

/**
 * 当前语言设置
 */
let currentLanguage: SupportedLanguage = 'zh-CN';

/**
 * 检测到的语言（从 VS Code 获取）
 */
let detectedLanguage: string = 'zh-CN';

/**
 * 获取实际使用的语言
 */
export function getActualLanguage(): string {
    if (currentLanguage === 'auto') {
        // 尝试匹配检测到的语言
        if (detectedLanguage && messages[detectedLanguage]) {
            return detectedLanguage;
        }
        // 如果检测的语言包含 zh，使用中文
        if (detectedLanguage && detectedLanguage.startsWith('zh')) {
            return 'zh-CN';
        }
        // 如果检测的语言包含 en，使用英文
        if (detectedLanguage && detectedLanguage.startsWith('en')) {
            return 'en';
        }
        // 如果检测的语言包含 ja，使用日文
        if (detectedLanguage && detectedLanguage.startsWith('ja')) {
            return 'ja';
        }
        // 默认使用中文
        return 'zh-CN';
    }
    return currentLanguage;
}

/**
 * 获取当前语言的消息对象
 */
function getCurrentMessages(): BackendLanguageMessages {
    const lang = getActualLanguage();
    return messages[lang] || messages['zh-CN'];
}

/**
 * 设置语言
 */
export function setLanguage(lang: SupportedLanguage): void {
    currentLanguage = lang;
}

/**
 * 获取当前语言设置
 */
export function getLanguage(): SupportedLanguage {
    return currentLanguage;
}

/**
 * 设置检测到的语言（从 VS Code 获取）
 */
export function setDetectedLanguage(lang: string): void {
    detectedLanguage = lang;
}

/**
 * 翻译函数
 *
 * 使用点号分隔的路径获取翻译
 * 例如：t('core.registry.moduleAlreadyRegistered', { moduleId: 'config' })
 * 支持参数替换：{paramName} 格式的占位符
 */
export function t(key: string, params?: Record<string, any>): string {
    const keys = key.split('.');
    let result: any = getCurrentMessages();

    for (const k of keys) {
        if (result && typeof result === 'object' && k in result) {
            result = result[k];
        } else {
            // 找不到翻译，返回 key 本身
            console.warn(`[i18n] Missing translation: ${key}`);
            return key;
        }
    }

    if (typeof result === 'string') {
        // 如果有参数，替换占位符
        if (params) {
            return result.replace(/\{(\w+)\}/g, (match, paramName) => {
                return params[paramName] !== undefined ? String(params[paramName]) : match;
            });
        }
        return result;
    }

    return key;
}

// 导出类型
export type { SupportedLanguage, BackendLanguageMessages } from './types';

export default {
    t,
    setLanguage,
    getLanguage,
    setDetectedLanguage
};