import type { ParsedSpec } from './types';
import { toSafeName } from './type-utils';

export function generateCommandMeta(spec: ParsedSpec): string {
  const lines: string[] = [];
  lines.push('// Auto-generated from OpenAPI spec - DO NOT EDIT');
  lines.push('/* eslint-disable */');
  lines.push('');
  lines.push('export interface OperationMeta {');
  lines.push('  operationId: string;');
  lines.push('  methodName: string;');
  lines.push('  tag: string;');
  lines.push('  summary: string;');
  lines.push('  method: string;');
  lines.push('  path: string;');
  lines.push('  pathParams: string[];');
  lines.push('  queryParams: Array<{ name: string; required: boolean; type: string; enumValues?: string[] }>;');
  lines.push('  hasBody: boolean;');
  lines.push('  isPublic: boolean;');
  lines.push('}');
  lines.push('');
  lines.push('export const OPERATIONS: Record<string, OperationMeta> = {');
  const usedKeys = new Set<string>();
  for (const op of spec.operations) {
    const queryParamsJson = JSON.stringify(
      op.queryParams.map((q) => ({
        name: q.name,
        required: q.required,
        type: q.type,
        ...(q.enum ? { enumValues: q.enum } : {}),
      }))
    );
    let rawKey = op.operationId;
    let i = 2;
    while (usedKeys.has(rawKey)) {
      rawKey = `${op.operationId}__${i++}`;
    }
    usedKeys.add(rawKey);
    lines.push(`  ${toSafeName(rawKey)}: {`);
    lines.push(`    operationId: ${JSON.stringify(op.operationId)},`);
    lines.push(`    methodName: ${JSON.stringify(op.methodName)},`);
    lines.push(`    tag: ${JSON.stringify(op.tag)},`);
    lines.push(`    summary: ${JSON.stringify(op.summary)},`);
    lines.push(`    method: ${JSON.stringify(op.method)},`);
    lines.push(`    path: ${JSON.stringify(op.path)},`);
    lines.push(`    pathParams: ${JSON.stringify(op.pathParams.map((p) => p.name))},`);
    lines.push(`    queryParams: ${queryParamsJson},`);
    lines.push(`    hasBody: ${op.requestBodyType !== null},`);
    lines.push(`    isPublic: ${op.isPublic},`);
    lines.push(`  },`);
  }
  lines.push('};');
  return lines.join('\n');
}
