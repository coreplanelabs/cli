import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { outputJson, outputTable } from '../../output/formatter';
import { requireWorkspace, getArgString, getArgNumber, parseDuration } from '../helpers';

export const feedSummaryCommand: Command = {
  name: 'feed summary',
  description: 'Activity aggregate over time (autofix PR counts per day)',
  operationId: 'feed.summary',
  options: [
    { flag: '--since <dur>', description: 'Window to aggregate over (e.g. 7d, 30d)', type: 'string' },
    { flag: '--from <ms>', description: 'Start of window (unix ms)', type: 'number' },
    { flag: '--to <ms>', description: 'End of window (unix ms)', type: 'number' },
  ],
  examples: ['polylane feed summary', 'polylane feed summary --since 30d'],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);

    const since = getArgString(args, 'since');
    const fromMs = getArgNumber(args, 'from') ?? (since ? Date.now() - parseDuration(since) : undefined);
    const toMs = getArgNumber(args, 'to');

    const api = new PolylaneAPI(config);
    const result = await api.feedSummary({
      workspaceId,
      ...(fromMs !== undefined ? { from: fromMs } : {}),
      ...(toMs !== undefined ? { to: toMs } : {}),
    });

    if (config.output === 'json') {
      outputJson(result);
      return;
    }

    process.stdout.write(`Autofix PRs: ${result.autofixPrs}\n\n`);
    const daily = result.autofixDaily ?? [];
    if (daily.length === 0) {
      process.stdout.write('(no daily activity)\n');
      return;
    }
    outputTable(
      ['Date', 'Autofix PRs'],
      daily.map((d) => [String(d.date), String(d.count)])
    );
  },
};
