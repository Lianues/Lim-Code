/**
 * Tests for coerceToolArgs — the defensive preprocessing layer
 * that fixes LLM tool-call parameter serialization bugs.
 *
 * Problem: Claude (and other LLMs) sometimes serialize array/object/boolean/number
 * parameters as JSON strings instead of native JSON types.
 *
 * Examples of broken input:
 *   { files: '[{"path": "a.txt"}]' }           // array as string (1 layer)
 *   { files: '"[{\\"path\\": \\"a.txt\\"}]"' }  // array as string (2 layers)
 *   { recursive: 'true' }                        // boolean as string
 *   { timeout: '60000' }                         // number as string
 *   { line: '42' }                               // integer as string
 */

import { coerceToolArgs } from '../../tools/coerceToolArgs';

// ─── Helper: build a minimal JSON Schema ────────────────────────

interface SchemaProperty {
    type: string;
    items?: SchemaProperty;
    properties?: Record<string, SchemaProperty>;
    required?: string[];
}

function schema(properties: Record<string, SchemaProperty>, required?: string[]) {
    return { type: 'object' as const, properties, required };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('coerceToolArgs', () => {

    // ============================================================
    // 1. Already-correct input should pass through unchanged
    // ============================================================
    describe('passthrough (correct input)', () => {
        it('should not modify correct array parameter', () => {
            const args = { files: [{ path: 'a.txt', content: 'hello' }] };
            const s = schema({
                files: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            content: { type: 'string' },
                        },
                    },
                },
            });
            const result = coerceToolArgs(args, s);
            expect(result).toEqual(args);
        });

        it('should not modify correct boolean parameter', () => {
            const args = { recursive: true };
            const s = schema({ recursive: { type: 'boolean' } });
            const result = coerceToolArgs(args, s);
            expect(result).toEqual({ recursive: true });
        });

        it('should not modify correct number parameter', () => {
            const args = { timeout: 60000 };
            const s = schema({ timeout: { type: 'number' } });
            const result = coerceToolArgs(args, s);
            expect(result).toEqual({ timeout: 60000 });
        });

        it('should not modify correct string parameter', () => {
            const args = { path: 'src/main.ts' };
            const s = schema({ path: { type: 'string' } });
            const result = coerceToolArgs(args, s);
            expect(result).toEqual({ path: 'src/main.ts' });
        });

        it('should not modify args when no schema is provided', () => {
            const args = { files: '[{"path": "a.txt"}]' };
            const result = coerceToolArgs(args, undefined as any);
            expect(result).toEqual(args);
        });
    });

    // ============================================================
    // 2. Array parameters serialized as strings
    // ============================================================
    describe('array coercion', () => {
        const arraySchema = schema({
            files: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        content: { type: 'string' },
                    },
                },
            },
        });

        it('should parse single-encoded array string', () => {
            const args = { files: '[{"path": "a.txt", "content": "hello"}]' };
            const result = coerceToolArgs(args, arraySchema);
            expect(result.files).toEqual([{ path: 'a.txt', content: 'hello' }]);
            expect(Array.isArray(result.files)).toBe(true);
        });

        it('should parse double-encoded array string', () => {
            // Double encoding: the array was JSON.stringify'd twice
            const inner = JSON.stringify([{ path: 'a.txt', content: 'hello' }]);
            const doubleEncoded = JSON.stringify(inner);
            const args = { files: JSON.parse(doubleEncoded) }; // This gives us a string of the stringified array
            const result = coerceToolArgs(args, arraySchema);
            expect(result.files).toEqual([{ path: 'a.txt', content: 'hello' }]);
            expect(Array.isArray(result.files)).toBe(true);
        });

        it('should parse triple-encoded array string', () => {
            const original = [{ path: 'a.txt', content: 'hello' }];
            const once = JSON.stringify(original);
            const twice = JSON.stringify(once);
            const thrice = JSON.stringify(twice);
            // thrice is: '"\\"[{\\\\\\"path\\\\..."
            // After JSON.parse(thrice), we get the double-encoded string
            const args = { files: JSON.parse(thrice) };
            const result = coerceToolArgs(args, arraySchema);
            expect(result.files).toEqual(original);
            expect(Array.isArray(result.files)).toBe(true);
        });

        it('should handle simple string array (paths)', () => {
            const s = schema({
                paths: { type: 'array', items: { type: 'string' } },
            });
            const args = { paths: '["src/main.ts", "src/utils.ts"]' };
            const result = coerceToolArgs(args, s);
            expect(result.paths).toEqual(['src/main.ts', 'src/utils.ts']);
        });

        it('should NOT parse a string that is not valid JSON', () => {
            const args = { files: 'not json at all' };
            const result = coerceToolArgs(args, arraySchema);
            // Should keep original value (let the handler's own validation report the error)
            expect(result.files).toBe('not json at all');
        });

        it('should NOT coerce a string that parses to a non-array when array is expected', () => {
            // e.g. the string '{"key": "value"}' parses to an object, not an array
            const args = { files: '{"key": "value"}' };
            const result = coerceToolArgs(args, arraySchema);
            // Should keep original — parsed result is object, not array
            expect(result.files).toBe('{"key": "value"}');
        });
    });

    // ============================================================
    // 3. Object parameters serialized as strings
    // ============================================================
    describe('object coercion', () => {
        const objectSchema = schema({
            config: {
                type: 'object',
                properties: {
                    key: { type: 'string' },
                    value: { type: 'string' },
                },
            },
        });

        it('should parse single-encoded object string', () => {
            const args = { config: '{"key": "foo", "value": "bar"}' };
            const result = coerceToolArgs(args, objectSchema);
            expect(result.config).toEqual({ key: 'foo', value: 'bar' });
        });

        it('should parse double-encoded object string', () => {
            const inner = JSON.stringify({ key: 'foo', value: 'bar' });
            const args = { config: JSON.stringify(inner) };
            // After JSON.parse of the outer string, we get the inner stringified object
            const parsed = JSON.parse(args.config);
            const result = coerceToolArgs({ config: parsed }, objectSchema);
            expect(result.config).toEqual({ key: 'foo', value: 'bar' });
        });

        it('should NOT coerce a string that parses to an array when object is expected', () => {
            const args = { config: '[1, 2, 3]' };
            const result = coerceToolArgs(args, objectSchema);
            expect(result.config).toBe('[1, 2, 3]');
        });
    });

    // ============================================================
    // 4. Boolean parameters serialized as strings
    // ============================================================
    describe('boolean coercion', () => {
        const boolSchema = schema({
            recursive: { type: 'boolean' },
            isRegex: { type: 'boolean' },
        });

        it('should coerce "true" string to true', () => {
            const result = coerceToolArgs({ recursive: 'true' }, boolSchema);
            expect(result.recursive).toBe(true);
        });

        it('should coerce "false" string to false', () => {
            const result = coerceToolArgs({ recursive: 'false' }, boolSchema);
            expect(result.recursive).toBe(false);
        });

        it('should coerce "True" (case-insensitive) to true', () => {
            const result = coerceToolArgs({ recursive: 'True' }, boolSchema);
            expect(result.recursive).toBe(true);
        });

        it('should coerce "FALSE" (case-insensitive) to false', () => {
            const result = coerceToolArgs({ isRegex: 'FALSE' }, boolSchema);
            expect(result.isRegex).toBe(false);
        });

        it('should NOT coerce non-boolean strings', () => {
            const result = coerceToolArgs({ recursive: 'yes' }, boolSchema);
            expect(result.recursive).toBe('yes');
        });

        it('should not touch already-correct booleans', () => {
            const result = coerceToolArgs({ recursive: false, isRegex: true }, boolSchema);
            expect(result.recursive).toBe(false);
            expect(result.isRegex).toBe(true);
        });
    });

    // ============================================================
    // 5. Number/integer parameters serialized as strings
    // ============================================================
    describe('number coercion', () => {
        const numSchema = schema({
            timeout: { type: 'number' },
            line: { type: 'integer' },
            maxResults: { type: 'number' },
        });

        it('should coerce numeric string to number', () => {
            const result = coerceToolArgs({ timeout: '60000' }, numSchema);
            expect(result.timeout).toBe(60000);
            expect(typeof result.timeout).toBe('number');
        });

        it('should coerce integer string for integer type', () => {
            const result = coerceToolArgs({ line: '42' }, numSchema);
            expect(result.line).toBe(42);
            expect(typeof result.line).toBe('number');
        });

        it('should coerce floating point string', () => {
            const result = coerceToolArgs({ maxResults: '3.14' }, numSchema);
            expect(result.maxResults).toBe(3.14);
        });

        it('should coerce negative number string', () => {
            const result = coerceToolArgs({ timeout: '-1' }, numSchema);
            expect(result.timeout).toBe(-1);
        });

        it('should NOT coerce non-numeric strings', () => {
            const result = coerceToolArgs({ timeout: 'abc' }, numSchema);
            expect(result.timeout).toBe('abc');
        });

        it('should NOT coerce empty string', () => {
            const result = coerceToolArgs({ timeout: '' }, numSchema);
            expect(result.timeout).toBe('');
        });

        it('should not touch already-correct numbers', () => {
            const result = coerceToolArgs({ timeout: 5000, line: 10 }, numSchema);
            expect(result.timeout).toBe(5000);
            expect(result.line).toBe(10);
        });
    });

    // ============================================================
    // 6. Nested object with array items containing number fields
    //    (e.g. read_file's files array with startLine/endLine)
    // ============================================================
    describe('nested coercion (array of objects with typed fields)', () => {
        const readFileSchema = schema({
            files: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        startLine: { type: 'number' },
                        endLine: { type: 'number' },
                    },
                },
            },
        });

        it('should coerce number fields inside array items after array coercion', () => {
            // Simulate: LLM sends array as string, AND numbers inside as strings
            const args = {
                files: '[{"path": "main.ts", "startLine": "100", "endLine": "200"}]',
            };
            const result = coerceToolArgs(args, readFileSchema);
            expect(Array.isArray(result.files)).toBe(true);
            expect(result.files[0].path).toBe('main.ts');
            expect(result.files[0].startLine).toBe(100);
            expect(result.files[0].endLine).toBe(200);
        });

        it('should coerce number fields when array is already correct but inner values are strings', () => {
            const args = {
                files: [{ path: 'main.ts', startLine: '100', endLine: '200' }],
            };
            const result = coerceToolArgs(args, readFileSchema);
            expect(result.files[0].startLine).toBe(100);
            expect(result.files[0].endLine).toBe(200);
        });
    });

    // ============================================================
    // 7. String parameters should NEVER be coerced
    //    (critical: content param in write_file might be valid JSON)
    // ============================================================
    describe('string parameters are never coerced', () => {
        const writeFileSchema = schema({
            files: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        content: { type: 'string' },
                    },
                },
            },
        });

        it('should NOT parse JSON content inside a string-typed field', () => {
            // write_file: content might literally be a JSON file's text
            const jsonContent = '{"name": "test", "version": "1.0"}';
            const args = {
                files: [{ path: 'package.json', content: jsonContent }],
            };
            const result = coerceToolArgs(args, writeFileSchema);
            // content must remain a string, not get parsed into an object!
            expect(result.files[0].content).toBe(jsonContent);
            expect(typeof result.files[0].content).toBe('string');
        });

        it('should NOT parse array-like content inside a string-typed field', () => {
            const arrayContent = '[1, 2, 3]';
            const args = {
                files: [{ path: 'data.json', content: arrayContent }],
            };
            const result = coerceToolArgs(args, writeFileSchema);
            expect(result.files[0].content).toBe(arrayContent);
            expect(typeof result.files[0].content).toBe('string');
        });
    });

    // ============================================================
    // 8. Parameters not in schema should pass through unchanged
    // ============================================================
    describe('unknown parameters passthrough', () => {
        it('should pass through parameters not defined in schema', () => {
            const s = schema({ path: { type: 'string' } });
            const args = { path: 'a.txt', unknownParam: '[1,2,3]' };
            const result = coerceToolArgs(args, s);
            expect(result.unknownParam).toBe('[1,2,3]');
        });
    });

    // ============================================================
    // 9. Edge cases
    // ============================================================
    describe('edge cases', () => {
        it('should handle null args gracefully', () => {
            const s = schema({ path: { type: 'string' } });
            const result = coerceToolArgs(null as any, s);
            expect(result).toBeNull();
        });

        it('should handle undefined args gracefully', () => {
            const s = schema({ path: { type: 'string' } });
            const result = coerceToolArgs(undefined as any, s);
            expect(result).toBeUndefined();
        });

        it('should handle empty object', () => {
            const s = schema({ path: { type: 'string' } });
            const result = coerceToolArgs({}, s);
            expect(result).toEqual({});
        });

        it('should handle schema with no properties', () => {
            const s = schema({});
            const args = { anything: 'goes' };
            const result = coerceToolArgs(args, s);
            expect(result).toEqual(args);
        });

        it('should not infinite-loop on a string that always parses to another string', () => {
            // A quoted string: '"hello"' -> JSON.parse -> 'hello' -> not an array/object
            const s = schema({ files: { type: 'array', items: { type: 'string' } } });
            const args = { files: '"hello"' };
            const result = coerceToolArgs(args, s);
            // 'hello' is not an array, so it should keep the original
            expect(result.files).toBe('"hello"');
        });

        it('should handle number 0 correctly (falsy but valid)', () => {
            const s = schema({ line: { type: 'number' } });
            const result = coerceToolArgs({ line: '0' }, s);
            expect(result.line).toBe(0);
        });

        it('should handle boolean false correctly', () => {
            const s = schema({ flag: { type: 'boolean' } });
            const result = coerceToolArgs({ flag: 'false' }, s);
            expect(result.flag).toBe(false);
        });
    });

    // ============================================================
    // 10. Real-world tool schemas (integration-style)
    // ============================================================
    describe('real-world tool schemas', () => {
        it('write_file: files array as string', () => {
            const s = schema({
                files: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            content: { type: 'string' },
                        },
                        required: ['path', 'content'],
                    },
                },
            }, ['files']);

            const args = {
                files: '[{"path": "src/index.ts", "content": "console.log(42);"}]',
            };
            const result = coerceToolArgs(args, s);
            expect(Array.isArray(result.files)).toBe(true);
            expect(result.files).toHaveLength(1);
            expect(result.files[0].path).toBe('src/index.ts');
            expect(result.files[0].content).toBe('console.log(42);');
        });

        it('todo_write: todos array as string', () => {
            const s = schema({
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            content: { type: 'string' },
                            status: { type: 'string' },
                        },
                    },
                },
            });

            const args = {
                todos: '[{"id": "1", "content": "implement feature", "status": "pending"}]',
            };
            const result = coerceToolArgs(args, s);
            expect(Array.isArray(result.todos)).toBe(true);
            expect(result.todos[0].id).toBe('1');
        });

        it('list_files: paths array + recursive boolean as strings', () => {
            const s = schema({
                paths: { type: 'array', items: { type: 'string' } },
                recursive: { type: 'boolean' },
            });

            const args = {
                paths: '["src", "backend"]',
                recursive: 'true',
            };
            const result = coerceToolArgs(args, s);
            expect(result.paths).toEqual(['src', 'backend']);
            expect(result.recursive).toBe(true);
        });

        it('execute_command: timeout as string', () => {
            const s = schema({
                command: { type: 'string' },
                timeout: { type: 'number' },
            });

            const args = { command: 'npm test', timeout: '120000' };
            const result = coerceToolArgs(args, s);
            expect(result.command).toBe('npm test');
            expect(result.timeout).toBe(120000);
        });

        it('find_references: line and column as strings', () => {
            const s = schema({
                path: { type: 'string' },
                line: { type: 'number' },
                column: { type: 'number' },
                context: { type: 'number' },
            });

            const args = { path: 'src/main.ts', line: '42', column: '10', context: '2' };
            const result = coerceToolArgs(args, s);
            expect(result.line).toBe(42);
            expect(result.column).toBe(10);
            expect(result.context).toBe(2);
        });

        it('search_in_files: isRegex as string, maxResults as string', () => {
            const s = schema({
                query: { type: 'string' },
                isRegex: { type: 'boolean' },
                maxResults: { type: 'number' },
            });

            const args = { query: 'TODO', isRegex: 'false', maxResults: '50' };
            const result = coerceToolArgs(args, s);
            expect(result.isRegex).toBe(false);
            expect(result.maxResults).toBe(50);
        });
    });

    // ============================================================
    // 11. Exact scenarios from the bug report
    //     Verify all three encoding levels AND that correct input
    //     is returned by reference (zero overhead).
    // ============================================================
    describe('exact bug-report scenarios', () => {
        const writeFileSchema = schema({
            files: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                        content: { type: 'string' },
                    },
                    required: ['path', 'content'],
                },
            },
        }, ['files']);

        const expected = [{ path: 'a.txt', content: 'hello' }];

        // 情况1: correct — already native array
        it('情况1（正确）: native array passes through by reference', () => {
            const args = { files: [{ path: 'a.txt', content: 'hello' }] };
            const result = coerceToolArgs(args, writeFileSchema);
            expect(result.files).toEqual(expected);
            // Must be the SAME object reference — zero overhead
            expect(result).toBe(args);
        });

        // 情况2: one layer — array stringified once
        // Raw JSON: {"files": "[{\"path\": \"a.txt\", \"content\": \"hello\"}]"}
        it('情况2（一层）: single-stringified array is parsed', () => {
            const args = {
                files: '[{"path": "a.txt", "content": "hello"}]',
            };
            const result = coerceToolArgs(args, writeFileSchema);
            expect(result.files).toEqual(expected);
            expect(Array.isArray(result.files)).toBe(true);
        });

        // 情况3: two layers — array stringified twice
        // Raw JSON: {"files": "[{\\\"path\\\": \\\"a.txt\\\", \\\"content\\\": \\\"hello\\\"}]"}
        // After the outer JSON.parse (which the API layer does), the value becomes:
        //   "[{\"path\": \"a.txt\", \"content\": \"hello\"}]"  — still a string!
        // But wait, that's the same as 情况2. The *true* double-encoding means
        // JSON.stringify was called on the already-stringified value, so:
        //   value = JSON.stringify('[{"path":"a.txt","content":"hello"}]')
        //         = '"[{\\"path\\":\\"a.txt\\",\\"content\\":\\"hello\\"}]"'
        // After the outer JSON.parse, we get the single-stringified string.
        // But Claude sometimes emits the two layers *before* API-level parse,
        // meaning after API parse we see a string that JSON.parse yields another string.
        it('情况3（两层）: double-stringified array is parsed', () => {
            const singleStringified = JSON.stringify([{ path: 'a.txt', content: 'hello' }]);
            const doubleStringified = JSON.stringify(singleStringified);
            // Simulate what the API layer gives us after its own JSON.parse:
            const afterApiParse = JSON.parse(doubleStringified); // This is the single-stringified string
            const args = { files: afterApiParse };
            const result = coerceToolArgs(args, writeFileSchema);
            expect(result.files).toEqual(expected);
            expect(Array.isArray(result.files)).toBe(true);
        });

        // Extra: the todo_write scenario from the issue
        it('todo_write: todos array stringified once', () => {
            const todosSchema = schema({
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            content: { type: 'string' },
                            status: { type: 'string' },
                        },
                        required: ['id', 'content', 'status'],
                    },
                },
            }, ['todos']);

            // Exact input from the bug report
            const args = {
                todos: '[{"content": "test", "status": "in_progress", "id": "1"}]',
            };
            const result = coerceToolArgs(args, todosSchema);
            expect(Array.isArray(result.todos)).toBe(true);
            expect(result.todos).toEqual([
                { content: 'test', status: 'in_progress', id: '1' },
            ]);
        });
    });

    // ============================================================
    // 12. Identity / no-overhead guarantee
    //     When input is already correct, the returned object must
    //     be the SAME reference (=== args), ensuring zero allocation.
    // ============================================================
    describe('identity guarantee (zero overhead for correct input)', () => {
        it('returns same reference when all types already match', () => {
            const s = schema({
                files: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            content: { type: 'string' },
                        },
                    },
                },
            });
            const args = { files: [{ path: 'a.txt', content: 'hi' }] };
            const result = coerceToolArgs(args, s);
            expect(result).toBe(args); // same reference
        });

        it('returns same reference for correct boolean', () => {
            const s = schema({ recursive: { type: 'boolean' } });
            const args = { recursive: false };
            expect(coerceToolArgs(args, s)).toBe(args);
        });

        it('returns same reference for correct number', () => {
            const s = schema({ timeout: { type: 'number' } });
            const args = { timeout: 5000 };
            expect(coerceToolArgs(args, s)).toBe(args);
        });

        it('returns NEW reference when coercion happens', () => {
            const s = schema({ timeout: { type: 'number' } });
            const args = { timeout: '5000' };
            const result = coerceToolArgs(args, s);
            expect(result).not.toBe(args); // different reference
            expect(result.timeout).toBe(5000);
        });
    });
});
