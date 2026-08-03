import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatList, outputJson } from '../../output/formatter';
import { projectItems } from '../../output/project';
import {
  requireWorkspace,
  getArgString,
  getArgNumber,
  getArgBoolean,
  parseDuration,
} from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

type Category = NonNullable<NonNullable<Parameters<PolylaneAPI['feedList']>[1]>['category']>;

const CATEGORY_COVERAGE: Record<Category, true> = {
  autofix: true,
  automation: true,
  change: true,
  release: true,
  issue: true,
  digest: true,
  tier: true,
};

const VALID_CATEGORIES = Object.keys(CATEGORY_COVERAGE) as Category[];

const FIELDS = [
  'occurredAt',
  'category',
  'action',
  'title',
  'subtitle',
  'actorName',
  'actorType',
  'resourceType',
  'resourceId',
  'childCount',
  '_html_url',
];

export const feedListCommand: Command = {
  name: 'feed list',
  description: 'Workspace agent activity feed (autofixes, automations, changes, releases, issues…)',
  operationId: 'feed.list',
  options: [
    { flag: '--category <c>', description: VALID_CATEGORIES.join(' | '), type: 'string' },
    { flag: '--since <dur>', description: 'Only entries from the last <dur> (e.g. 24h, 7d, 30m)', type: 'string' },
    { flag: '--from <ms>', description: 'Occurred at or after (unix ms)', type: 'number' },
    { flag: '--to <ms>', description: 'Occurred at or before (unix ms)', type: 'number' },
    { flag: '--limit <n>', description: 'Max items, 1–200 (default 20)', type: 'number' },
    { flag: '--cursor <c>', description: 'Pagination cursor from a previous nextCursor', type: 'string' },
    { flag: '--full', description: 'Return full entries (metadata + nested children)', type: 'boolean' },
  ],
  examples: [
    'polylane feed list',
    'polylane feed list --since 24h',
    'polylane feed list --category issue --limit 50',
    'polylane feed list --cursor <nextCursor>',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);

    const category = getArgString(args, 'category');
    if (category && !VALID_CATEGORIES.includes(category as Category)) {
      throw new CLIError(
        `Invalid --category: ${category}`,
        ExitCode.USAGE,
        `Must be one of: ${VALID_CATEGORIES.join(', ')}`
      );
    }

    const limit = getArgNumber(args, 'limit') ?? 20;
    if (limit < 1 || limit > 200) {
      throw new CLIError(`Invalid --limit: ${limit}`, ExitCode.USAGE, 'Use 1–200');
    }

    const since = getArgString(args, 'since');
    const fromMs = getArgNumber(args, 'from') ?? (since ? Date.now() - parseDuration(since) : undefined);
    const toMs = getArgNumber(args, 'to');
    const cursor = getArgString(args, 'cursor');
    const full = getArgBoolean(args, 'full') === true;

    const api = new PolylaneAPI(config);
    const result = await api.feedList(workspaceId, {
      limit,
      ...(category ? { category: category as Category } : {}),
      ...(fromMs !== undefined ? { from: fromMs } : {}),
      ...(toMs !== undefined ? { to: toMs } : {}),
      ...(cursor ? { cursor } : {}),
    });

    const entries = result.entries ?? [];

    if (config.output === 'json') {
      outputJson({ items: entries, count: entries.length, nextCursor: result.nextCursor });
      return;
    }

    if (full) {
      formatList(config, { items: entries as unknown as Array<Record<string, unknown>>, count: entries.length });
      writeCursorHint(config, result.nextCursor);
      return;
    }

    const withChildCount = entries.map((e) => ({
      ...(e as unknown as Record<string, unknown>),
      childCount: e.children?.length ?? 0,
    }));

    formatList(
      config,
      {
        items: projectItems(withChildCount, FIELDS),
        count: entries.length,
      },
      {
        headers: ['When', 'Category', 'Action', 'Title', 'Actor'],
        rows: (item) => [
          String(item.occurredAt ?? ''),
          String(item.category ?? ''),
          String(item.action ?? ''),
          truncate(withGroup(String(item.title ?? ''), Number(item.childCount ?? 0)), 60),
          String(item.actorName ?? item.actorType ?? ''),
        ],
      }
    );
    writeCursorHint(config, result.nextCursor);
  },
};

function withGroup(title: string, childCount: number): string {
  return childCount > 0 ? `${title} (+${childCount})` : title;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function writeCursorHint(config: Config, nextCursor: string | null): void {
  if (config.quiet || !nextCursor) return;
  process.stdout.write(`\nMore: polylane feed list --cursor ${nextCursor}\n`);
}
