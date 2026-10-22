import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/paths';

export interface SignupAttribution {
  source?: string;
  medium?: string;
  campaign?: string;
  referrer?: string;
  landingPage?: string;
  blog?: string;
  signupPage?: string;
}

export function parseSignupAttribution(value: unknown): SignupAttribution | null {
  if (typeof value === "string") {
    if (value.length > 4096) return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const output: SignupAttribution = {};
  for (const field of ["source", "medium", "campaign", "referrer", "landingPage", "blog", "signupPage"] as const) {
    const text = input[field];
    if (typeof text !== "string" || !text || text.length > 256) continue;
    if (field === "landingPage" || field === "signupPage") {
      if (!/^\/[a-zA-Z0-9/._-]*$/.test(text)) continue;
    } else if (!/^[a-zA-Z0-9 ._:/-]+$/.test(text)) continue;
    output[field] = text;
  }
  return Object.keys(output).length ? output : null;
}

export function readInstallAttribution(): SignupAttribution | null {
  try {
    const raw = readFileSync(join(CONFIG_DIR, 'attribution'), 'utf8').trim();
    if (raw.length > 12288) return null;
    return parseSignupAttribution(decodeURIComponent(raw));
  } catch {
    return null;
  }
}
