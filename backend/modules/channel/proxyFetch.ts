/**
 * LimCode - 代理 Fetch 实现
 *
 * 支持通过 HTTP 代理发起 HTTPS 请求（CONNECT 隧道方式）
 */

import { t } from '../../i18n';
import * as https from 'https';
import * as http from 'http';
import * as tls from 'tls';
import { URL } from 'url';
import { ChannelError, ErrorType } from './types';

// User-Agent 标识
const USER_AGENT = 'LimCode';

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
        
        try {
            while (true) {
                // 检查是否已取消
                if (init.signal?.aborted) {
                    reader.cancel();
                    break;
                }
                const { done, value } = await reader.read();
                if (done) break;
                yield decoder.decode(value, { stream: true });
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
        throw new Error('Request cancelled');
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
            proxyReq?.destroy();
            finishReject(new Error('Request cancelled'));
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
    
    // 确保 User-Agent 被包含
    const headersWithUserAgent = { 'User-Agent': USER_AGENT, ...init.headers };
    const streamHeaders = [
        `Host: ${targetUrl.hostname}`,
        ...Object.entries(headersWithUserAgent).map(([k, v]) => `${k}: ${v}`),
        `Content-Length: ${bodyBuffer.length}`,
        'Connection: close',
        '',
        ''
    ].join('\r\n');
    
    socket.write(requestLine + streamHeaders);
    if (body) {
        socket.write(bodyBuffer);
    }
    
    // 读取响应
    let rawBuffer = Buffer.alloc(0);  // 使用 Buffer 处理原始数据
    let headersParsed = false;
    let statusCode = 0;
    let isChunked = false;
    let chunkedBuffer = Buffer.alloc(0);  // chunked 解码缓冲区
    
    // 监听取消信号
    const onAbort = () => {
        socket.end();
    };
    if (init.signal) {
        init.signal.addEventListener('abort', onAbort, { once: true });
    }
    
    /**
     * 实时解码 chunked 数据
     * 返回已解码的数据和剩余的未完成 chunk
     */
    const decodeChunkedStream = (data: Buffer): { decoded: string, remaining: Buffer } => {
        let decoded = '';
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
                // 没找到完整的 size 行，保留剩余数据
                break;
            }
            
            // 解析 chunk size（十六进制）
            const sizeLine = data.subarray(offset, sizeEnd).toString('ascii').trim();
            const chunkSize = parseInt(sizeLine, 16);
            
            if (isNaN(chunkSize)) {
                // 无效的 size，跳过这行
                offset = sizeEnd + 2;
                continue;
            }
            
            if (chunkSize === 0) {
                // 结束标记
                offset = data.length;
                break;
            }
            
            // 计算 chunk 数据的位置
            const chunkDataStart = sizeEnd + 2;
            const chunkDataEnd = chunkDataStart + chunkSize;
            
            if (chunkDataEnd + 2 > data.length) {
                // 数据不完整，保留从 offset 开始的所有数据
                break;
            }
            
            // 提取并解码 chunk 数据
            decoded += data.subarray(chunkDataStart, chunkDataEnd).toString('utf8');
            
            // 移动到下一个 chunk（跳过 \r\n）
            offset = chunkDataEnd + 2;
        }
        
        return {
            decoded,
            remaining: data.subarray(offset)
        };
    };
    
    // 使用事件监听器代替 for await，避免提前中断时 socket 被自动销毁导致 RST
    // for await 在被提前终止时会销毁流，发送 RST 包而不是 FIN，导致 ECONNRESET
    try {
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
                    // 检查是否已取消
                    if (init.signal?.aborted) {
                        finishResolve();
                        return;
                    }
                    
                    rawBuffer = Buffer.concat([rawBuffer, chunk]);
                    
                    if (!headersParsed) {
                        const headerEndMarker = Buffer.from('\r\n\r\n');
                        const headerEnd = rawBuffer.indexOf(headerEndMarker);
                        
                        if (headerEnd !== -1) {
                            const headerPart = rawBuffer.subarray(0, headerEnd).toString('utf8');
                            const statusMatch = headerPart.match(/HTTP\/\d\.\d (\d+)/);
                            statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
                            
                            // 检查是否是 chunked 编码
                            if (headerPart.toLowerCase().includes('transfer-encoding: chunked')) {
                                isChunked = true;
                            }
                            
                            if (statusCode < 200 || statusCode >= 300) {
                                // 解析错误响应体
                                const errorBody = rawBuffer.subarray(headerEnd + 4).toString('utf8');
                                let parsedError: any;
                                try {
                                    parsedError = JSON.parse(errorBody);
                                } catch {
                                    parsedError = errorBody;
                                }
                                finishReject(new ChannelError(
                                    ErrorType.API_ERROR,
                                    t('modules.channel.errors.apiError', { status: statusCode }),
                                    parsedError
                                ));
                                return;
                            }
                            
                            headersParsed = true;
                            rawBuffer = rawBuffer.subarray(headerEnd + 4);
                        }
                    }
                    
                    if (headersParsed && rawBuffer.length > 0) {
                        if (isChunked) {
                            // 实时解码 chunked 数据
                            chunkedBuffer = Buffer.concat([chunkedBuffer, rawBuffer]);
                            rawBuffer = Buffer.alloc(0);
                            
                            const { decoded, remaining } = decodeChunkedStream(chunkedBuffer);
                            chunkedBuffer = Buffer.from(remaining);
                            
                            if (decoded) {
                                // 使用队列存储数据，稍后 yield
                                dataQueue.push(decoded);
                            }
                        } else {
                            // 非 chunked，直接存储
                            dataQueue.push(rawBuffer.toString('utf8'));
                            rawBuffer = Buffer.alloc(0);
                        }
                    }
                };
                
                const onEnd = () => {
                    if (init.signal?.aborted) {
                        finishResolve();
                        return;
                    }
                    if (!headersParsed) {
                        finishReject(new Error('Connection closed before response headers received'));
                        return;
                    }
                    finishResolve();
                };
                
                const onClose = () => {
                    if (init.signal?.aborted) {
                        finishResolve();
                        return;
                    }
                    if (!headersParsed) {
                        finishReject(new Error('Connection closed before response headers received'));
                        return;
                    }
                    finishResolve();
                };
                
                const onError = (err: Error) => {
                    if (init.signal?.aborted) {
                        finishResolve();
                        return;
                    }
                    finishReject(err);
                };

                if (init.signal?.aborted) {
                    finishResolve();
                    return;
                }
                
                socket.on('data', onData);
                socket.on('end', onEnd);
                socket.on('close', onClose);
                socket.on('error', onError);
            });
        };
        
        // 数据队列
        const dataQueue: string[] = [];
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
            // 检查是否已取消
            if (init.signal?.aborted) {
                break;
            }
            
            if (dataQueue.length > 0) {
                yield dataQueue.shift()!;
            } else if (isReading) {
                // 等待一小段时间后重试
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // 等待读取完成
        if (readPromise) {
            await readPromise;
        }

        if (readError) {
            throw readError;
        }

        // 处理剩余数据
        if (!init.signal?.aborted) {
            if (isChunked && chunkedBuffer.length > 0) {
                const { decoded } = decodeChunkedStream(chunkedBuffer);
                if (decoded) {
                    yield decoded;
                }
            } else if (rawBuffer.length > 0) {
                yield rawBuffer.toString('utf8');
            }
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
            
            // 发送 FIN 开始优雅关闭
            socket.end();
        });
    }
}