import * as p from '@clack/prompts';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { isInteractive } from './env';

export interface PromptContext {
  nonInteractive: boolean;
}

function ensureInteractive(ctx: PromptContext, fieldName: string): void {
  if (!isInteractive(ctx.nonInteractive)) {
    throw new CLIError(
      `Missing required input: ${fieldName}`,
      ExitCode.USAGE,
      'Pass the value as a flag or run in a TTY'
    );
  }
}

export async function promptText(
  ctx: PromptContext,
  message: string,
  options: { placeholder?: string; defaultValue?: string; validate?: (v: string) => string | undefined } = {}
): Promise<string> {
  ensureInteractive(ctx, message);
  const result = await p.text({
    message,
    placeholder: options.placeholder,
    defaultValue: options.defaultValue,
    validate: options.validate,
  });
  if (p.isCancel(result)) {
    throw new CLIError('Cancelled', ExitCode.GENERAL);
  }
  return result;
}

export async function promptPassword(ctx: PromptContext, message: string): Promise<string> {
  ensureInteractive(ctx, message);
  const result = await p.password({ message });
  if (p.isCancel(result)) {
    throw new CLIError('Cancelled', ExitCode.GENERAL);
  }
  return result;
}

export async function promptSelect<T extends string>(
  ctx: PromptContext,
  message: string,
  options: Array<{ value: T; label: string; hint?: string }>
): Promise<T> {
  ensureInteractive(ctx, message);
  const result = await p.select({
    message,
    options,
  });
  if (p.isCancel(result)) {
    throw new CLIError('Cancelled', ExitCode.GENERAL);
  }
  return result as T;
}

export async function promptConfirm(
  ctx: PromptContext,
  message: string,
  defaultValue = false
): Promise<boolean> {
  ensureInteractive(ctx, message);
  const result = await p.confirm({
    message,
    initialValue: defaultValue,
  });
  if (p.isCancel(result)) {
    throw new CLIError('Cancelled', ExitCode.GENERAL);
  }
  return result;
}

export function intro(message: string): void {
  p.intro(message);
}

export function outro(message: string): void {
  p.outro(message);
}

const NOTE_MAX_WIDTH = 76;

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const indent = line.match(/^\s*/)?.[0] ?? '';
  const wrapped: string[] = [];
  let current = indent;
  for (const word of line.trim().split(/\s+/)) {
    if (current === indent) {
      current += word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      wrapped.push(current);
      current = indent + word;
    }
  }
  if (current !== indent) wrapped.push(current);
  return wrapped;
}

// Wraps at word boundaries, preserving existing line breaks and each line's
// leading indentation. Words longer than the width (URLs) are never split —
// breaking a URL would also break its click target.
export function wrapText(text: string, width: number = NOTE_MAX_WIDTH): string {
  return text
    .split('\n')
    .flatMap((line) => wrapLine(line, width))
    .join('\n');
}

export function note(message: string, title?: string): void {
  // clack draws a box around the note; wrap long lines so the box survives
  // the terminal edge (leave room for the box borders and padding).
  const width = Math.max(40, Math.min(NOTE_MAX_WIDTH, (process.stderr.columns ?? 80) - 8));
  p.note(wrapText(message, width), title);
}
