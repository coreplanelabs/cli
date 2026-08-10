import type { Config } from '../config/schema';
import { requestJson } from './http';

export type ScanReportStatus = 'running' | 'ready' | 'failed';
export type ScanRiskSeverity = 'low' | 'medium' | 'high';

export interface ScanReportRisk {
  id?: string;
  title: string;
  detail: string;
  severity: ScanRiskSeverity;
  resourceIds: string[];
  resourceTypes: string[];
}

export type ScanInvestigationStatus = 'running' | 'done' | 'failed';

export interface ScanRiskInvestigation {
  riskId: string;
  threadId: string;
  issueId?: string | null;
  status: ScanInvestigationStatus;
}

export interface ScanReport {
  id: string;
  workspaceId: string;
  kind: 'cloud' | 'integration';
  provider: string;
  alias: string | null;
  status: ScanReportStatus;
  risks: ScanReportRisk[];
  riskInvestigations?: ScanRiskInvestigation[];
  riskCount: number;
  highRiskCount: number;
  _html_url?: string;
}

export interface GenerateScanReportBody {
  workspaceId: string;
  kind: 'cloud' | 'integration';
  provider: string;
  id?: string;
}

export interface GenerateScanReportResult {
  id: string | null;
  status: 'running' | 'failed';
}

// The scan_reports routes are deployed but marked hide:true in the OpenAPI
// spec, so the generated client never includes them — call them with literal
// paths until nominal exposes them.
export async function generateScanReport(
  config: Config,
  body: GenerateScanReportBody
): Promise<GenerateScanReportResult> {
  return requestJson<GenerateScanReportResult>(config, {
    method: 'POST',
    url: '/v1/scan_reports',
    body,
  });
}

export async function getScanReport(
  config: Config,
  workspaceId: string,
  id: string
): Promise<ScanReport> {
  return requestJson<ScanReport>(config, {
    method: 'GET',
    url: `/v1/scan_reports/${encodeURIComponent(workspaceId)}/${encodeURIComponent(id)}`,
  });
}

export interface InvestigateScanRisksBody {
  workspaceId: string;
  scanReportId: string;
  riskIds?: string[];
}

export interface InvestigateScanRisksResult {
  investigations: ScanRiskInvestigation[];
}

// Starts a background investigation per risk: each risk gets its own issue
// (origin "scan") and investigation thread, and the response carries the
// report's full investigation list including previously started ones.
export async function investigateScanRisks(
  config: Config,
  body: InvestigateScanRisksBody
): Promise<InvestigateScanRisksResult> {
  return requestJson<InvestigateScanRisksResult>(config, {
    method: 'POST',
    url: '/v1/scan_reports/investigate',
    body,
  });
}
