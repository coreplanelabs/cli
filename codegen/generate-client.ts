import type { ParsedOperation, ParsedParam, ParsedSpec } from './types';
import { toSafeName, toIdentifier } from './type-utils';

export function generateClient(spec: ParsedSpec): string {
  const lines: string[] = [];
  lines.push('// Auto-generated from OpenAPI spec - DO NOT EDIT');
  lines.push('/* eslint-disable */');
  lines.push('');
  lines.push(`import type { Config } from '../config/schema';`);
  lines.push(`import { requestJson, request } from '../client/http';`);
  lines.push(`import type * as T from './types';`);
  lines.push('');

  lines.push('export class NominalAPI {');
  lines.push('  constructor(private readonly config: Config) {}');
  lines.push('');

  const usedNames = new Set<string>();
  for (const op of spec.operations) {
    const methodName = deduplicate(op.methodName, op.tag, usedNames);
    usedNames.add(methodName);
    lines.push(...generateMethod({ ...op, methodName }));
    lines.push('');
  }

  lines.push('}');
  return lines.join('\n');
}

function deduplicate(methodName: string, tag: string, used: Set<string>): string {
  if (!used.has(methodName)) return methodName;
  const tagPart = toIdentifier(tag);
  const tagged = methodName + 'By' + tagPart;
  if (!used.has(tagged)) return tagged;
  let i = 2;
  while (used.has(`${methodName}_${i}`)) i++;
  return `${methodName}_${i}`;
}

function generateMethod(op: ParsedOperation): string[] {
  const args: string[] = [];

  // Required path params first
  for (const p of op.pathParams) {
    args.push(`${toSafeName(p.name)}: ${p.type}`);
  }

  // Body next (if present) - always required since it's marked so in spec
  if (op.requestBodyType) {
    args.push(`body: ${op.requestBodyType}`);
  }

  // Query last - marked optional as an object if all query params are optional
  const hasQuery = op.queryParams.length > 0;
  if (hasQuery) {
    const entries = op.queryParams.map((p) => {
      const optional = p.required ? '' : '?';
      return `${toSafeName(p.name)}${optional}: ${p.type}`;
    });
    const queryOptional = allOptional(op.queryParams) ? '?' : '';
    args.push(`query${queryOptional}: { ${entries.join('; ')} }`);
  }

  const returnType = op.responseType ?? 'void';

  const lines: string[] = [];
  if (op.summary) {
    lines.push(`  /** ${escapeJsDoc(op.summary)} */`);
  }
  lines.push(`  async ${op.methodName}(${args.join(', ')}): Promise<${returnType}> {`);

  const urlExpr = buildUrlExpression(op);
  const callArgs: string[] = [
    `method: '${op.method}'`,
    `url: ${urlExpr}`,
  ];
  if (hasQuery) {
    callArgs.push(`query: query as Record<string, string | number | boolean | string[] | undefined | null>`);
  }
  if (op.requestBodyType) {
    callArgs.push(`body`);
  }
  if (op.isPublic) {
    callArgs.push(`noAuth: true`);
  }

  if (op.responseType) {
    lines.push(`    return requestJson<${returnType}>(this.config, {`);
    lines.push(`      ${callArgs.join(',\n      ')},`);
    lines.push(`    });`);
  } else {
    lines.push(`    await request(this.config, {`);
    lines.push(`      ${callArgs.join(',\n      ')},`);
    lines.push(`    });`);
  }

  lines.push('  }');
  return lines;
}

function buildUrlExpression(op: ParsedOperation): string {
  if (op.pathParams.length === 0) {
    return JSON.stringify(op.path);
  }
  // Convert /v1/workspaces/{id} -> `/v1/workspaces/${id}`
  const parts = op.path.split(/(\{[^}]+\})/);
  const expr = parts
    .map((part) => {
      const match = part.match(/^\{([^}]+)\}$/);
      if (match) {
        const name = match[1]!;
        return '${encodeURIComponent(String(' + toSafeName(name) + '))}';
      }
      return part;
    })
    .join('');
  return `\`${expr}\``;
}

function allOptional(params: ParsedParam[]): boolean {
  return params.every((p) => !p.required);
}

function escapeJsDoc(s: string): string {
  return s.replace(/\*\//g, '* /');
}
