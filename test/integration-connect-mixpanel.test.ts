import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIXPANEL_REGIONS,
  mixpanelServiceAccountsUrl,
  parseMixpanelProjectId,
} from '../src/commands/integration/connect';
import { isCLIError, CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';

describe('parseMixpanelProjectId', () => {
  const accepted: Array<[string, number]> = [
    ['1', 1],
    ['42', 42],
    ['1000', 1000],
    ['007', 7],
    [' 42 ', 42],
    ['9007199254740991', 9007199254740991],
  ];
  for (const [input, expected] of accepted) {
    it(`accepts "${input}" as ${expected}`, () => {
      assert.equal(parseMixpanelProjectId(input, '--project-id'), expected);
    });
  }

  const rejected = [
    '1e3',
    '0x10',
    '0b101',
    '1.0',
    '0',
    '-5',
    '+1',
    '1.5',
    '1_000',
    '',
    '   ',
    'Infinity',
    'NaN',
    '9007199254740992',
    '9007199254740993',
    '12345678901234567890',
  ];
  for (const input of rejected) {
    it(`rejects "${input}" with a usage error`, () => {
      try {
        parseMixpanelProjectId(input, '--project-id');
        assert.fail('expected a CLIError');
      } catch (err) {
        assert.ok(isCLIError(err));
        assert.equal((err as CLIError).exitCode, ExitCode.USAGE);
        assert.match((err as Error).message, /Invalid value for --project-id/);
        assert.ok((err as CLIError).hint?.includes('mixpanel.com/project/<id>'));
      }
    });
  }
});

describe('MIXPANEL_REGIONS', () => {
  it('offers exactly the us, eu and in data-residency regions', () => {
    assert.deepEqual(
      MIXPANEL_REGIONS.map((r) => r.value),
      ['us', 'eu', 'in']
    );
  });
});

describe('mixpanelServiceAccountsUrl', () => {
  it('uses the bare host for us and the region-prefixed host elsewhere', () => {
    assert.equal(mixpanelServiceAccountsUrl('us'), 'https://mixpanel.com/settings/org#serviceaccounts');
    assert.equal(mixpanelServiceAccountsUrl('eu'), 'https://eu.mixpanel.com/settings/org#serviceaccounts');
    assert.equal(mixpanelServiceAccountsUrl('in'), 'https://in.mixpanel.com/settings/org#serviceaccounts');
  });
});
