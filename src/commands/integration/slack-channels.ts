import type { Config } from '../../config/schema';
import type { PolylaneAPI } from '../../generated/client';
import { Spinner } from '../../output/progress';
import { BACK, note, promptSelectOrBack, promptTextOrBack } from '../../utils/prompt';
import { scopedSigint } from '../helpers';

export interface SlackChannelRef {
  id: string;
  name: string;
}

export interface SlackChannelSuggestion extends SlackChannelRef {
  pitch: string;
}

export interface SlackChannelSuggestions {
  suggestions: SlackChannelSuggestion[];
  inAnyRealChannel: boolean;
  notificationsChannelId?: string;
  canSelfJoin: boolean;
  truncated: boolean;
}

export type SlackJoinStatus = 'joined' | 'invite_needed' | 'unavailable';

export interface SlackJoinResult {
  channel: SlackChannelRef;
  status: SlackJoinStatus;
}

interface SearchableChannel extends SlackChannelRef {
  isPrivate: boolean;
  isMember: boolean;
}

// The suggestions and join operations ship in the API after this CLI code: resolve them
// structurally so an API without them (or a client generated from its spec) makes the step
// print the follow-up line instead of failing typecheck or the command. Same pattern as the
// Honeycomb management-key field in connect.ts.
interface SlackChannelOps {
  integrationsSlackChannelSuggestions(workspaceId: string, id: string): Promise<SlackChannelSuggestions>;
  integrationsSlackChannelsJoin(body: { workspaceId: string; integrationId: string; channelId: string }): Promise<{ status: SlackJoinStatus }>;
}

export function slackChannelOps(api: PolylaneAPI): SlackChannelOps | null {
  const candidate = api as unknown as Partial<SlackChannelOps>;
  if (typeof candidate.integrationsSlackChannelSuggestions !== 'function') return null;
  if (typeof candidate.integrationsSlackChannelsJoin !== 'function') return null;
  return {
    integrationsSlackChannelSuggestions: candidate.integrationsSlackChannelSuggestions.bind(api),
    integrationsSlackChannelsJoin: candidate.integrationsSlackChannelsJoin.bind(api),
  };
}

export const PICKER_SEARCH = '__search__';
export const PICKER_DONE = '__done__';
export const SLACK_CHANNELS_LATER_LINE = 'Add Polylane to Slack channels any time: polylane integration connect --type slack';
const NO_CHANNELS_LINE = 'No public Slack channel to join yet. Polylane will suggest channels in Slack as they appear.';
const SEARCH_MIN_CHARS = 2;
const SEARCH_MAX_RESULTS = 10;

// The step runs only where a prompt can run; on the already-connected path it also needs the
// bot to be in no channel beyond its own notifications channel.
export function shouldOfferSlackChannels(interactive: boolean, alreadyConnected: boolean, inAnyRealChannel: boolean | null): boolean {
  if (!interactive) return false;
  if (alreadyConnected && inAnyRealChannel) return false;
  return true;
}

export function pickerOptions(
  suggestions: SlackChannelSuggestion[],
  selected: SlackChannelRef[]
): { value: string; label: string; hint?: string }[] {
  const chosen = new Set(selected.map((c) => c.id));
  const remaining = suggestions.filter((s) => !chosen.has(s.id)).map((s) => ({ value: s.id, label: `#${s.name}`, hint: s.pitch }));
  return [
    ...remaining,
    { value: PICKER_SEARCH, label: 'other (search)', hint: 'find a public channel by name' },
    { value: PICKER_DONE, label: selected.length > 0 ? 'Done — join the selected channels' : 'Done — skip for now' },
  ];
}

export function pickerMessage(selected: SlackChannelRef[]): string {
  if (selected.length === 0) return 'Which Slack channels should Polylane join?';
  return `Selected: ${selected.map((c) => `#${c.name}`).join(', ')}. Add another, or Done.`;
}

export function filterChannels(channels: SearchableChannel[], fragment: string, selectedIds: string[]): SearchableChannel[] {
  const needle = fragment.trim().toLowerCase();
  if (needle.length < SEARCH_MIN_CHARS) return [];
  const chosen = new Set(selectedIds);
  return channels
    .filter((c) => !c.isPrivate && !c.isMember && !chosen.has(c.id) && c.name.toLowerCase().includes(needle))
    .slice(0, SEARCH_MAX_RESULTS);
}

export function formatJoinResults(results: SlackJoinResult[]): string[] {
  return results.map(({ channel, status }) => {
    if (status === 'joined') return `✓ #${channel.name}`;
    if (status === 'invite_needed') return `#${channel.name} — run /invite @Polylane in that channel to add Polylane there`;
    return `#${channel.name} — archived or gone, skipped`;
  });
}

function say(line: string): void {
  process.stderr.write(line + '\n');
}

// R3: the one line every mode that cannot show the picker gets instead.
export function printSlackChannelsLater(config: Config): void {
  if (config.quiet) return;
  say(SLACK_CHANNELS_LATER_LINE);
}

async function searchChannel(
  config: Config,
  api: PolylaneAPI,
  workspaceId: string,
  integrationId: string,
  selected: SlackChannelRef[]
): Promise<SlackChannelRef | typeof BACK | null> {
  const ctx = { nonInteractive: config.nonInteractive };
  const fragment = await promptTextOrBack(ctx, 'Channel name (at least two characters)');
  if (fragment === BACK) return BACK;
  const spinner = new Spinner('Searching channels…');
  spinner.start();
  let channels: SearchableChannel[];
  try {
    const listed = await api.integrationsSlackChannels(workspaceId, integrationId);
    channels = listed.channels;
  } finally {
    spinner.stop();
  }
  const matches = filterChannels(channels, fragment, selected.map((c) => c.id));
  if (matches.length === 0) {
    say(`No public channel matching "${fragment.trim()}" that Polylane is not already in.`);
    return null;
  }
  const picked = await promptSelectOrBack(
    ctx,
    'Add which channel?',
    matches.map((c) => ({ value: c.id, label: `#${c.name}` })),
    '← Back to the list'
  );
  if (picked === BACK) return null;
  const channel = matches.find((c) => c.id === picked);
  return channel ? { id: channel.id, name: channel.name } : null;
}

// Callers run this only where a prompt can run (canWaitForBrowser) and print the R3 line
// themselves otherwise. One try/catch, only *OrBack prompts, and a scoped SIGINT handler:
// nothing in here can change the connect command's exit status (R10). Any failure prints the
// follow-up line and returns.
export async function runSlackChannelStep(
  config: Config,
  api: PolylaneAPI,
  workspaceId: string,
  integrationId: string,
  opts: { alreadyConnected: boolean }
): Promise<void> {
  const ops = slackChannelOps(api);
  if (!ops) {
    say(SLACK_CHANNELS_LATER_LINE);
    return;
  }
  let spinner: Spinner | null = null;
  const onSigint = (): void => {
    spinner?.stop();
    say(SLACK_CHANNELS_LATER_LINE);
    process.exit(0);
  };
  const restoreSigint = scopedSigint(onSigint);
  try {
    spinner = new Spinner('Looking at your Slack channels…');
    spinner.start();
    let suggested: SlackChannelSuggestions;
    try {
      suggested = await ops.integrationsSlackChannelSuggestions(workspaceId, integrationId);
    } finally {
      spinner.stop();
      spinner = null;
    }
    if (!shouldOfferSlackChannels(true, opts.alreadyConnected, suggested.inAnyRealChannel)) return;

    note(
      'Polylane works in the channels where alerts, deploys, and incidents land. Pick the ones it should join; you can add more later.',
      'Slack channels'
    );
    const ctx = { nonInteractive: config.nonInteractive };
    const selected: SlackChannelRef[] = [];
    for (;;) {
      const options = pickerOptions(suggested.suggestions, selected);
      const choice = await promptSelectOrBack(ctx, pickerMessage(selected), options, 'Skip for now');
      if (choice === BACK) {
        say(SLACK_CHANNELS_LATER_LINE);
        return;
      }
      if (choice === PICKER_DONE) break;
      if (choice === PICKER_SEARCH) {
        const found = await searchChannel(config, api, workspaceId, integrationId, selected);
        if (found === BACK) {
          say(SLACK_CHANNELS_LATER_LINE);
          return;
        }
        if (found) selected.push(found);
        continue;
      }
      const suggestion = suggested.suggestions.find((s) => s.id === choice);
      if (suggestion) selected.push({ id: suggestion.id, name: suggestion.name });
    }
    if (selected.length === 0) {
      if (suggested.suggestions.length === 0) say(NO_CHANNELS_LINE);
      say(SLACK_CHANNELS_LATER_LINE);
      return;
    }

    const results: SlackJoinResult[] = [];
    spinner = new Spinner('Joining channels…');
    spinner.start();
    try {
      for (const channel of selected) {
        const joined = await ops.integrationsSlackChannelsJoin({ workspaceId, integrationId, channelId: channel.id });
        results.push({ channel, status: joined.status });
      }
    } finally {
      spinner.stop();
      spinner = null;
    }
    for (const line of formatJoinResults(results)) say(line);
  } catch {
    spinner?.stop();
    say(SLACK_CHANNELS_LATER_LINE);
  } finally {
    restoreSigint();
  }
}
