import type { ParsedSpec } from './types';
import { schemaToTypescript, toIdentifier } from './type-utils';

export function generateTypes(spec: ParsedSpec): string {
  const lines: string[] = [];
  lines.push('// Auto-generated from OpenAPI spec - DO NOT EDIT');
  lines.push('/* eslint-disable */');
  lines.push('');

  const emitted = new Set<string>();
  for (const name of spec.schemaNames) {
    const schema = spec.schemas.get(name);
    if (!schema) continue;
    const identifier = toIdentifier(name);
    if (emitted.has(identifier)) continue;
    emitted.add(identifier);

    const typeBody = schemaToTypescript(schema, spec.schemas);
    lines.push(`export type ${identifier} = ${typeBody};`);
    lines.push('');
  }

  return lines.join('\n');
}
