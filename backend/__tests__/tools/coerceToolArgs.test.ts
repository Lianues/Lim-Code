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
    // ==================== 基础守卫 ====================

    it('在没有 schema 时保持原值', () => {
        const args = { files: '[{"path":"a.txt"}]' };

        expect(coerceToolArgs(args, undefined as any)).toBe(args);
    });

    // ==================== array 容错 ====================

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

    it('只解析数组本身，不递归修正数组内部字段类型', () => {
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

        // 数组内部的 "10"、"20" 不会被转为数字（不做递归）
        expect(result.files).toEqual([
            {
                path: 'a.txt',
                startLine: '10',
                endLine: '20'
            }
        ]);
    });

    it('不递归解析双层字符串数组', () => {
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

        // 双层字符串解析出来是 string 而非 array，不替换
        expect(result).toBe(args);
        expect(result.files).toBe(double);
    });

    it('不自动纠正 object 类型字符串', () => {
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

    // ==================== boolean 容错 ====================

    it('将 "true" 字符串转为 true', () => {
        const args = { recursive: 'true' };
        const s = schema({ recursive: { type: 'boolean' } });

        const result = coerceToolArgs(args, s);

        expect(result.recursive).toBe(true);
        expect(typeof result.recursive).toBe('boolean');
    });

    it('将 "false" 字符串转为 false', () => {
        const args = { recursive: 'false' };
        const s = schema({ recursive: { type: 'boolean' } });

        const result = coerceToolArgs(args, s);

        expect(result.recursive).toBe(false);
        expect(typeof result.recursive).toBe('boolean');
    });

    it('对已经是 boolean 的值不做处理', () => {
        const args = { recursive: true };
        const s = schema({ recursive: { type: 'boolean' } });

        // 未修改时返回原始对象引用
        expect(coerceToolArgs(args, s)).toBe(args);
    });

    it('不转换非 "true"/"false" 的 boolean 字符串（如 "yes"、"1"）', () => {
        const args = { recursive: 'yes' };
        const s = schema({ recursive: { type: 'boolean' } });

        // "yes" 不是精确匹配，保持原值不动
        const result = coerceToolArgs(args, s);
        expect(result.recursive).toBe('yes');
    });

    // ==================== number 容错 ====================

    it('将 "60000" 字符串转为 60000', () => {
        const args = { timeout: '60000' };
        const s = schema({ timeout: { type: 'number' } });

        const result = coerceToolArgs(args, s);

        expect(result.timeout).toBe(60000);
        expect(typeof result.timeout).toBe('number');
    });

    it('将 "-5" 字符串转为 -5', () => {
        const args = { offset: '-5' };
        const s = schema({ offset: { type: 'number' } });

        const result = coerceToolArgs(args, s);

        expect(result.offset).toBe(-5);
    });

    it('将 "3.14" 字符串转为 3.14', () => {
        const args = { ratio: '3.14' };
        const s = schema({ ratio: { type: 'number' } });

        const result = coerceToolArgs(args, s);

        expect(result.ratio).toBe(3.14);
    });

    it('对 integer 类型同样生效', () => {
        const args = { count: '42' };
        const s = schema({ count: { type: 'integer' } });

        const result = coerceToolArgs(args, s);

        expect(result.count).toBe(42);
    });

    it('对已经是 number 的值不做处理', () => {
        const args = { timeout: 60000 };
        const s = schema({ timeout: { type: 'number' } });

        expect(coerceToolArgs(args, s)).toBe(args);
    });

    it('不转换非法数字字符串（如 "abc"、"12px"）', () => {
        const args = { timeout: '12px' };
        const s = schema({ timeout: { type: 'number' } });

        const result = coerceToolArgs(args, s);
        expect(result.timeout).toBe('12px');
    });

    it('不转换空字符串', () => {
        const args = { timeout: '' };
        const s = schema({ timeout: { type: 'number' } });

        const result = coerceToolArgs(args, s);
        expect(result.timeout).toBe('');
    });

    // ==================== 混合场景 ====================

    it('同时处理多个不同类型的参数', () => {
        const args = {
            recursive: 'true',
            timeout: '60000',
            files: '[{"path":"a.txt"}]',
            query: 'hello'  // string 类型，不应被转换
        };
        const s = schema({
            recursive: { type: 'boolean' },
            timeout: { type: 'number' },
            files: {
                type: 'array',
                items: { type: 'object', properties: { path: { type: 'string' } } }
            },
            query: { type: 'string' }
        });

        const result = coerceToolArgs(args, s);

        expect(result.recursive).toBe(true);
        expect(result.timeout).toBe(60000);
        expect(result.files).toEqual([{ path: 'a.txt' }]);
        expect(result.query).toBe('hello');
    });

    it('所有值都已是正确类型时返回原始对象引用', () => {
        const args = {
            recursive: true,
            timeout: 60000,
            query: 'hello'
        };
        const s = schema({
            recursive: { type: 'boolean' },
            timeout: { type: 'number' },
            query: { type: 'string' }
        });

        // 没有任何修改，返回同一个引用
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
    // 为什么测试使用 insert_code：write_file/read_file 已迁移为单目标参数，继续拿 write_file 举例会误导后续维护者以为它仍有 files 数组。
    // 怎么改：改用仍然合法使用 files 数组的 insert_code，同时保持对通用数组校验函数的覆盖范围不变。
    // 目的：让测试语义和当前工具协议一致，避免回归测试本身成为旧协议残留。
    const arrayToolName = 'insert_code';

    it('数组参数有效时不返回错误', () => {
        const args = { files: [{ path: 'a.txt' }] };

        expect(getToolArgsArrayValidationError(arrayToolName, args, s)).toBeNull();
    });

    it('字符串未能转成纯数组时返回明确错误', () => {
        const args = { files: '{"path":"a.txt"}' };

        expect(getToolArgsArrayValidationError(arrayToolName, args, s)).toBe(
            'Tool "insert_code" expects parameter "files" to be an array. The model returned a string, but it could not be parsed into a JSON array.'
        );
    });

    it('非字符串且非数组时返回通用错误', () => {
        const args = { files: { path: 'a.txt' } };

        expect(getToolArgsArrayValidationError(arrayToolName, args, s)).toBe(
            'Tool "insert_code" expects parameter "files" to be an array.'
        );
    });
});
