export type FieldSpec = string | { from: string; to: string };

export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function pickFields<T extends Record<string, unknown>>(
  item: T,
  fields: FieldSpec[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (typeof field === 'string') {
      out[field] = getByPath(item, field);
    } else {
      out[field.to] = getByPath(item, field.from);
    }
  }
  return out;
}

export function projectItems<T extends Record<string, unknown>>(
  items: T[],
  fields: FieldSpec[]
): Array<Record<string, unknown>> {
  return items.map((item) => pickFields(item, fields));
}
