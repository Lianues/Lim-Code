/**
 * coerceToolArgs — Defensive preprocessing for LLM tool-call parameters.
 *
 * LLMs (especially Claude) sometimes serialize array/object/boolean/number
 * parameters as JSON strings. This module detects and fixes such mis-serialization
 * based on the tool's JSON Schema declaration.
 *
 * Key design decisions:
 * - Schema-guided: only coerces fields whose declared type mismatches the received type.
 * - Recursive unwrap: handles single, double, or N-level encoding automatically.
 * - String fields are NEVER coerced (critical for write_file content, patch text, etc.).
 * - Unknown/unschema'd fields pass through unchanged.
 * - Null/undefined args pass through unchanged.
 */

export interface ToolParameterSchema {
    type: 'object';
    properties: Record<string, PropertySchema>;
    required?: string[];
}

export interface PropertySchema {
    type: string;           // 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
    items?: PropertySchema; // for array items
    properties?: Record<string, PropertySchema>; // for nested objects
    required?: string[];
    [key: string]: any;
}

/**
 * Coerce tool arguments based on the tool's JSON Schema.
 *
 * @param args  - The raw arguments from the LLM tool call
 * @param schema - The tool's parameter JSON Schema declaration
 * @returns Coerced arguments (new object if modified, original if not)
 */
export function coerceToolArgs(
    args: Record<string, any>,
    schema: ToolParameterSchema | undefined
): Record<string, any> {
    // Guard: null/undefined/non-object args or missing schema -> passthrough
    if (args == null || typeof args !== 'object' || !schema?.properties) {
        return args;
    }

    const result: Record<string, any> = { ...args };
    let modified = false;

    for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in result)) continue;

        const raw = result[key];
        const coerced = coerceValue(raw, propSchema);

        if (coerced !== raw) {
            result[key] = coerced;
            modified = true;
        }
    }

    return modified ? result : args;
}

/**
 * Coerce a single value according to its property schema.
 */
function coerceValue(value: any, schema: PropertySchema): any {
    if (value == null) return value;

    const targetType = schema.type;

    switch (targetType) {
        case 'string':
            // NEVER coerce string fields — they might contain valid JSON as content
            return value;

        case 'array':
            return coerceArray(value, schema);

        case 'object':
            return coerceObject(value, schema);

        case 'boolean':
            return coerceBoolean(value);

        case 'number':
        case 'integer':
            return coerceNumber(value);

        default:
            return value;
    }
}

/**
 * Coerce a value that should be an array.
 * Handles recursive unwrapping of stringified JSON.
 */
function coerceArray(value: any, schema: PropertySchema): any {
    // Already an array -> coerce items recursively
    if (Array.isArray(value)) {
        return coerceArrayItems(value, schema);
    }

    // String -> try to parse, then recursively unwrap
    if (typeof value === 'string') {
        const parsed = tryParseJson(value);
        if (parsed === undefined) return value; // Not valid JSON, keep original

        // Recursively try: the parsed result might still be a string (double-encoded)
        if (typeof parsed === 'string') {
            const deeper = coerceArray(parsed, schema);
            // If we got an array out of the deeper call, use it
            if (Array.isArray(deeper)) return deeper;
            // Otherwise, the recursive parse didn't help, keep original string
            return value;
        }

        if (Array.isArray(parsed)) {
            return coerceArrayItems(parsed, schema);
        }

        // Parsed to something that's not an array (e.g. object) — keep original
        return value;
    }

    return value;
}

/**
 * Coerce items inside an already-resolved array.
 */
function coerceArrayItems(arr: any[], schema: PropertySchema): any[] {
    if (!schema.items) return arr;

    let modified = false;
    const result: any[] = [];

    for (const item of arr) {
        const coerced = coerceValue(item, schema.items);
        result.push(coerced);
        if (coerced !== item) modified = true;
    }

    return modified ? result : arr;
}

/**
 * Coerce a value that should be an object.
 * Handles recursive unwrapping of stringified JSON.
 */
function coerceObject(value: any, schema: PropertySchema): any {
    // Already an object (non-array, non-null)
    if (typeof value === 'object' && !Array.isArray(value)) {
        return coerceObjectProperties(value, schema);
    }

    // String -> try to parse
    if (typeof value === 'string') {
        const parsed = tryParseJson(value);
        if (parsed === undefined) return value;

        // Recursively try (double-encoded)
        if (typeof parsed === 'string') {
            const deeper = coerceObject(parsed, schema);
            if (typeof deeper === 'object' && deeper !== null && !Array.isArray(deeper)) return deeper;
            return value;
        }

        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return coerceObjectProperties(parsed, schema);
        }

        // Parsed to array or other -> keep original
        return value;
    }

    return value;
}

/**
 * Coerce properties inside an already-resolved object.
 */
function coerceObjectProperties(obj: Record<string, any>, schema: PropertySchema): Record<string, any> {
    if (!schema.properties) return obj;

    let modified = false;
    const result: Record<string, any> = { ...obj };

    for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in result)) continue;

        const raw = result[key];
        const coerced = coerceValue(raw, propSchema);
        if (coerced !== raw) {
            result[key] = coerced;
            modified = true;
        }
    }

    return modified ? result : obj;
}

/**
 * Coerce a value that should be a boolean.
 */
function coerceBoolean(value: any): any {
    if (typeof value === 'boolean') return value;

    if (typeof value === 'string') {
        const lower = value.toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
    }

    return value;
}

/**
 * Coerce a value that should be a number/integer.
 */
function coerceNumber(value: any): any {
    if (typeof value === 'number') return value;

    if (typeof value === 'string' && value.trim() !== '') {
        const num = Number(value);
        if (!isNaN(num) && isFinite(num)) {
            return num;
        }
    }

    return value;
}

/**
 * Try to JSON.parse a string. Returns undefined if it fails.
 *
 * Handles a common LLM double-serialization issue: when the model wraps an
 * array/object value as a JSON string, and that string contains literal
 * control characters (e.g. newlines from the outer JSON.parse), the inner
 * JSON.parse fails because JSON spec forbids unescaped control characters
 * inside string values.
 *
 * Fallback: if the first parse fails, re-escape control characters
 * (\x00–\x1f) and try parsing again.
 */
function tryParseJson(str: string): any {
    try {
        return JSON.parse(str);
    } catch {
        // Fallback: sanitize unescaped control characters that break JSON.parse.
        // This happens when the LLM double-serializes a value whose string fields
        // contain newlines/tabs — the outer JSON.parse turns \\n into real \n,
        // making the inner JSON unparseable.
        const sanitized = str.replace(/[\x00-\x1f]/g, (ch) => {
            switch (ch) {
                case '\n': return '\\n';
                case '\r': return '\\r';
                case '\t': return '\\t';
                case '\b': return '\\b';
                case '\f': return '\\f';
                default:
                    // Other control chars: encode as \uXXXX
                    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
            }
        });
        // Only retry if sanitization actually changed something
        if (sanitized !== str) {
            try {
                return JSON.parse(sanitized);
            } catch {
                return undefined;
            }
        }
        return undefined;
    }
}
