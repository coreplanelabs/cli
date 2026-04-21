import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateDomain, validateOutput, validateTimeout, validateWorkspaceId } from '../src/config/schema';
import { CLIError } from '../src/errors/base';

describe('validateDomain', () => {
  it('accepts valid hostnames', () => {
    validateDomain('api.nominal.dev');
    validateDomain('localhost');
    validateDomain('api.staging.example.com');
  });

  it('rejects protocol prefix', () => {
    assert.throws(() => validateDomain('https://api.example.com'), CLIError);
    assert.throws(() => validateDomain('http://api.example.com'), CLIError);
  });

  it('rejects empty string', () => {
    assert.throws(() => validateDomain(''), CLIError);
  });
});

describe('validateOutput', () => {
  it('accepts text and json', () => {
    validateOutput('text');
    validateOutput('json');
  });

  it('rejects other values', () => {
    assert.throws(() => validateOutput('xml'), CLIError);
    assert.throws(() => validateOutput(''), CLIError);
  });
});

describe('validateTimeout', () => {
  it('accepts positive numbers', () => {
    validateTimeout(1);
    validateTimeout(300);
  });

  it('rejects zero and negatives', () => {
    assert.throws(() => validateTimeout(0), CLIError);
    assert.throws(() => validateTimeout(-1), CLIError);
  });
});

describe('validateWorkspaceId', () => {
  it('accepts well-formed IDs', () => {
    validateWorkspaceId('ws_rii32455qptezc7467usm3f3hq31qkwp');
  });

  it('rejects malformed IDs', () => {
    assert.throws(() => validateWorkspaceId('ws_short'), CLIError);
    assert.throws(() => validateWorkspaceId('acc_rii32455qptezc7467usm3f3hq31qkwp'), CLIError);
  });
});
