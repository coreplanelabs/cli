import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export function openBrowser(url: string): void {
  const os = platform();
  let cmd: string;
  let args: string[];
  if (os === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (os === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // Caller should always print the URL so the user can copy it manually.
  }
}
