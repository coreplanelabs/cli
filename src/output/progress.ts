import { isStderrTTY } from '../utils/env';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_RATE = 80;

export class Spinner {
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private label: string;
  private readonly active: boolean;

  constructor(label = '') {
    this.label = label;
    this.active = isStderrTTY();
  }

  start(label?: string): void {
    if (label !== undefined) this.label = label;
    if (!this.active) return;
    if (this.timer) return;
    process.stderr.write('\x1B[?25l'); // hide cursor
    this.timer = setInterval(() => this.render(), FRAME_RATE);
    this.render();
  }

  update(label: string): void {
    this.label = label;
    if (this.active && this.timer) this.render();
  }

  stop(finalLabel?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.active) {
      if (finalLabel) process.stderr.write(finalLabel + '\n');
      return;
    }
    process.stderr.write('\r\x1B[K'); // clear line
    process.stderr.write('\x1B[?25h'); // show cursor
    if (finalLabel) process.stderr.write(finalLabel + '\n');
  }

  fail(label?: string): void {
    this.stop(label ?? this.label);
  }

  private render(): void {
    const frame = FRAMES[this.frame]!;
    this.frame = (this.frame + 1) % FRAMES.length;
    process.stderr.write(`\r${frame} ${this.label}\x1B[K`);
  }
}

export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const spinner = new Spinner(label);
  spinner.start();
  try {
    const result = await fn();
    spinner.stop();
    return result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}
