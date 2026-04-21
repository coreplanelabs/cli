import type { Config } from '../../src/config/schema';

export function mockConfig(overrides: Partial<Config> = {}): Config {
  return {
    domain: 'api.example.test',
    output: 'json',
    timeout: 30,
    verbose: false,
    quiet: false,
    noColor: true,
    dryRun: false,
    nonInteractive: true,
    ...overrides,
  };
}
