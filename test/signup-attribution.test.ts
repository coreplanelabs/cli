import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSignupAttribution } from '../src/auth/signup-attribution';

test('installer attribution retains the original source and the assisting article', () => {
  const attribution = { source: 'producthunt', campaign: 'launch', landingPage: '/', blog: 'context-graph', signupPage: '/pricing/' };
  assert.deepEqual(parseSignupAttribution(JSON.stringify(attribution)), attribution);
});

test('invalid attribution fields are discarded without breaking signup', () => {
  assert.equal(parseSignupAttribution('broken'), null);
  assert.equal(parseSignupAttribution('x'.repeat(4097)), null);
  assert.deepEqual(parseSignupAttribution({ source: 'google', landingPage: '/?secret=private', arbitrary: 'secret' }), { source: 'google' });
});
