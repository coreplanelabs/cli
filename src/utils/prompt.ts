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
      'Run with the appropriate flag or enable interactive mode'
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

export function note(message: string, title?: string): void {
  p.note(message, title);
}
