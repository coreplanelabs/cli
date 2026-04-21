import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    const contents = readFileSync(path, 'utf-8');
    return JSON.parse(contents) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(path: string, data: unknown, mode?: number): void {
  ensureDir(dirname(path));
  const json = JSON.stringify(data, null, 2);
  writeFileSync(path, json, 'utf-8');
  if (mode !== undefined) {
    try {
      chmodSync(path, mode);
    } catch {
      // Ignore chmod errors on platforms that don't support it
    }
  }
}

export function fileExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

export function ensureDir(path: string, mode?: number): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode });
  }
}

export function deleteFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function getFileMode(path: string): number | null {
  try {
    const stat = statSync(path);
    return stat.mode & 0o777;
  } catch {
    return null;
  }
}
