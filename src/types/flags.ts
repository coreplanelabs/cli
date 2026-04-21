export type OutputFormat = 'text' | 'json';
export type SortOrder = 'asc' | 'desc';

export interface GlobalFlags {
  apiKey?: string;
  workspace?: string;
  domain?: string;
  output?: OutputFormat;
  timeout?: number;
  quiet?: boolean;
  verbose?: boolean;
  noColor?: boolean;
  dryRun?: boolean;
  nonInteractive?: boolean;
  help?: boolean;
  version?: boolean;
  perPage?: number;
  page?: number;
  orderBy?: string;
  order?: SortOrder;
}
