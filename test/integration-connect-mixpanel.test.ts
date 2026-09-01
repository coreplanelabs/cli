import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIXPANEL_REGIONS,
  mixpanelServiceAccountsUrl,
  parseMixpanelProjectId,
  parseMixpanelRegion,
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
  ];
  for (const input of rejected) {
    it(`rejects "${input}" with the positive-integer usage error`, () => {
      try {
        parseMixpanelProjectId(input, '--project-id');
        assert.fail('expected a CLIError');
      } catch (err) {
        assert.ok(isCLIError(err));
        assert.equal((err as CLIError).exitCode, ExitCode.USAGE);
        assert.match((err as Error).message, /Invalid value for --project-id/);
        assert.ok((err as CLIError).hint?.includes('mixpanel.com/project/<id>'));
        assert.match((err as CLIError).hint ?? '', /Pass the numeric project ID/);
        assert.ok(!((err as CLIError).hint ?? '').includes('maximum safe integer'));
      }
    });
  }

  // These ARE positive integers, so the rejection must name the real reason
  // (past Number.MAX_SAFE_INTEGER) instead of "a positive integer".
  const tooLarge = ['9007199254740992', '9007199254740993', '12345678901234567890'];
  for (const input of tooLarge) {
    it(`rejects "${input}" naming the too-large reason`, () => {
      try {
        parseMixpanelProjectId(input, '--project-id');
        assert.fail('expected a CLIError');
      } catch (err) {
        assert.ok(isCLIError(err));
        assert.equal((err as CLIError).exitCode, ExitCode.USAGE);
        assert.match((err as Error).message, /Invalid value for --project-id/);
        assert.ok((err as CLIError).hint?.includes('mixpanel.com/project/<id>'));
        assert.match((err as CLIError).hint ?? '', /maximum safe integer \(9007199254740991\)/);
      }
    });
  }
});

describe('parseMixpanelRegion', () => {
  for (const region of ['us', 'eu', 'in'] as const) {
    it(`accepts "${region}"`, () => {
      assert.equal(parseMixpanelRegion(region), region);
    });
  }

  for (const input of ['xx', 'europe', '', 'US', ' us ']) {
    it(`rejects "${input}" with a usage error listing the regions`, () => {
      try {
        parseMixpanelRegion(input);
        assert.fail('expected a CLIError');
      } catch (err) {
        assert.ok(isCLIError(err));
        assert.equal((err as CLIError).exitCode, ExitCode.USAGE);
        assert.match((err as Error).message, /Invalid value for --region/);
        assert.equal((err as CLIError).hint, 'Use one of: us, eu, in');
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
