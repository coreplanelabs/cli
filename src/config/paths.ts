import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureDir } from '../utils/fs';

export const CONFIG_DIR = join(homedir(), '.nominal');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');
export const UPDATE_STATE_FILE = join(CONFIG_DIR, 'update-state.json');
export const TELEMETRY_STATE_FILE = join(CONFIG_DIR, 'telemetry.json');

export function ensureConfigDir(): void {
  ensureDir(CONFIG_DIR, 0o700);
}
