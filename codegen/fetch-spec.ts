import type { OpenAPISpec } from './types';

export async function fetchSpec(source: string): Promise<OpenAPISpec> {
  const res = await fetch(source, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'nominal-cli-codegen',
    },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch OpenAPI spec from ${source}: ${res.status} ${res.statusText}`
    );
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    const preview = (await res.text()).slice(0, 200);
    throw new Error(`Expected JSON from ${source}, got ${contentType}: ${preview}`);
  }
  const spec = (await res.json()) as OpenAPISpec;
  if (!spec.openapi || !spec.paths) {
    throw new Error(`Invalid OpenAPI spec from ${source}`);
  }
  return spec;
}

export function resolveSpecSource(): string {
  const domain = process.env.NOMINAL_API_DOMAIN || 'api.nominal.dev';
  return `https://${domain}/v1/doc`;
}
