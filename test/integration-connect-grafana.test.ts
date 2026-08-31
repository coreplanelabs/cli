import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGrafanaStackUrl } from '../src/commands/integration/connect';

describe('normalizeGrafanaStackUrl', () => {
  it('keeps a clean stack URL as-is', () => {
    assert.equal(normalizeGrafanaStackUrl('https://acme.grafana.net'), 'https://acme.grafana.net');
  });

  it('adds https:// to a bare host', () => {
    assert.equal(normalizeGrafanaStackUrl('acme.grafana.net'), 'https://acme.grafana.net');
  });

  it('strips trailing slashes and deep paths', () => {
    assert.equal(normalizeGrafanaStackUrl('https://acme.grafana.net/'), 'https://acme.grafana.net');
    assert.equal(
      normalizeGrafanaStackUrl('https://acme.grafana.net/d/abc123/my-dashboard?orgId=1'),
      'https://acme.grafana.net'
    );
  });

  it('trims surrounding whitespace', () => {
    assert.equal(normalizeGrafanaStackUrl('  acme.grafana.net \n'), 'https://acme.grafana.net');
  });

  it('keeps an explicit port for self-hosted Grafana', () => {
    assert.equal(normalizeGrafanaStackUrl('https://grafana.example.com:3000/'), 'https://grafana.example.com:3000');
  });

  it('rejects http URLs', () => {
    assert.equal(normalizeGrafanaStackUrl('http://acme.grafana.net'), null);
  });

  it('rejects empty and whitespace-only values', () => {
    assert.equal(normalizeGrafanaStackUrl(''), null);
    assert.equal(normalizeGrafanaStackUrl('   '), null);
  });

  it('rejects hosts without a dot', () => {
    assert.equal(normalizeGrafanaStackUrl('localhost'), null);
    assert.equal(normalizeGrafanaStackUrl('https://grafana'), null);
  });

  it('rejects values that do not parse as a URL', () => {
    assert.equal(normalizeGrafanaStackUrl('https://'), null);
    assert.equal(normalizeGrafanaStackUrl('not a url'), null);
  });
});
