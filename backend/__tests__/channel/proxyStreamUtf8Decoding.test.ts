import * as net from 'net';
import {
    buildProxyStreamRequestHeaders,
    extractHttpChunkedPayloads,
    ProxyStreamBodyDecoder,
    proxyStreamFetch
} from '../../modules/channel/proxyFetch';
import { ChannelManager } from '../../modules/channel/ChannelManager';
import { ChannelError, ErrorType } from '../../modules/channel/types';

function frame(payload: Buffer): Buffer {
    return Buffer.concat([
        Buffer.from(`${payload.length.toString(16)}\r\n`, 'ascii'),
        payload,
        Buffer.from('\r\n', 'ascii')
    ]);
}

async function startFakeConnectProxy(
    onTunnelRequest: (socket: net.Socket, requestText: string) => void
): Promise<{ server: net.Server; proxyUrl: string }> {
    // 修改原因：proxyStreamFetch 的真实风险发生在 HTTP CONNECT 隧道后的 socket 流式读取，而纯函数测试无法证明真实入口仍保持增量 yield。
    // 修改方式：用本地 net.Server 模拟最小 CONNECT 代理，先返回 200，再让测试控制隧道内的 HTTP 响应字节。
    // 修改目的：覆盖生产 proxyStreamFetch 入口，同时避免真实网络、TLS 和外部代理带来的不确定性。
    const server = net.createServer((socket) => {
        let phase: 'connect' | 'request' | 'handled' = 'connect';
        let buffer = '';

        socket.on('data', (chunk) => {
            buffer += chunk.toString('binary');
            if (phase === 'connect' && buffer.includes('\r\n\r\n')) {
                phase = 'request';
                buffer = '';
                socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                return;
            }

            if (phase === 'request' && buffer.includes('\r\n\r\n')) {
                phase = 'handled';
                onTunnelRequest(socket, Buffer.from(buffer, 'binary').toString('utf8'));
            }
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to bind fake proxy server');
    }

    return {
        server,
        proxyUrl: `http://127.0.0.1:${address.port}`
    };
}

async function closeServer(server: net.Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}

describe('proxy stream UTF-8 decoding', () => {
    it('builds proxy stream headers with identity encoding overriding caller compression headers', () => {
        // 修改原因：手写代理流式路径没有 streaming decompression，测试必须锁定 approved 的 identity encoding 策略。
        // 修改方式：传入小写 accept-encoding:gzip，断言输出只包含 Accept-Encoding: identity。
        // 修改目的：防止未来 header 合并回退成 gzip/br 压缩字节直入 UTF-8 decoder。
        const headers = buildProxyStreamRequestHeaders('example.com', {
            Authorization: 'Bearer token',
            'accept-encoding': 'gzip',
            Connection: 'keep-alive'
        }, 12);

        expect(headers).toContain('Accept-Encoding: identity');
        expect(headers).toContain('Authorization: Bearer token');
        expect(headers.some(header => header.toLowerCase() === 'accept-encoding: gzip')).toBe(false);
        expect(headers.some(header => header.toLowerCase() === 'connection: keep-alive')).toBe(false);
    });

    it('extracts chunked payloads with split framing, extensions, trailers and invalid framing states', () => {
        // 修改原因：旧 chunked parser 遇到 invalid size 会静默跳过，并且没有 trailer / extension 的明确语义。
        // 修改方式：直接喂精确 Buffer，断言状态机对 need_more_data、complete、invalid 三类状态都可观察。
        // 修改目的：保证 HTTP framing 不会再次和 UTF-8 body 解码混在一起。
        const splitSize = extractHttpChunkedPayloads(Buffer.from('2\r', 'ascii'));
        expect(splitSize.status).toBe('need_more_data');
        expect(splitSize.remaining.toString('ascii')).toBe('2\r');

        const complete = extractHttpChunkedPayloads(Buffer.concat([
            Buffer.from('2;foo=bar\r\n', 'ascii'),
            Buffer.from([0xe4, 0xbd]),
            Buffer.from('\r\n1\r\n', 'ascii'),
            Buffer.from([0xa0]),
            Buffer.from('\r\n0\r\nX-Trailer: y\r\n\r\n', 'ascii')
        ]));
        expect(complete.status).toBe('complete');
        expect(complete.payloads.map(payload => Array.from(payload))).toEqual([[0xe4, 0xbd], [0xa0]]);

        const invalidSize = extractHttpChunkedPayloads(Buffer.from('z\r\nabc\r\n', 'ascii'));
        expect(invalidSize.status).toBe('invalid');

        const invalidTerminator = extractHttpChunkedPayloads(Buffer.from('1\r\naXX', 'ascii'));
        expect(invalidTerminator.status).toBe('invalid');
    });

    it('decodes UTF-8 across chunked transfer payload boundaries without manufacturing U+FFFD', () => {
        // 修改原因：用户看到的 � 来自有效 UTF-8 多字节字符被 HTTP chunk 边界切开后逐块 toString。
        // 修改方式：把 “你” 的 E4 BD A0 拆到两个 HTTP chunk payload 中，经同一个 ProxyStreamBodyDecoder 解码。
        // 修改目的：证明修复命中真实 chunked body 风险，而不是只演示 Node StringDecoder 行为。
        const decoder = new ProxyStreamBodyDecoder({ isChunked: true });
        const chunks = decoder.write(Buffer.concat([
            Buffer.from('2\r\n', 'ascii'),
            Buffer.from([0xe4, 0xbd]),
            Buffer.from('\r\n1\r\n', 'ascii'),
            Buffer.from([0xa0]),
            Buffer.from('\r\n0\r\n\r\n', 'ascii')
        ]));

        expect(chunks.join('')).toBe('你');
        expect(chunks.join('')).not.toContain('\uFFFD');
    });

    it('decodes UTF-8 across non-chunked socket data boundaries and preserves real U+FFFD', () => {
        // 修改原因：non-chunked 代理响应同样可能按 socket data 边界切开多字节字符，真实 U+FFFD 又必须被保留。
        // 修改方式：用同一个 decoder 依次写入半个 “你” 和被拆开的 EF BF BD。
        // 修改目的：同时防止无状态解码回归和错误的“过滤 replacement char”修复。
        const decoder = new ProxyStreamBodyDecoder({ isChunked: false, contentLength: 6 });
        const output = [
            ...decoder.write(Buffer.from([0xe4, 0xbd])),
            ...decoder.write(Buffer.from([0xa0, 0xef])),
            ...decoder.write(Buffer.from([0xbf, 0xbd]))
        ].join('');

        expect(output).toBe('你�');
    });

    it('yields the first proxied SSE event before socket close while UTF-8 bytes cross HTTP chunk boundaries', async () => {
        let secondEventWritten = false;
        const { server, proxyUrl } = await startFakeConnectProxy((socket, requestText) => {
            expect(requestText).toContain('Accept-Encoding: identity');
            socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/event-stream\r\n\r\n');
            socket.write(frame(Buffer.concat([
                Buffer.from('data: {"choices":[{"delta":{"content":"', 'utf8'),
                Buffer.from([0xe4, 0xbd])
            ])));
            socket.write(frame(Buffer.concat([
                Buffer.from([0xa0]),
                Buffer.from('"}}]}\n\n', 'utf8')
            ])));

            setTimeout(() => {
                secondEventWritten = true;
                socket.write(frame(Buffer.from('data: {"choices":[{"delta":{"content":"二"}}]}\n\n', 'utf8')));
                socket.write(Buffer.from('0\r\n\r\n', 'ascii'));
                socket.end();
            }, 80);
        });

        try {
            const stream = proxyStreamFetch('http://example.test/stream', {
                method: 'GET',
                headers: { 'accept-encoding': 'gzip' },
                timeout: 1000
            }, proxyUrl);

            let firstEvent = '';
            while (!firstEvent.includes('\n\n')) {
                const next = await stream.next();
                expect(next.done).toBe(false);
                firstEvent += next.value;
            }

            expect(firstEvent).toContain('你');
            expect(firstEvent).not.toContain('\uFFFD');
            expect(secondEventWritten).toBe(false);
            await stream.return?.(undefined as any);
        } finally {
            await closeServer(server);
        }
    });

    it('decodes non-2xx chunked error bodies with the same transfer and UTF-8 rules', async () => {
        const { server, proxyUrl } = await startFakeConnectProxy((socket) => {
            const bodyPrefix = Buffer.from('{"error":"', 'utf8');
            const bodySuffix = Buffer.from('"}', 'utf8');
            socket.write('HTTP/1.1 400 Bad Request\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n');
            socket.write(frame(Buffer.concat([bodyPrefix, Buffer.from([0xe4, 0xbd])])));
            socket.write(frame(Buffer.concat([Buffer.from([0xa0]), bodySuffix])));
            socket.write(Buffer.from('0\r\n\r\n', 'ascii'));
            socket.end();
        });

        try {
            const stream = proxyStreamFetch('http://example.test/error', {
                method: 'GET',
                headers: {},
                timeout: 1000
            }, proxyUrl);

            await expect(stream.next()).rejects.toMatchObject<Partial<ChannelError>>({
                name: 'ChannelError',
                details: { error: '你' }
            });
        } finally {
            await closeServer(server);
        }
    });


    it('waits for split payload CRLF before emitting a legal chunked payload', () => {
        // 修改原因：approved 测试矩阵要求覆盖 payload 已完整但结尾 CRLF 被拆开的合法 framing，避免 parser 提前消费或重复输出。
        // 修改方式：先写入 `1\r\na\r`，再写入 `\n0\r\n\r\n`，断言第一次无输出且第二次只输出一次 payload。
        // 修改目的：锁定 need_more_data -> complete 的 remaining 语义，防止 chunked framing 与 UTF-8 解码再次错位。
        const first = extractHttpChunkedPayloads(Buffer.from('1\r\na\r', 'ascii'));
        expect(first.status).toBe('need_more_data');
        expect(first.payloads).toHaveLength(0);
        expect(first.remaining.toString('ascii')).toBe('1\r\na\r');

        const decoder = new ProxyStreamBodyDecoder({ isChunked: true });
        expect(decoder.write(Buffer.from('1\r\na\r', 'ascii'))).toEqual([]);
        expect(decoder.write(Buffer.from('\n0\r\n\r\n', 'ascii'))).toEqual(['a']);
        expect(decoder.isComplete).toBe(true);
    });

    it('decodes non-2xx non-chunked JSON error bodies across socket data boundaries', async () => {
        const { server, proxyUrl } = await startFakeConnectProxy((socket) => {
            // 修改原因：Round 2 测试复核指出 non-chunked error body 尚未覆盖，可能重新引入 rawBuffer.toString 分片损坏。
            // 修改方式：返回 Content-Length error body，并把 “你” 的 UTF-8 bytes 拆到两次 socket.write 中。
            // 修改目的：证明非 chunked error body 也走 stateful decoder，且不会进入 success dataQueue。
            const body = Buffer.from('{"error":"你"}', 'utf8');
            socket.write(`HTTP/1.1 400 Bad Request\r\nContent-Length: ${body.length}\r\nContent-Type: application/json\r\n\r\n`);
            socket.write(Buffer.concat([Buffer.from('{"error":"', 'utf8'), Buffer.from([0xe4, 0xbd])]));
            setTimeout(() => {
                socket.write(Buffer.concat([Buffer.from([0xa0]), Buffer.from('"}', 'utf8')]));
                socket.end();
            }, 20);
        });

        try {
            const stream = proxyStreamFetch('http://example.test/error-json', {
                method: 'GET',
                headers: {},
                timeout: 1000
            }, proxyUrl);

            await expect(stream.next()).rejects.toMatchObject<Partial<ChannelError>>({
                name: 'ChannelError',
                details: { error: '你' }
            });
        } finally {
            await closeServer(server);
        }
    });

    it('keeps non-JSON non-chunked error bodies as strings', async () => {
        const { server, proxyUrl } = await startFakeConnectProxy((socket) => {
            // 修改原因：approved 方案要求 error body 能 JSON.parse 时为 object，否则保持 string，不能被吞掉或进入 success stream。
            // 修改方式：返回 non-chunked 纯文本错误，并把中文 UTF-8 拆到 socket data 边界。
            // 修改目的：覆盖 ChannelError.details 的 string fallback 形状。
            const body = Buffer.from('错误：你', 'utf8');
            socket.write(`HTTP/1.1 502 Bad Gateway\r\nContent-Length: ${body.length}\r\nContent-Type: text/plain\r\n\r\n`);
            socket.write(Buffer.concat([Buffer.from('错误：', 'utf8'), Buffer.from([0xe4, 0xbd])]));
            setTimeout(() => {
                socket.write(Buffer.from([0xa0]));
                socket.end();
            }, 20);
        });

        try {
            const stream = proxyStreamFetch('http://example.test/error-text', {
                method: 'GET',
                headers: {},
                timeout: 1000
            }, proxyUrl);

            await expect(stream.next()).rejects.toMatchObject<Partial<ChannelError>>({
                name: 'ChannelError',
                details: '错误：你'
            });
        } finally {
            await closeServer(server);
        }
    });

    it('rejects proxy stream aborts without resolving as a normal EOF', async () => {
        const controller = new AbortController();
        const { server, proxyUrl } = await startFakeConnectProxy((socket) => {
            // 修改原因：实现后后端复核指出代理 abort 曾经 socket.end + resolve，导致取消被伪装成成功结束。
            // 修改方式：发送一个已完成 HTTP chunk 但 UTF-8 仍不完整的 payload，让 stream.next() 挂起后触发 abort。
            // 修改目的：证明 abort 会 reject 为 AbortError，且不会 flush 半截 UTF-8。
            socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/event-stream\r\n\r\n');
            socket.write(frame(Buffer.from([0xe4, 0xbd])));
        });

        try {
            const stream = proxyStreamFetch('http://example.test/abort', {
                method: 'GET',
                headers: {},
                timeout: 1000,
                signal: controller.signal
            }, proxyUrl);

            const pending = stream.next();
            setTimeout(() => controller.abort(), 20);
            await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        } finally {
            await closeServer(server);
        }
    });

    it('does not flush the no-proxy TextDecoder after abort', async () => {
        const originalFetch = global.fetch;
        const controller = new AbortController();
        let readCount = 0;

        // 修改原因：no-proxy 分支曾在 abort break 后继续 decoder.decode() final flush，可能把中断造成的半截 UTF-8 当成功输出。
        // 修改方式：mock fetch reader 先返回半个中文字符，再 abort，并断言下一次读取抛 AbortError。
        // 修改目的：锁定 no-proxy abort 不 flush、不 yield 半截 tail 的行为。
        global.fetch = jest.fn(async () => ({
            ok: true,
            body: {
                getReader: () => ({
                    read: jest.fn(async () => {
                        readCount += 1;
                        if (readCount === 1) {
                            return { done: false, value: new Uint8Array([0xe4, 0xbd]) };
                        }
                        return { done: true, value: undefined };
                    }),
                    cancel: jest.fn(async () => undefined),
                    releaseLock: jest.fn()
                })
            }
        })) as any;

        try {
            const stream = proxyStreamFetch('http://example.test/no-proxy-abort', {
                method: 'GET',
                headers: {},
                timeout: 1000,
                signal: controller.signal
            });

            const first = await stream.next();
            expect(first.done).toBe(false);
            expect(first.value).toBe('');
            controller.abort();
            await expect(stream.next()).rejects.toMatchObject({ name: 'AbortError' });
        } finally {
            global.fetch = originalFetch;
        }
    });



    it('rejects premature non-chunked Content-Length close without final flushing a split UTF-8 tail', async () => {
        const { server, proxyUrl } = await startFakeConnectProxy((socket) => {
            // 修改原因：Content-Length 声明的 body 未收满时不是正常完成，不能 decoder.end() 把 E4 BD 刷成 U+FFFD。
            // 修改方式：声明 3 字节 body，只发送 “你” 的前 2 字节后关闭连接。
            // 修改目的：锁定 premature close 必须走截断错误路径，而不是 success dataQueue。
            socket.write('HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n');
            socket.write(Buffer.from([0xe4, 0xbd]));
            socket.end();
        });

        try {
            const stream = proxyStreamFetch('http://example.test/truncated-success', {
                method: 'GET',
                headers: {},
                timeout: 1000
            }, proxyUrl);

            await expect(stream.next()).rejects.toThrow('Incomplete response body');
        } finally {
            await closeServer(server);
        }
    });

    it('rejects premature non-chunked error bodies instead of corrupting ChannelError details', async () => {
        const { server, proxyUrl } = await startFakeConnectProxy((socket) => {
            // 修改原因：error body 同样不能在 Content-Length 未收满时 final flush，否则错误详情里也会本地制造 U+FFFD。
            // 修改方式：返回 400 + Content-Length: 3，只发送 2 字节后关闭。
            // 修改目的：证明截断 error body 是 transport error，不是带损坏 details 的 ChannelError。
            socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 3\r\n\r\n');
            socket.write(Buffer.from([0xe4, 0xbd]));
            socket.end();
        });

        try {
            const stream = proxyStreamFetch('http://example.test/truncated-error', {
                method: 'GET',
                headers: {},
                timeout: 1000
            }, proxyUrl);

            await expect(stream.next()).rejects.toThrow('Incomplete response body');
        } finally {
            await closeServer(server);
        }
    });

    it('rejects chunked header-only premature close before the zero-size terminator', async () => {
        const { server, proxyUrl } = await startFakeConnectProxy((socket) => {
            // 修改原因：Transfer-Encoding: chunked 的正常完成必须看到 0-size chunk；headers 后 close 不能算完整 body。
            // 修改方式：只发送 chunked 响应头就关闭连接。
            // 修改目的：防止 bodyReader 尚未创建时 completeBody 被误调用。
            socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n');
            socket.end();
        });

        try {
            const stream = proxyStreamFetch('http://example.test/chunked-header-only', {
                method: 'GET',
                headers: {},
                timeout: 1000
            }, proxyUrl);

            await expect(stream.next()).rejects.toThrow('Incomplete chunked response body');
        } finally {
            await closeServer(server);
        }
    });

    it('turns an already-aborted external signal into ChannelManager CANCELLED_ERROR before proxy request starts', async () => {
        // 修改原因：已经 aborted 的 signal 不会再触发 addEventListener，ChannelManager 必须在请求前主动检查。
        // 修改方式：直接调用私有 executeStreamRequest，并传入已 abort 的 signal。
        // 修改目的：覆盖生产 ChannelManager 层，而不仅是 proxyStreamFetch 直接入口。
        const manager = new ChannelManager({} as any, undefined, {
            getEffectiveProxyUrl: () => 'http://127.0.0.1:1'
        } as any);
        const controller = new AbortController();
        controller.abort();

        const stream = (manager as any).executeStreamRequest({
            url: 'http://example.test/stream',
            method: 'GET',
            headers: {},
            timeout: 1000
        }, controller.signal) as AsyncGenerator<any>;

        await expect(stream.next()).rejects.toMatchObject({
            name: 'ChannelError',
            type: ErrorType.CANCELLED_ERROR
        });
    });

    it('turns active external proxy-stream cancellation into ChannelManager CANCELLED_ERROR', async () => {
        const controller = new AbortController();
        const { server, proxyUrl } = await startFakeConnectProxy((socket) => {
            // 修改原因：ChannelManager 曾在 externalSignal.aborted 后 break，导致取消被当成正常 stream 结束。
            // 修改方式：先发送一个完整 SSE 事件，再保持连接打开，测试第二次 next 在 abort 后得到 CANCELLED_ERROR。
            // 修改目的：覆盖生产 executeStreamRequest 的 proxy for-await 分支，防止 final parse tail 继续运行。
            socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/event-stream\r\n\r\n');
            socket.write(frame(Buffer.from('data: {"choices":[{"delta":{"content":"一"}}]}\n\n', 'utf8')));
        });

        try {
            const manager = new ChannelManager({} as any, undefined, {
                getEffectiveProxyUrl: () => proxyUrl
            } as any);
            const stream = (manager as any).executeStreamRequest({
                url: 'http://example.test/stream',
                method: 'GET',
                headers: {},
                timeout: 1000
            }, controller.signal) as AsyncGenerator<any>;

            const first = await stream.next();
            expect(first.done).toBe(false);
            expect(first.value?.choices?.[0]?.delta?.content).toBe('一');

            controller.abort();
            await expect(stream.next()).rejects.toMatchObject({
                name: 'ChannelError',
                type: ErrorType.CANCELLED_ERROR
            });
        } finally {
            await closeServer(server);
        }
    });



    it('stops ChannelManager when external cancellation happens between parsed chunks from one proxy raw chunk', async () => {
        const controller = new AbortController();
        const { server, proxyUrl } = await startFakeConnectProxy((socket) => {
            // 修改原因：parseStreamBuffer 一次可能从同一个 raw proxy chunk 解析出多个 SSE events，取消可能发生在这些 yield 之间。
            // 修改方式：把两个完整 SSE events 放进同一个 HTTP chunk，第一条 yield 后 abort，断言第二条不会继续 yield。
            // 修改目的：覆盖第三轮对抗性复核指出的 ChannelManager tail-yield timing。
            const twoEvents = Buffer.from(
                'data: {"choices":[{"delta":{"content":"一"}}]}\n\n' +
                'data: {"choices":[{"delta":{"content":"二"}}]}\n\n',
                'utf8'
            );
            socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/event-stream\r\n\r\n');
            socket.write(frame(twoEvents));
        });

        try {
            const manager = new ChannelManager({} as any, undefined, {
                getEffectiveProxyUrl: () => proxyUrl
            } as any);
            const stream = (manager as any).executeStreamRequest({
                url: 'http://example.test/two-events',
                method: 'GET',
                headers: {},
                timeout: 1000
            }, controller.signal) as AsyncGenerator<any>;

            const first = await stream.next();
            expect(first.done).toBe(false);
            expect(first.value?.choices?.[0]?.delta?.content).toBe('一');

            controller.abort();
            await expect(stream.next()).rejects.toMatchObject({
                name: 'ChannelError',
                type: ErrorType.CANCELLED_ERROR
            });
        } finally {
            await closeServer(server);
        }
    });
});
