import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { githubConnectUrl, prReviewsChoiceFromFlags, prReviewsFlagsGiven } from '../src/commands/integration/connect';
import { mockConfig } from './helpers/config';

describe('prReviewsChoiceFromFlags', () => {
  it('--no-pr-reviews opts out without asking', () => {
    assert.equal(prReviewsChoiceFromFlags({ noPrReviews: true }, true), 'off');
    assert.equal(prReviewsChoiceFromFlags({ noPrReviews: true }, false), 'off');
  });

  it('--pr-reviews records an explicit keep-on without asking', () => {
    assert.equal(prReviewsChoiceFromFlags({ prReviews: true }, true), 'on');
    assert.equal(prReviewsChoiceFromFlags({ prReviews: true }, false), 'on');
  });

  it('asks when interactive and no flag decided', () => {
    assert.equal(prReviewsChoiceFromFlags({}, true), 'ask');
  });

  it('sends no choice non-interactively so the server keeps the default and records nothing', () => {
    assert.equal(prReviewsChoiceFromFlags({}, false), undefined);
  });

  it('opt-out wins when both flags are passed', () => {
    assert.equal(prReviewsChoiceFromFlags({ prReviews: true, noPrReviews: true }, true), 'off');
  });
});

describe('prReviewsFlagsGiven', () => {
  it('is true for either flag, so a non-GitHub type can warn that it is ignored', () => {
    assert.equal(prReviewsFlagsGiven({ noPrReviews: true }), true);
    assert.equal(prReviewsFlagsGiven({ prReviews: true }), true);
    assert.equal(prReviewsFlagsGiven({}), false);
    assert.equal(prReviewsFlagsGiven({ noBrowser: true }), false);
  });
});

describe('githubConnectUrl', () => {
  const config = mockConfig();

  it('forwards an explicit choice to the console connect page', () => {
    const url = new URL(githubConnectUrl(config, 'ws_1', 'off'));
    assert.equal(url.pathname, '/cli/connect');
    assert.equal(url.searchParams.get('flow'), 'github');
    assert.equal(url.searchParams.get('workspace'), 'ws_1');
    assert.equal(url.searchParams.get('pr_reviews'), 'off');
  });

  it('forwards a kept-on answer too, so the console records that the question was asked', () => {
    const url = new URL(githubConnectUrl(config, 'ws_1', 'on'));
    assert.equal(url.searchParams.get('pr_reviews'), 'on');
  });

  it('omits the parameter entirely when no choice was made', () => {
    const url = new URL(githubConnectUrl(config, 'ws_1', undefined));
    assert.equal(url.searchParams.has('pr_reviews'), false);
  });
});
