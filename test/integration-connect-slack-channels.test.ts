import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockConfig } from './helpers/config';
import {
  PICKER_DONE,
  PICKER_SEARCH,
  SLACK_CHANNELS_LATER_LINE,
  filterChannels,
  formatJoinResults,
  pickerMessage,
  pickerOptions,
  printSlackChannelsLater,
  shouldOfferSlackChannels,
  slackChannelOps,
} from '../src/commands/integration/slack-channels';

const suggestions = [
  { id: 'C_ALERTS', name: 'alerts', pitch: 'I can pick up alerts here.' },
  { id: 'C_DD', name: 'datadog', pitch: 'Alerts here too.' },
];

describe('shouldOfferSlackChannels', () => {
  it('is false when no prompt can run (dry-run, json output, non-interactive)', () => {
    assert.equal(shouldOfferSlackChannels(false, false, null), false);
    assert.equal(shouldOfferSlackChannels(false, true, false), false);
  });

  it('is true for a fresh connect in a TTY', () => {
    assert.equal(shouldOfferSlackChannels(true, false, null), true);
  });

  it('on the already-connected path, offers only when the bot is in no real channel', () => {
    assert.equal(shouldOfferSlackChannels(true, true, true), false);
    assert.equal(shouldOfferSlackChannels(true, true, false), true);
  });
});

describe('pickerOptions', () => {
  it('lists unselected suggestions with their pitch, then search, then done', () => {
    const options = pickerOptions(suggestions, [suggestions[0]!]);
    assert.deepEqual(
      options.map((o) => o.value),
      ['C_DD', PICKER_SEARCH, PICKER_DONE]
    );
    assert.equal(options[0]!.label, '#datadog');
    assert.equal(options[0]!.hint, 'Alerts here too.');
  });

  it('still offers search and done when nothing is suggested', () => {
    assert.deepEqual(
      pickerOptions([], []).map((o) => o.value),
      [PICKER_SEARCH, PICKER_DONE]
    );
  });
});

describe('pickerMessage', () => {
  it('names the current selection', () => {
    assert.match(pickerMessage([]), /Slack channels/);
    assert.match(pickerMessage([{ id: 'C1', name: 'alerts' }, { id: 'C2', name: 'deploys' }]), /#alerts, #deploys/);
  });
});

describe('filterChannels', () => {
  const channels = [
    { id: 'C1', name: 'infra-eu', isPrivate: false, isMember: false },
    { id: 'C2', name: 'infra-us', isPrivate: false, isMember: true },
    { id: 'C3', name: 'infra-secret', isPrivate: true, isMember: false },
    { id: 'C4', name: 'Infra-Apac', isPrivate: false, isMember: false },
    { id: 'C5', name: 'general', isPrivate: false, isMember: false },
  ];

  it('drops private and member channels and already-selected ones, case-insensitively', () => {
    assert.deepEqual(
      filterChannels(channels, 'infra', ['C4']).map((c) => c.id),
      ['C1']
    );
  });

  it('caps the result at ten', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `C${i}`, name: `eng-${i}`, isPrivate: false, isMember: false }));
    assert.equal(filterChannels(many, 'eng', []).length, 10);
  });

  it('returns nothing for a fragment shorter than two characters', () => {
    assert.deepEqual(filterChannels(channels, 'i', []), []);
  });
});

describe('formatJoinResults', () => {
  it('prints a checkmark, an invite line, or a skipped line per channel', () => {
    const lines = formatJoinResults([
      { channel: { id: 'C1', name: 'alerts' }, status: 'joined' },
      { channel: { id: 'C2', name: 'ops' }, status: 'invite_needed' },
      { channel: { id: 'C3', name: 'old' }, status: 'unavailable' },
    ]);
    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /^✓ #alerts/);
    assert.match(lines[1]!, /#ops.*\/invite @Polylane/);
    assert.match(lines[2]!, /#old.*skipped/);
    assert.doesNotMatch(lines[2]!, /invite/);
  });
});

describe('SLACK_CHANNELS_LATER_LINE', () => {
  it('names the exact command that shows the picker again', () => {
    assert.match(SLACK_CHANNELS_LATER_LINE, /polylane integration connect --type slack/);
  });
});

describe('slackChannelOps', () => {
  it('is null when the API client predates the channel operations', () => {
    assert.equal(slackChannelOps({ integrationsSlackChannels: async () => ({ channels: [] }) } as never), null);
  });

  it('binds both operations when the client has them', async () => {
    const api = {
      integrationsSlackChannelSuggestions: async (_ws: string, id: string) => ({ suggestions: [], inAnyRealChannel: false, canSelfJoin: true, truncated: false, id }),
      integrationsSlackChannelsJoin: async () => ({ status: 'joined' as const }),
    } as never;
    const ops = slackChannelOps(api);
    assert.ok(ops);
    assert.equal((await ops!.integrationsSlackChannelSuggestions('ws', 'int_1')).canSelfJoin, true);
    assert.equal((await ops!.integrationsSlackChannelsJoin({ workspaceId: 'ws', integrationId: 'int_1', channelId: 'C1' })).status, 'joined');
  });
});

describe('printSlackChannelsLater', () => {
  function captureStderr(fn: () => void): string {
    const chunks: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      fn();
    } finally {
      process.stderr.write = original;
    }
    return chunks.join('');
  }

  it('prints the follow-up line to stderr in json and non-interactive modes', () => {
    assert.match(captureStderr(() => printSlackChannelsLater(mockConfig({ output: 'json' }))), /polylane integration connect --type slack/);
    assert.match(captureStderr(() => printSlackChannelsLater(mockConfig({ output: 'text', nonInteractive: true, dryRun: true }))), /Add Polylane to Slack channels/);
  });

  it('stays silent under --quiet', () => {
    assert.equal(captureStderr(() => printSlackChannelsLater(mockConfig({ quiet: true }))), '');
  });
});
