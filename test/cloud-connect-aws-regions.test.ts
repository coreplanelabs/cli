import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAwsRegions } from '../src/commands/cloud/connect';

describe('parseAwsRegions', () => {
  it('maps a single region to a one-element list', () => {
    assert.deepEqual(parseAwsRegions('us-east-1'), ['us-east-1']);
  });

  it('splits a comma-separated list and drops blanks', () => {
    assert.deepEqual(parseAwsRegions('us-east-1, eu-west-1,,ap-south-1 '), ['us-east-1', 'eu-west-1', 'ap-south-1']);
  });

  it('maps "all" to null, which the API reads as every enabled region', () => {
    assert.equal(parseAwsRegions('all'), null);
    assert.equal(parseAwsRegions('ALL'), null);
  });

  it('rejects "all" mixed with specific regions instead of silently scanning everything', () => {
    assert.throws(() => parseAwsRegions('us-east-1,all'), /mixes "all" with specific regions/);
  });

  it('rejects an empty value', () => {
    assert.throws(() => parseAwsRegions(''), /Invalid value for --region/);
    assert.throws(() => parseAwsRegions(' , '), /Invalid value for --region/);
  });
});
