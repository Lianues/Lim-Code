/**
 * LimCode - 代理 Fetch 实现
 *
 * 支持通过 HTTP 代理发起 HTTPS 请求（CONNECT 隧道方式）
 */

import { t } from '../../i18n';
import * as https from 'https';
import * as http from 'http';
import * as tls from 'tls';
import { StringDecoder } from 'string_decoder';
import { URL } from 'url';
import { ChannelError, ErrorType } from './types';

// User-Agent 标识
const USER_AGENT = 'LimCode';

/**
 * 创建标准 AbortError。
 * 修改原因：ChannelManager 依赖 AbortError 名称区分用户取消、超时 abort 和普通网络错误。
 * 修改方式：集中构造 name='AbortError' 的 Error，并在代理连接和流式读取的 abort 路径统一使用。
 * 修改目的：防止 abort 被误当成正常 EOF 或 NETWORK_ERROR，确保取消/超时由上层一致翻译。
 */
function createAbortError(message = 'Request cancelled'): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

/**
 * Fetch 选项
 */
export interface FetchOptions {
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeout?: number;
    signal?: AbortSignal;
}

/**
 * Fetch 响应
 */
export interface FetchResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    text: () => Promise<string>;
    json: () => Promise<any>;
    body: ReadableStream<Uint8Array> | null;
}


export type ChunkedExtractResult =
    | { status: 'need_more_data'; payloads: Buffer[]; remaining: Buffer }
    | { status: 'complete'; payloads: Buffer[]; remaining: Buffer }
    | { status: 'invalid'; payloads: Buffer[]; remaining: Buffer; error: Error };

/**
 * 构造手写代理流式请求头。
 * 修改原因：代理流式路径会手动解析 body bytes，如果上游返回 gzip/br 压缩字节，UTF-8 decoder 会把压缩二进制误当文本。
 * 修改方式：按大小写不敏感规则移除调用方的传输控制头，再统一写入 Host、User-Agent、Accept-Encoding: identity、Content-Length 和 Connection。
 * 修改目的：避免重复/冲突 header，并强制该手写 streaming decoder 只接收 identity 编码的响应体。
 */
export function buildProxyStreamRequestHeaders(
    targetHost: string,
    initHeaders: Record<string, string>,
    bodyLength: number
): string[] {
    const managedHeaders = new Set(['host', 'user-agent', 'accept-encoding', 'content-length', 'connection']);
    const passthroughHeaders = Object.entries(initHeaders)
        .filter(([key]) => !managedHeaders.has(key.toLowerCase()))
        .map(([key, value]) => `${key}: ${value}`);

    return [
        `Host: ${targetHost}`,
        ...passthroughHeaders,
        `User-Agent: ${USER_AGENT}`,
        'Accept-Encoding: identity',
        `Content-Length: ${bodyLength}`,
        'Connection: close'
    ];
}

/**
 * 只解析 HTTP chunked transfer framing，不做 UTF-8 字符串解码。
 * 修改原因：旧实现按 HTTP chunk 调用 Buffer.toString('utf8')，当中文/emoji 字节跨 chunk 边界时会制造 U+FFFD。
 * 修改方式：状态机仅返回完整 payload Buffer，支持 chunk extension、0-size terminator、optional trailer 和 invalid framing。
 * 修改目的：让外层同一个 streaming UTF-8 decoder 统一处理跨 chunk 的多字节字符。
 */
export function extractHttpChunkedPayloads(data: Buffer): ChunkedExtractResult {
    const payloads: Buffer[] = [];
    let offset = 0;

    while (offset < data.length) {
        const chunkStart = offset;
        let sizeEnd = -1;
        for (let i = offset; i < data.length - 1; i++) {
            if (data[i] === 0x0d && data[i + 1] === 0x0a) {
                sizeEnd = i;
                break;
            }
        }

        if (sizeEnd === -1) {
            return { status: 'need_more_data', payloads, remaining: data.subarray(chunkStart) };
        }

        const sizeLine = data.subarray(offset, sizeEnd).toString('ascii').trim();
        const sizeToken = sizeLine.split(';', 1)[0].trim();
        if (!/^[0-9a-fA-F]+$/.test(sizeToken)) {
            return {
                status: 'invalid',
                payloads,
                remaining: data.subarray(chunkStart),
                error: new Error(`Invalid chunk size line: ${sizeLine}`)
            };
        }

        const chunkSize = parseInt(sizeToken, 16);
        const chunkDataStart = sizeEnd + 2;

        if (chunkSize === 0) {
            if (data.length < chunkDataStart + 2) {
                return { status: 'need_more_data', payloads, remaining: data.subarray(chunkStart) };
            }
            if (data[chunkDataStart] === 0x0d && data[chunkDataStart + 1] === 0x0a) {
                return { status: 'complete', payloads, remaining: data.subarray(chunkDataStart + 2) };
            }

            const trailerEndMarker = Buffer.from('\r\n\r\n');
            const trailerEnd = data.indexOf(trailerEndMarker, chunkDataStart);
            if (trailerEnd === -1) {
                return { status: 'need_more_data', payloads, remaining: data.subarray(chunkStart) };
            }
            return { status: 'complete', payloads, remaining: data.subarray(trailerEnd + trailerEndMarker.length) };
        }

        const chunkDataEnd = chunkDataStart + chunkSize;
        if (data.length < chunkDataEnd + 2) {
            return { status: 'need_more_data', payloads, remaining: data.subarray(chunkStart) };
        }
        if (data[chunkDataEnd] !== 0x0d || data[chunkDataEnd + 1] !== 0x0a) {
            return {
                status: 'invalid',
                payloads,
                remaining: data.subarray(chunkStart),
                error: new Error('Invalid chunk payload terminator')
            };
        }

        payloads.push(data.subarray(chunkDataStart, chunkDataEnd));
        offset = chunkDataEnd + 2;
    }

    return { status: 'need_more_data', payloads, remaining: Buffer.alloc(0) };
}

export interface ProxyStreamBodyDecoderOptions {
    isChunked: boolean;
    contentLength?: number;
}

/**
 * 代理流式 body 的统一状态机。
 * 修改原因：success body、error body、chunked body 和 non-chunked body 都需要同一套“framing 先行、UTF-8 stateful decode 后行”的规则。
 * 修改方式：封装 chunked payload 提取、non-chunked content-length 计数、StringDecoder.write/end 生命周期和 normal completion 判断。
 * 修改目的：让 proxyStreamFetch 的真实路径和单元测试共用同一生产语义，防止未来重新引入分片 .toString('utf8')。
 */
export class ProxyStreamBodyDecoder {
    private readonly decoder = new StringDecoder('utf8');
    // 修改原因：Buffer.subarray() 在 Node 24 类型中返回 Buffer<ArrayBufferLike>，而 Buffer.alloc() 会推断为更窄的 Buffer<ArrayBuffer>。
    // 修改方式：显式把内部缓存标注为通用 Buffer，允许保存 parser 返回的 remaining 子视图。
    // 修改目的：保持零拷贝 remaining 缓存语义，同时避免泛型推断导致测试编译失败。
    private chunkedBuffer: Buffer = Buffer.alloc(0);
    private receivedLength = 0;
    private completed = false;

    constructor(private readonly options: ProxyStreamBodyDecoderOptions) {}

    get isComplete(): boolean {
        return this.completed;
    }

    write(data: Buffer): string[] {
        if (this.completed || data.length === 0) {
            return [];
        }

        if (this.options.isChunked) {
            return this.writeChunked(data);
        }

        return this.writeNonChunked(data);
    }

    finish(): string[] {
        if (this.completed) {
            return [];
        }
        if (this.options.isChunked) {
            throw new Error('Incomplete chunked response body');
        }
        if (this.options.contentLength !== undefined && this.receivedLength < this.options.contentLength) {
            // 修改原因：Content-Length 声明了正常完成边界，提前 close 不是正常 EOF，不能 StringDecoder.end() 制造 U+FFFD。
            // 修改方式：在 final flush 前检查已收 body bytes 数量，不足则抛截断错误。
            // 修改目的：确保只有完整 non-chunked body 才执行 decoder final flush。
            throw new Error(`Incomplete response body: expected ${this.options.contentLength} bytes, received ${this.receivedLength}`);
        }
        this.completed = true;
        const flushed = this.decoder.end();
        return flushed ? [flushed] : [];
    }

    private writeChunked(data: Buffer): string[] {
        this.chunkedBuffer = Buffer.concat([this.chunkedBuffer, data]);
        const result = extractHttpChunkedPayloads(this.chunkedBuffer);
        if (result.status === 'invalid') {
            this.chunkedBuffer = result.remaining;
            throw result.error;
        }

        this.chunkedBuffer = result.remaining;
        const chunks: string[] = [];
        for (const payload of result.payloads) {
            const decoded = this.decoder.write(payload);
            if (decoded) {
                chunks.push(decoded);
            }
        }

        if (result.status === 'complete') {
            this.completed = true;
            const flushed = this.decoder.end();
            if (flushed) {
                chunks.push(flushed);
            }
        }
        return chunks;
    }

    private writeNonChunked(data: Buffer): string[] {
        const remainingLength = this.options.contentLength === undefined
            ? data.length
            : Math.max(0, this.options.contentLength - this.receivedLength);
        const bodyBytes = this.options.contentLength === undefined ? data : data.subarray(0, remainingLength);
        this.receivedLength += bodyBytes.length;

        const chunks: string[] = [];
        const decoded = this.decoder.write(bodyBytes);
        if (decoded) {
            chunks.push(decoded);
        }

        if (this.options.contentLength !== undefined && this.receivedLength >= this.options.contentLength) {
            this.completed = true;
            const flushed = this.decoder.end();
            if (flushed) {
                chunks.push(flushed);
            }
        }
        return chunks;
    }
}

/**
 * 创建一个支持代理的 fetch 函数
 *
 * @param proxyUrl 代理地址（可选），如 http://127.0.0.1:7890
 * @returns fetch 函数
 */
export function createProxyFetch(proxyUrl?: string) {
    if (!proxyUrl) {
        // 无代理，使用原生 fetch
        return fetch;
    }
    
    return async (url: string | URL, init?: RequestInit): Promise<Response> => {
        const targetUrl = typeof url === 'string' ? new URL(url) : url;
        const options: FetchOptions = {
            method: init?.method || 'GET',
            headers: {
                'User-Agent': USER_AGENT,
                ...(init?.headers as Record<string, string> || {})
            },
            body: init?.body as string | undefined,
            timeout: 120000,
            signal: init?.signal  // 传递 abort signal
        };
        
        const response = await fetchWithProxy(targetUrl, options, proxyUrl);
        
        // 转换为标准 Response 对象
        const responseText = await response.text();
        return new Response(responseText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        });
    };
}

/**
 * 通过 HTTP 代理发起请求（CONNECT 隧道方式）
 */
async function fetchWithProxy(
    targetUrl: URL,
    init: FetchOptions,
    proxyUrl: string
): Promise<FetchResponse> {
    const proxyParsed = new URL(proxyUrl);
    const targetHost = targetUrl.hostname;
    const targetPort = targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80);
    const isHttps = targetUrl.protocol === 'https:';
    
    // 检查是否已取消
    if (init.signal?.aborted) {
        throw new Error('Request cancelled');
    }
    
    return new Promise((resolve, reject) => {
        const timeout = init.timeout || 120000;
        
        // 创建到代理的连接
        const proxyReq = http.request({
            hostname: proxyParsed.hostname,
            port: proxyParsed.port || 80,
            method: 'CONNECT',
            path: `${targetHost}:${targetPort}`,
            timeout
        });
        
        // 监听取消信号
        const onAbort = () => {
            proxyReq.destroy();
            reject(new Error('Request cancelled'));
        };
        if (init.signal) {
            init.signal.addEventListener('abort', onAbort, { once: true });
        }
        
        proxyReq.on('connect', (res, socket) => {
            if (res.statusCode !== 200) {
                socket.destroy();
                reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
                return;
            }
            
            if (isHttps) {
                // 在隧道上建立 TLS 连接
                const tlsSocket = tls.connect({
                    socket: socket,
                    servername: targetHost,
                    rejectUnauthorized: false // 允许自签名证书（抓包用）
                }, () => {
                    sendRequestOverSocket(tlsSocket, targetUrl, init, resolve, reject);
                });
                
                tlsSocket.on('error', (error: Error) => {
                    reject(new Error(`TLS error: ${error.message}`));
                });
            } else {
                // HTTP 请求直接通过隧道
                sendRequestOverSocket(socket, targetUrl, init, resolve, reject);
            }
        });
        
        proxyReq.on('error', (error) => {
            if (init.signal) {
                init.signal.removeEventListener('abort', onAbort);
            }
            reject(new Error(`Proxy request failed: ${error.message}`));
        });
        
        proxyReq.on('timeout', () => {
            if (init.signal) {
                init.signal.removeEventListener('abort', onAbort);
            }
            proxyReq.destroy();
            reject(new Error('Proxy request timeout'));
        });
        
        proxyReq.end();
    });
}

/**
 * 通过 socket 发送 HTTP 请求
 */
function sendRequestOverSocket(
    socket: tls.TLSSocket | import('net').Socket,
    targetUrl: URL,
    init: FetchOptions,
    resolve: (response: FetchResponse) => void,
    reject: (error: Error) => void
): void {
    // 检查是否已取消
    if (init.signal?.aborted) {
        socket.destroy();
        reject(new Error('Request cancelled'));
        return;
    }
    
    const body = init.body || '';
    const bodyBuffer = Buffer.from(body, 'utf8');
    
    // 监听取消信号
    let aborted = false;
    const onAbort = () => {
        if (aborted) return;
        aborted = true;
        socket.destroy();
        reject(new Error('Request cancelled'));
    };
    if (init.signal) {
        init.signal.addEventListener('abort', onAbort, { once: true });
    }
    
    // 清理函数
    const cleanup = () => {
        if (init.signal) {
            init.signal.removeEventListener('abort', onAbort);
        }
    };
    
    // 发送实际的 HTTP 请求
    const requestLine = `${init.method} ${targetUrl.pathname}${targetUrl.search} HTTP/1.1\r\n`;
    
    // 确保 User-Agent 被包含
    const headersWithUserAgent = { 'User-Agent': USER_AGENT, ...init.headers };
    const headers = [
        `Host: ${targetUrl.hostname}`,
        ...Object.entries(headersWithUserAgent).map(([k, v]) => `${k}: ${v}`),
        `Content-Length: ${bodyBuffer.length}`,
        'Connection: close',
        '',
        ''
    ].join('\r\n');
    
    socket.write(requestLine + headers);
    if (body) {
        socket.write(bodyBuffer);
    }
    
    // 收集响应数据
    const chunks: Buffer[] = [];
    let headersParsed = false;
    let responseFinished = false;
    let statusCode = 0;
    let statusText = '';
    let contentLength = -1;
    let isChunked = false;
    let headerEndIndex = -1;
    let responseHeaders: Record<string, string> = {};
    
    const tryParseHeaders = (fullBuffer: Buffer): boolean => {
        const headerEndMarker = Buffer.from('\r\n\r\n');
        headerEndIndex = fullBuffer.indexOf(headerEndMarker);
        
        if (headerEndIndex === -1) {
            return false;
        }
        
        const headerPart = fullBuffer.subarray(0, headerEndIndex).toString('utf8');
        
        const lines = headerPart.split('\r\n');
        const statusLine = lines[0];
        const statusMatch = statusLine.match(/HTTP\/\d\.\d (\d+) (.+)/);
        statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
        statusText = statusMatch ? statusMatch[2] : '';
        
        for (const line of lines.slice(1)) {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim().toLowerCase();
                const value = line.substring(colonIndex + 1).trim();
                responseHeaders[key] = value;
                
                if (key === 'content-length') {
                    contentLength = parseInt(value);
                } else if (key === 'transfer-encoding' && value.includes('chunked')) {
                    isChunked = true;
                }
            }
        }
        
        headersParsed = true;
        return true;
    };
    
    const isResponseComplete = (fullBuffer: Buffer): boolean => {
        if (!headersParsed) {
            return false;
        }
        
        const bodyBuffer = fullBuffer.subarray(headerEndIndex + 4);
        
        if (isChunked) {
            const endMarker = Buffer.from('0\r\n\r\n');
            const hasEnd = bodyBuffer.includes(endMarker);
            const hasEndAlt = bodyBuffer.toString('utf8').includes('\r\n0\r\n');
            return hasEnd || hasEndAlt;
        } else if (contentLength >= 0) {
            return bodyBuffer.length >= contentLength;
        }
        
        return false;
    };
    
    const finishResponse = () => {
        if (responseFinished || aborted) {
            return;
        }
        responseFinished = true;
        cleanup();
        
        const fullBuffer = Buffer.concat(chunks);
        const bodyBuffer = fullBuffer.subarray(headerEndIndex + 4);
        
        let finalBody: string;
        
        if (isChunked) {
            finalBody = decodeChunkedBuffer(bodyBuffer);
        } else {
            finalBody = bodyBuffer.toString('utf8');
        }
        
        resolve({
            ok: statusCode >= 200 && statusCode < 300,
            status: statusCode,
            statusText,
            headers: responseHeaders,
            text: async () => finalBody,
            json: async () => JSON.parse(finalBody),
            body: null
        });
    };
    
    socket.on('data', (chunk: Buffer) => {
        // 检查是否已取消
        if (aborted) return;
        
        chunks.push(chunk);
        
        const fullBuffer = Buffer.concat(chunks);
        
        if (!headersParsed) {
            if (tryParseHeaders(fullBuffer) && isResponseComplete(fullBuffer)) {
                // 使用 end() 进行优雅关闭，避免 ECONNRESET
                socket.end();
                finishResponse();
            }
        } else {
            if (isResponseComplete(fullBuffer)) {
                // 使用 end() 进行优雅关闭，避免 ECONNRESET
                socket.end();
                finishResponse();
            }
        }
    });
    
    socket.on('end', () => {
        if (aborted) return;
        cleanup();
        if (headersParsed) {
            finishResponse();
        } else {
            reject(new Error('Connection closed before headers received'));
        }
    });
    
    socket.on('close', () => {
        if (aborted) return;
        cleanup();
        if (headersParsed && !responseFinished) {
            finishResponse();
        }
    });
    
    socket.on('error', (err) => {
        if (aborted) return;
        cleanup();
        reject(err);
    });
}

/**
 * 解码 chunked transfer encoding
 */
function decodeChunkedBuffer(data: Buffer): string {
    const resultChunks: Buffer[] = [];
    let offset = 0;
    
    while (offset < data.length) {
        // 查找 chunk size 行的结束 (\r\n)
        let sizeEnd = -1;
        for (let i = offset; i < data.length - 1; i++) {
            if (data[i] === 0x0d && data[i + 1] === 0x0a) {
                sizeEnd = i;
                break;
            }
        }
        
        if (sizeEnd === -1) {
            break;
        }
        
        // 解析 chunk size（十六进制）
        const sizeLine = data.subarray(offset, sizeEnd).toString('ascii');
        const chunkSize = parseInt(sizeLine.trim(), 16);
        
        if (chunkSize === 0 || isNaN(chunkSize)) {
            break;
        }
        
        // 计算 chunk 数据的位置
        const chunkDataStart = sizeEnd + 2;
        const chunkDataEnd = chunkDataStart + chunkSize;
        
        if (chunkDataEnd > data.length) {
            break;
        }
        
        // 提取 chunk 数据
        resultChunks.push(data.subarray(chunkDataStart, chunkDataEnd));
        
        // 移动到下一个 chunk
        offset = chunkDataEnd + 2;
    }
    
    return Buffer.concat(resultChunks).toString('utf8');
}

/**
 * 创建支持代理的流式 fetch
 *
 * 返回一个异步生成器，产出原始响应行
 */
export async function* proxyStreamFetch(
    url: string,
    init: FetchOptions,
    proxyUrl?: string
): AsyncGenerator<string> {
    if (!proxyUrl) {
        // 无代理，使用原生 fetch
        const headersWithUserAgent = { 'User-Agent': USER_AGENT, ...init.headers };
        const response = await fetch(url, {
            method: init.method,
            headers: headersWithUserAgent,
            body: init.body,
            signal: init.signal
        });
        
        if (init.signal?.aborted) {
            throw createAbortError();
        }
        
        if (!response.ok) {
            let errorBody: any;
            try {
                errorBody = await response.json();
            } catch {
                errorBody = await response.text();
            }
            throw new ChannelError(
                ErrorType.API_ERROR,
                t('modules.channel.errors.apiError', { status: response.status }),
                errorBody
            );
        }
        
        if (!response.body) {
            throw new Error('No response body');
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let completedNormally = false;
        
        try {
            while (true) {
                // 修改原因：abort 不是正常 EOF，不能 break 后继续 final flush，否则会把中断造成的半截 UTF-8 当成功输出。
                // 修改方式：发现 abort 时取消 reader 并抛 AbortError，让上层按取消/超时路径处理。
                // 修改目的：保证 no-proxy 分支也遵守“取消/超时不 flush 半截字节、不作为成功完成”的 approved 约束。
                if (init.signal?.aborted) {
                    await reader.cancel();
                    throw createAbortError();
                }
                const { done, value } = await reader.read();
                if (done) {
                    completedNormally = true;
                    break;
                }
                yield decoder.decode(value, { stream: true });
            }
            if (completedNormally) {
                // 修改原因：无代理分支也使用 streaming TextDecoder，结束时可能还有 decoder 内部残留文本需要 flush。
                // 修改方式：只在 reader 自然 done 后调用 decoder.decode()，并仅在产生文本时继续 yield。
                // 修改目的：补齐 decoder 生命周期，同时避免 abort/timeout 后输出半截尾部。
                const flushed = decoder.decode();
                if (flushed) {
                    yield flushed;
                }
            }
        } finally {
            reader.releaseLock();
        }
        return;
    }
    
    // 使用代理
    const targetUrl = new URL(url);
    const proxyParsed = new URL(proxyUrl);
    const targetHost = targetUrl.hostname;
    const targetPort = targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80);
    const isHttps = targetUrl.protocol === 'https:';
    
    // 检查是否已取消
    if (init.signal?.aborted) {
        throw createAbortError();
    }
    
    const socket = await new Promise<tls.TLSSocket | import('net').Socket>((resolve, reject) => {
        const timeout = init.timeout || 120000;
        let settled = false;
        let proxyReq: http.ClientRequest | null = null;

        const cleanupAbortListener = () => {
            if (init.signal) {
                init.signal.removeEventListener('abort', onAbort);
            }
        };

        const finishResolve = (targetSocket: tls.TLSSocket | import('net').Socket) => {
            if (settled) return;
            settled = true;
            cleanupAbortListener();
            resolve(targetSocket);
        };

        const finishReject = (error: Error) => {
            if (settled) return;
            settled = true;
            cleanupAbortListener();
            reject(error);
        };
        
        // 监听取消信号
        const onAbort = () => {
            proxyReq?.destroy(createAbortError());
            finishReject(createAbortError());
        };

        if (init.signal) {
            if (init.signal.aborted) {
                onAbort();
                return;
            }
            init.signal.addEventListener('abort', onAbort, { once: true });
        }
        
        proxyReq = http.request({
            hostname: proxyParsed.hostname,
            port: proxyParsed.port || 80,
            method: 'CONNECT',
            path: `${targetHost}:${targetPort}`,
            timeout
        });
        
        proxyReq.on('connect', (res, socket) => {
            if (res.statusCode !== 200) {
                socket.destroy();
                finishReject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
                return;
            }
            
            if (isHttps) {
                const tlsSocket = tls.connect({
                    socket: socket,
                    servername: targetHost,
                    rejectUnauthorized: false
                }, () => {
                    finishResolve(tlsSocket);
                });
                
                tlsSocket.on('error', (error: Error) => {
                    finishReject(new Error(`TLS error: ${error.message}`));
                });
            } else {
                finishResolve(socket);
            }
        });
        
        proxyReq.on('error', (error) => {
            finishReject(new Error(`Proxy request failed: ${error.message}`));
        });
        
        proxyReq.on('timeout', () => {
            proxyReq?.destroy();
            finishReject(new Error('Proxy request timeout'));
        });
        
        proxyReq.end();
    });
    
    // 发送请求
    const body = init.body || '';
    const bodyBuffer = Buffer.from(body, 'utf8');
    
    const requestLine = `${init.method} ${targetUrl.pathname}${targetUrl.search} HTTP/1.1\r\n`;
    
    // 修改原因：手写代理流式 decoder 只支持 identity body；若调用方传入 gzip/br，会把压缩字节误解为 UTF-8。
    // 修改方式：集中构造请求头，大小写不敏感地覆盖 Accept-Encoding，并避免 Host/Content-Length/Connection 重复。
    // 修改目的：让代理流式响应进入受控的 identity UTF-8 解码路径，满足 approved 方案的压缩处理约束。
    const streamHeaders = [
        ...buildProxyStreamRequestHeaders(targetUrl.hostname, init.headers, bodyBuffer.length),
        '',
        ''
    ].join('\r\n');
    
    socket.write(requestLine + streamHeaders);
    if (body) {
        socket.write(bodyBuffer);
    }
    
    // 读取响应
    let rawBuffer = Buffer.alloc(0);
    let headersParsed = false;
    let statusCode = 0;
    let isChunked = false;
    let contentLength: number | undefined;
    let isErrorResponse = false;
    let bodyReader: ProxyStreamBodyDecoder | undefined;
    let responseHeaders: Record<string, string> = {};
    const dataQueue: string[] = [];
    const errorBodyChunks: string[] = [];
    
    // 监听取消信号
    const onAbort = () => {
        // 修改原因：代理流式 abort 不能优雅 FIN 后自然 resolve，否则上层会把取消/超时误判为成功结束。
        // 修改方式：直接 destroy socket 触发异常路径，并由 readData/onAbort 统一抛 AbortError。
        // 修改目的：确保取消/超时不 flush 半截 UTF-8，也不会吞掉 cancellation signal。
        socket.destroy(createAbortError());
    };
    if (init.signal) {
        init.signal.addEventListener('abort', onAbort, { once: true });
    }
    
    // 使用事件监听器代替 for await，避免提前中断时 socket 被自动销毁导致 RST
    // for await 在被提前终止时会销毁流，发送 RST 包而不是 FIN，导致 ECONNRESET
    try {
        // 修改原因：success body 与 error body 都必须经过同一套 transfer framing + UTF-8 stateful decode，不允许再在 header 后直接 toString。
        // 修改方式：headers 解析完成后创建 ProxyStreamBodyDecoder，success chunks 入 dataQueue，error chunks 入 errorBodyChunks。
        // 修改目的：保留现有异步队列 yield 结构，同时修复代理流式响应和错误详情中的跨边界 UTF-8 损坏。
        const createApiError = (): ChannelError => {
            const errorBody = errorBodyChunks.join('');
            let parsedError: any;
            try {
                parsedError = JSON.parse(errorBody);
            } catch {
                parsedError = errorBody;
            }
            return new ChannelError(
                ErrorType.API_ERROR,
                t('modules.channel.errors.apiError', { status: statusCode }),
                parsedError
            );
        };

        const ensureBodyReader = (): ProxyStreamBodyDecoder => {
            if (!bodyReader) {
                bodyReader = new ProxyStreamBodyDecoder({ isChunked, contentLength });
            }
            return bodyReader;
        };

        const parseHeaders = (headerPart: string): void => {
            const lines = headerPart.split('\r\n');
            const statusMatch = lines[0]?.match(/HTTP\/\d\.\d (\d+)/);
            statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;
            responseHeaders = {};
            isChunked = false;
            contentLength = undefined;

            for (const line of lines.slice(1)) {
                const colonIndex = line.indexOf(':');
                if (colonIndex <= 0) continue;
                const key = line.substring(0, colonIndex).trim().toLowerCase();
                const value = line.substring(colonIndex + 1).trim();
                responseHeaders[key] = value;
                if (key === 'transfer-encoding' && value.toLowerCase().includes('chunked')) {
                    isChunked = true;
                } else if (key === 'content-length') {
                    const parsed = parseInt(value, 10);
                    contentLength = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
                }
            }

            const contentEncoding = responseHeaders['content-encoding'];
            if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
                throw new Error(`Unsupported proxy stream content-encoding: ${contentEncoding}`);
            }
            isErrorResponse = statusCode < 200 || statusCode >= 300;
            headersParsed = true;
        };

        const completeBody = (finishReject: (error: Error) => void, finishResolve: () => void): void => {
            if (isErrorResponse) {
                finishReject(createApiError());
            } else {
                finishResolve();
            }
        };

        const appendDecodedChunks = (chunks: string[]): void => {
            if (isErrorResponse) {
                errorBodyChunks.push(...chunks);
            } else {
                dataQueue.push(...chunks);
            }
        };

        const processBodyBytes = (
            bytes: Buffer,
            finishReject: (error: Error) => void,
            finishResolve: () => void
        ): void => {
            if (bytes.length === 0) return;
            const reader = ensureBodyReader();
            const decodedChunks = reader.write(bytes);
            appendDecodedChunks(decodedChunks);
            if (reader.isComplete) {
                completeBody(finishReject, finishResolve);
            }
        };

        const finishBodyAtConnectionEnd = (
            finishReject: (error: Error) => void,
            finishResolve: () => void
        ): void => {
            try {
                if (bodyReader) {
                    appendDecodedChunks(bodyReader.finish());
                } else if (isChunked) {
                    // 修改原因：chunked response 的正常完成必须以 0-size chunk/trailer 为边界，header 后直接 close 不是完整 body。
                    // 修改方式：headers 已标记 chunked 但还没有 bodyReader 时，连接结束直接报 incomplete chunked body。
                    // 修改目的：防止 chunked header-only premature close 被当成正常 EOF。
                    throw new Error('Incomplete chunked response body');
                } else if (contentLength !== undefined && contentLength > 0) {
                    // 修改原因：Content-Length > 0 但未创建 bodyReader 表示一个 body byte 都没收到，不能正常完成。
                    // 修改方式：连接结束时按截断 body 报错。
                    // 修改目的：防止 declared-length response header-only close 被 final-complete。
                    throw new Error(`Incomplete response body: expected ${contentLength} bytes, received 0`);
                }
                completeBody(finishReject, finishResolve);
            } catch (error) {
                finishReject(error instanceof Error ? error : new Error(String(error)));
            }
        };

        // 创建数据读取 Promise
        const readData = (): Promise<void> => {
            return new Promise((resolve, reject) => {
                let settled = false;

                const cleanup = () => {
                    socket.removeListener('data', onData);
                    socket.removeListener('end', onEnd);
                    socket.removeListener('close', onClose);
                    socket.removeListener('error', onError);
                };

                const finishResolve = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve();
                };

                const finishReject = (error: Error) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(error);
                };

                const onData = (chunk: Buffer) => {
                    if (init.signal?.aborted) {
                        finishReject(createAbortError());
                        return;
                    }

                    try {
                        rawBuffer = Buffer.concat([rawBuffer, chunk]);

                        if (!headersParsed) {
                            const headerEndMarker = Buffer.from('\r\n\r\n');
                            const headerEnd = rawBuffer.indexOf(headerEndMarker);
                            if (headerEnd === -1) {
                                return;
                            }

                            parseHeaders(rawBuffer.subarray(0, headerEnd).toString('utf8'));
                            rawBuffer = rawBuffer.subarray(headerEnd + headerEndMarker.length);
                        }

                        if (rawBuffer.length > 0) {
                            const bodyBytes = rawBuffer;
                            rawBuffer = Buffer.alloc(0);
                            processBodyBytes(bodyBytes, finishReject, finishResolve);
                        }
                    } catch (error) {
                        finishReject(error instanceof Error ? error : new Error(String(error)));
                    }
                };
                
                const onEnd = () => {
                    if (init.signal?.aborted) {
                        finishReject(createAbortError());
                        return;
                    }
                    if (!headersParsed) {
                        finishReject(new Error('Connection closed before response headers received'));
                        return;
                    }
                    finishBodyAtConnectionEnd(finishReject, finishResolve);
                };
                
                const onClose = () => {
                    if (init.signal?.aborted) {
                        finishReject(createAbortError());
                        return;
                    }
                    if (!headersParsed) {
                        finishReject(new Error('Connection closed before response headers received'));
                        return;
                    }
                    finishBodyAtConnectionEnd(finishReject, finishResolve);
                };
                
                const onError = (err: Error) => {
                    if (init.signal?.aborted) {
                        finishReject(createAbortError());
                        return;
                    }
                    finishReject(err);
                };

                if (init.signal?.aborted) {
                    finishReject(createAbortError());
                    return;
                }
                
                socket.on('data', onData);
                socket.on('end', onEnd);
                socket.on('close', onClose);
                socket.on('error', onError);
            });
        };
        
        let readPromise: Promise<void> | null = null;
        let readError: unknown = null;
        let isReading = true;
        
        // 启动后台数据读取
        readPromise = readData()
            .catch((err: unknown) => {
                readError = err;
            })
            .finally(() => {
                isReading = false;
            });
        
        // 使用轮询方式 yield 数据，避免阻塞
        while (isReading || dataQueue.length > 0) {
            if (init.signal?.aborted) {
                throw createAbortError();
            }
            
            if (dataQueue.length > 0) {
                yield dataQueue.shift()!;
            } else if (isReading) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        if (readPromise) {
            await readPromise;
        }

        if (readError) {
            throw readError;
        }

    } finally {
        // 移除取消信号监听
        if (init.signal) {
            init.signal.removeEventListener('abort', onAbort);
        }
        
        // 优雅关闭 socket，等待完全关闭避免 ECONNRESET
        await new Promise<void>((resolve) => {
            // 如果 socket 已经关闭或销毁，直接返回
            if (socket.destroyed || !socket.writable) {
                resolve();
                return;
            }
            
            // 设置超时，防止无限等待
            const closeTimeout = setTimeout(() => {
                if (!socket.destroyed) {
                    socket.destroy();
                }
                resolve();
            }, 1000);
            
            // 监听 close 事件
            socket.once('close', () => {
                clearTimeout(closeTimeout);
                resolve();
            });
            
            if (init.signal?.aborted) {
                socket.destroy(createAbortError());
                return;
            }
            
            // 发送 FIN 开始优雅关闭
            socket.end();
        });
    }
}