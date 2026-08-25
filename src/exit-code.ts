export function settledExitCode(): number {
  return typeof process.exitCode === 'number' ? process.exitCode : 0;
}
