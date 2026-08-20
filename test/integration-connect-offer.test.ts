import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldOfferCodeAgent } from '../src/commands/integration/connect';

describe('shouldOfferCodeAgent', () => {
  it('offers on an interactive code-agent picker', () => {
    assert.equal(shouldOfferCodeAgent('code-agent', false, true), true);
  });

  it('never offers outside the code-agent category', () => {
    assert.equal(shouldOfferCodeAgent(undefined, false, true), false);
    assert.equal(shouldOfferCodeAgent('observability', false, true), false);
  });

  it('never offers when --type already decided', () => {
    assert.equal(shouldOfferCodeAgent('code-agent', true, true), false);
  });

  it('never offers non-interactively', () => {
    assert.equal(shouldOfferCodeAgent('code-agent', false, false), false);
  });
});
