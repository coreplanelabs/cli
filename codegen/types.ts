export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    securitySchemes?: Record<string, SecurityScheme>;
  };
  tags?: Array<{ name: string; description?: string }>;
  security?: Array<Record<string, string[]>>;
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type PathItem = {
  [K in HttpMethod]?: Operation;
};

export interface Operation {
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, ResponseObject>;
  security?: Array<Record<string, string[]>>;
}

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: SchemaObject;
}

export interface RequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, { schema: SchemaObject }>;
}

export interface ResponseObject {
  description?: string;
  content?: Record<string, { schema: SchemaObject }>;
}

export interface SchemaObject {
  $ref?: string;
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  format?: string;
  description?: string;
  enum?: Array<string | number | boolean | null>;
  items?: SchemaObject;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  additionalProperties?: boolean | SchemaObject;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  nullable?: boolean;
  default?: string | number | boolean | null;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  example?: string | number | boolean | null;
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
}

export interface SecurityScheme {
  type: string;
  in?: string;
  name?: string;
  scheme?: string;
}

export interface ParsedOperation {
  operationId: string;
  methodName: string;
  tag: string;
  summary: string;
  method: string;
  path: string;
  pathParams: ParsedParam[];
  queryParams: ParsedParam[];
  requestBodyType: string | null;
  responseType: string | null;
  isPublic: boolean;
}

export interface ParsedParam {
  name: string;
  type: string;
  required: boolean;
  enum?: string[];
  description?: string;
}

export interface ParsedSpec {
  operations: ParsedOperation[];
  schemaNames: string[];
  schemas: Map<string, SchemaObject>;
  info: OpenAPISpec['info'];
}
