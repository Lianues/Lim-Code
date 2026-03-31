import {
    coerceToolArgs,
    getToolArgsArrayValidationError
} from '../../tools/coerceToolArgs';

interface SchemaProperty {
    type: string;
    items?: SchemaProperty;
    properties?: Record<string, SchemaProperty>;
    required?: string[];
}

function schema(properties: Record<string, SchemaProperty>, required?: string[]) {
    return { type: 'object' as const, properties, required };
}

describe('coerceToolArgs', () => {
    it('在没有 schema 时保持原值', () => {
        const args = { files: '[{"path":"a.txt"}]' };

        expect(coerceToolArgs(args, undefined as any)).toBe(args);
    });

    it('对已经是数组的参数不做处理', () => {
        const args = { files: [{ path: 'a.txt', content: 'hello' }] };
        const s = schema({
            files: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        content: { type: 'string' }
                    }
                }
            }
        });

        expect(coerceToolArgs(args, s)).toBe(args);
    });

    it('仅在顶层 array 参数收到字符串时尝试解析为数组', () => {
        const args = { files: '[{"path":"a.txt","content":"hello"}]' };
        const s = schema({
            files: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        content: { type: 'string' }
                    }
                }
            }
        });

        const result = coerceToolArgs(args, s);

        expect(result).toEqual({
            files: [{ path: 'a.txt', content: 'hello' }]
        });
        expect(Array.isArray(result.files)).toBe(true);
    });

    it('只解析数组本身，不再递归修正数组内部字段类型', () => {
        const args = {
            files: '[{"path":"a.txt","startLine":"10","endLine":"20"}]'
        };
        const s = schema({
            files: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        startLine: { type: 'number' },
                        endLine: { type: 'number' }
                    }
                }
            }
        });

        const result = coerceToolArgs(args, s);

        expect(result.files).toEqual([
            {
                path: 'a.txt',
                startLine: '10',
                endLine: '20'
            }
        ]);
    });

    it('不再递归解析双层字符串数组', () => {
        const single = JSON.stringify([{ path: 'a.txt', content: 'hello' }]);
        const double = JSON.stringify(single);
        const args = { files: double };
        const s = schema({
            files: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        content: { type: 'string' }
                    }
                }
            }
        });

        const result = coerceToolArgs(args, s);

        expect(result).toBe(args);
        expect(result.files).toBe(double);
    });

    it('不再自动纠正 object 类型字符串', () => {
        const args = { config: '{"key":"foo","value":"bar"}' };
        const s = schema({
            config: {
                type: 'object',
                properties: {
                    key: { type: 'string' },
                    value: { type: 'string' }
                }
            }
        });

        expect(coerceToolArgs(args, s)).toBe(args);
    });

    it('不再自动纠正 boolean 类型字符串', () => {
        const args = { recursive: 'true' };
        const s = schema({ recursive: { type: 'boolean' } });

        expect(coerceToolArgs(args, s)).toBe(args);
    });

    it('不再自动纠正 number 类型字符串', () => {
        const args = { timeout: '60000' };
        const s = schema({ timeout: { type: 'number' } });

        expect(coerceToolArgs(args, s)).toBe(args);
    });
});

describe('getToolArgsArrayValidationError', () => {
    const s = schema({
        files: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    path: { type: 'string' }
                }
            }
        }
    });

    it('数组参数有效时不返回错误', () => {
        const args = { files: [{ path: 'a.txt' }] };

        expect(getToolArgsArrayValidationError('write_file', args, s)).toBeNull();
    });

    it('字符串未能转成纯数组时返回明确错误', () => {
        const args = { files: '{"path":"a.txt"}' };

        expect(getToolArgsArrayValidationError('write_file', args, s)).toBe(
            'Tool "write_file" expects parameter "files" to be an array. The model returned a string, but it could not be parsed into a JSON array.'
        );
    });

    it('非字符串且非数组时返回通用错误', () => {
        const args = { files: { path: 'a.txt' } };

        expect(getToolArgsArrayValidationError('write_file', args, s)).toBe(
            'Tool "write_file" expects parameter "files" to be an array.'
        );
    });
});
