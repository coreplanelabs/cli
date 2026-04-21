import type { SchemaObject } from './types';

const JS_RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'yield', 'let', 'static', 'implements', 'interface', 'package', 'private', 'protected',
  'public', 'await',
]);

export function toIdentifier(name: string): string {
  // Convert "Api Key" -> "ApiKey", "cloud_account_repo" -> "CloudAccountRepo"
  return name
    .split(/[\s\-_]+/)
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
    .replace(/[^a-zA-Z0-9]/g, '');
}

export function toSafeName(name: string): string {
  if (JS_RESERVED.has(name)) return name + '_';
  if (/^[0-9]/.test(name)) return '_' + name;
  if (/[^a-zA-Z0-9_$]/.test(name)) {
    return JSON.stringify(name);
  }
  return name;
}

export interface TypeGenOptions {
  /** Prefix to apply to $ref identifiers (e.g., "T." to produce "T.Workspace") */
  refPrefix?: string;
}

export function schemaToTypescript(
  schema: SchemaObject,
  schemas: Map<string, SchemaObject>,
  opts: TypeGenOptions = {}
): string {
  if (schema.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    return (opts.refPrefix ?? '') + toIdentifier(name);
  }

  if (schema.enum) {
    const values = schema.enum
      .map((v) => {
        if (v === null) return 'null';
        if (typeof v === 'string') return JSON.stringify(v);
        return String(v);
      })
      .join(' | ');
    return schema.nullable ? `(${values}) | null` : values;
  }

  if (schema.allOf) {
    const parts = schema.allOf.map((s) => schemaToTypescript(s, schemas, opts));
    const combined = parts.length === 1 ? parts[0]! : `(${parts.join(' & ')})`;
    return schema.nullable ? `${combined} | null` : combined;
  }

  if (schema.oneOf) {
    const parts = schema.oneOf.map((s) => schemaToTypescript(s, schemas, opts));
    const combined = parts.length === 1 ? parts[0]! : `(${parts.join(' | ')})`;
    return schema.nullable ? `${combined} | null` : combined;
  }

  if (schema.anyOf) {
    const parts = schema.anyOf.map((s) => schemaToTypescript(s, schemas, opts));
    const combined = parts.length === 1 ? parts[0]! : `(${parts.join(' | ')})`;
    return schema.nullable ? `${combined} | null` : combined;
  }

  const nullableSuffix = schema.nullable ? ' | null' : '';

  switch (schema.type) {
    case 'string':
      return 'string' + nullableSuffix;
    case 'number':
    case 'integer':
      return 'number' + nullableSuffix;
    case 'boolean':
      return 'boolean' + nullableSuffix;
    case 'null':
      return 'null';
    case 'array': {
      if (!schema.items) return 'unknown[]' + nullableSuffix;
      const itemType = schemaToTypescript(schema.items, schemas, opts);
      return `Array<${itemType}>` + nullableSuffix;
    }
    case 'object':
      return objectSchemaToTypescript(schema, schemas, opts) + nullableSuffix;
    default:
      if (schema.properties) {
        return objectSchemaToTypescript(schema, schemas, opts) + nullableSuffix;
      }
      return 'unknown' + nullableSuffix;
  }
}

function objectSchemaToTypescript(
  schema: SchemaObject,
  schemas: Map<string, SchemaObject>,
  opts: TypeGenOptions
): string {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const entries: string[] = [];

  for (const [key, propSchema] of Object.entries(props)) {
    const optional = required.has(key) ? '' : '?';
    const type = schemaToTypescript(propSchema, schemas, opts);
    entries.push(`${toSafeName(key)}${optional}: ${type}`);
  }

  if (schema.additionalProperties === true) {
    entries.push(`[key: string]: unknown`);
  } else if (
    typeof schema.additionalProperties === 'object' &&
    schema.additionalProperties !== null
  ) {
    const type = schemaToTypescript(schema.additionalProperties, schemas, opts);
    entries.push(`[key: string]: ${type}`);
  }

  if (entries.length === 0) return 'Record<string, unknown>';
  return `{ ${entries.join('; ')} }`;
}
