import type {
  OpenAPISpec,
  Operation,
  ParsedOperation,
  ParsedParam,
  ParsedSpec,
  SchemaObject,
} from './types';
import { schemaToTypescript, toIdentifier, toSafeName, type TypeGenOptions } from './type-utils';

const CLIENT_OPTS: TypeGenOptions = { refPrefix: 'T.' };

export function parseSpec(spec: OpenAPISpec): ParsedSpec {
  const schemas = new Map<string, SchemaObject>();
  if (spec.components?.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      schemas.set(name, schema);
    }
  }

  const operations: ParsedOperation[] = [];
  const methods: Array<keyof typeof HTTP_METHOD_MAP> = ['get', 'post', 'put', 'patch', 'delete'];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;
    for (const method of methods) {
      const op = pathItem[method];
      if (!op) continue;
      const parsed = parseOperation(path, method, op, schemas);
      if (parsed) operations.push(parsed);
    }
  }

  return {
    operations,
    schemaNames: [...schemas.keys()],
    schemas,
    info: spec.info,
  };
}

const HTTP_METHOD_MAP = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
} as const;

function parseOperation(
  path: string,
  method: keyof typeof HTTP_METHOD_MAP,
  op: Operation,
  schemas: Map<string, SchemaObject>
): ParsedOperation | null {
  if (!op.operationId) return null;

  const operationId = op.operationId;
  const methodName = operationIdToMethodName(operationId);
  const tag = op.tags?.[0] ?? 'default';
  const summary = op.summary ?? '';
  const isPublic = Array.isArray(op.security) && op.security.length === 0;

  const pathParams: ParsedParam[] = [];
  const queryParams: ParsedParam[] = [];

  for (const param of op.parameters ?? []) {
    const typed: ParsedParam = {
      name: param.name,
      type: param.schema ? schemaToTypescript(param.schema, schemas, CLIENT_OPTS) : 'string',
      required: Boolean(param.required),
      description: param.description,
    };
    if (param.schema?.enum) {
      typed.enum = param.schema.enum.map((v) => String(v));
    }
    if (param.in === 'path') pathParams.push(typed);
    else if (param.in === 'query') queryParams.push(typed);
  }

  let requestBodyType: string | null = null;
  if (op.requestBody?.content) {
    const jsonContent = op.requestBody.content['application/json'];
    if (jsonContent?.schema) {
      requestBodyType = schemaToTypescript(jsonContent.schema, schemas, CLIENT_OPTS);
    }
  }

  let responseType: string | null = null;
  const successResponse = op.responses['200'] || op.responses['201'];
  if (successResponse?.content) {
    const jsonContent = successResponse.content['application/json'];
    if (jsonContent?.schema) {
      responseType = extractResultType(jsonContent.schema, schemas);
    }
  }

  return {
    operationId,
    methodName,
    tag,
    summary,
    method: HTTP_METHOD_MAP[method],
    path,
    pathParams,
    queryParams,
    requestBodyType,
    responseType,
    isPublic,
  };
}

function operationIdToMethodName(operationId: string): string {
  // Convert "workspaces.list" -> "workspacesList"
  // Convert "cloud_accounts.change_records.public.get" -> "cloudAccountsChangeRecordsPublicGet"
  // Convert "auth.reset-password" -> "authResetPassword"
  const parts = operationId.split(/[._-]/);
  return parts
    .map((p, i) => {
      if (p.length === 0) return p;
      if (i === 0) {
        return p.charAt(0).toLowerCase() + p.slice(1);
      }
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join('');
}

function extractResultType(schema: SchemaObject, schemas: Map<string, SchemaObject>): string {
  const resolved = resolveSchema(schema, schemas);
  if (resolved.properties?.result) {
    return schemaToTypescript(resolved.properties.result, schemas, CLIENT_OPTS);
  }
  return schemaToTypescript(schema, schemas, CLIENT_OPTS);
}

function resolveSchema(schema: SchemaObject, schemas: Map<string, SchemaObject>): SchemaObject {
  if (schema.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    const resolved = schemas.get(name);
    if (resolved) return resolved;
  }
  return schema;
}

export { toIdentifier, toSafeName };
