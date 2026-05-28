/**
 * LimCode 产品元数据。
 *
 * 修改原因：发布版本曾散落在 MCP clientInfo、模块注册、设置页文案和临时依赖 package 中，导致每次发版都要手工同步多处。
 * 修改方式：以 VS Code 扩展自身 packageJSON 为唯一运行时版本来源，activate 阶段初始化，其他模块只读取本模块提供的元数据。
 * 修改目的：把版本号维护收敛到 package.json，避免后续 release 因漏改运行时字符串而出现元数据不一致。
 */

import type * as vscode from 'vscode';

export interface ProductMetadata {
    name: string;
    displayName: string;
    version: string;
}

const FALLBACK_METADATA: ProductMetadata = {
    name: 'LimCode',
    displayName: 'Lim Code',
    version: '0.0.0'
};

let productMetadata: ProductMetadata | undefined;

function normalizePackageMetadata(packageJSON: any): ProductMetadata {
    // 修改原因：packageJSON 来自 VS Code 扩展宿主，字段类型不是本仓库可控的静态类型。
    // 修改方式：只提取 name/displayName/version 三个字段并做字符串兜底，避免异常元数据污染调用方。
    // 修改目的：让 MCP 握手、模块注册和设置页显示都能安全使用同一份产品元数据。
    return {
        name: typeof packageJSON?.name === 'string' && packageJSON.name ? packageJSON.name : FALLBACK_METADATA.name,
        displayName: typeof packageJSON?.displayName === 'string' && packageJSON.displayName ? packageJSON.displayName : FALLBACK_METADATA.displayName,
        version: typeof packageJSON?.version === 'string' && packageJSON.version ? packageJSON.version : FALLBACK_METADATA.version
    };
}

export function initializeProductMetadata(context: vscode.ExtensionContext): ProductMetadata {
    // 修改原因：运行时读取版本必须绑定“当前扩展自身”，不能从 workspace 目录读取 package.json，避免被用户项目污染。
    // 修改方式：activate 阶段从 ExtensionContext.extension.packageJSON 初始化全局元数据缓存。
    // 修改目的：让后续无 context 的后端模块也能读取同一份扩展版本。
    productMetadata = normalizePackageMetadata(context.extension.packageJSON);
    return productMetadata;
}

export function getProductMetadata(): ProductMetadata {
    if (productMetadata) {
        return productMetadata;
    }

    try {
        // 修改原因：部分单元测试或懒加载路径可能在 initializeProductMetadata 前访问版本。
        // 修改方式：兜底从 VS Code extension registry 读取已安装扩展的 packageJSON，不从文件系统或 workspace 猜测。
        // 修改目的：保持运行时版本来源仍然是扩展宿主元数据，同时让旧调用路径具备安全退路。
        const vscodeApi = require('vscode') as typeof import('vscode');
        const extension = vscodeApi.extensions?.getExtension?.('Lianues.limcode');
        if (extension?.packageJSON) {
            productMetadata = normalizePackageMetadata(extension.packageJSON);
            return productMetadata;
        }
    } catch {
        // 在 Jest 或非 VS Code 环境中回落到安全默认值。
    }

    return FALLBACK_METADATA;
}

export function getProductVersion(): string {
    return getProductMetadata().version;
}

export function createLimCodeMcpClientInfo(): { name: string; version: string } {
    // 修改原因：HTTP MCP 和 Stdio MCP 原来各自硬编码 clientInfo.version，容易出现协议元数据分叉。
    // 修改方式：统一由产品元数据生成 MCP clientInfo，name 保持协议里已有的 LimCode，version 来自扩展 packageJSON。
    // 修改目的：让所有 MCP transport 对外报告同一个当前扩展版本。
    return {
        name: 'LimCode',
        version: getProductVersion()
    };
}
