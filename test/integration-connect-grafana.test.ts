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

  it('rejects loopback and 0/8 hosts, including canonicalized IPv4 forms', () => {
    assert.equal(normalizeGrafanaStackUrl('https://127.0.0.1'), null);
    assert.equal(normalizeGrafanaStackUrl('https://127.0.0.1:3000'), null);
    assert.equal(normalizeGrafanaStackUrl('https://0.0.0.0'), null);
    // The WHATWG URL parser canonicalizes hex / octal / integer forms to dotted-quad.
    assert.equal(normalizeGrafanaStackUrl('https://0x7f000001'), null);
    assert.equal(normalizeGrafanaStackUrl('https://2130706433'), null);
    assert.equal(normalizeGrafanaStackUrl('https://0177.0.0.1'), null);
    assert.equal(normalizeGrafanaStackUrl('https://017700000001'), null);
  });

  it('rejects RFC1918 private ranges', () => {
    assert.equal(normalizeGrafanaStackUrl('https://10.0.0.5'), null);
    assert.equal(normalizeGrafanaStackUrl('https://172.16.0.1'), null);
    assert.equal(normalizeGrafanaStackUrl('https://172.31.255.255'), null);
    assert.equal(normalizeGrafanaStackUrl('https://192.168.1.1'), null);
  });

  it('rejects link-local hosts, including the cloud metadata endpoint', () => {
    assert.equal(normalizeGrafanaStackUrl('https://169.254.169.254'), null);
    assert.equal(normalizeGrafanaStackUrl('https://169.254.0.1'), null);
  });

  it('rejects localhost names and bracketed IPv6 literals', () => {
    assert.equal(normalizeGrafanaStackUrl('https://grafana.localhost'), null);
    assert.equal(normalizeGrafanaStackUrl('https://[::1]'), null);
    assert.equal(normalizeGrafanaStackUrl('https://[::ffff:127.0.0.1]'), null);
  });

  it('accepts public IPs that only look like private-range boundaries', () => {
    assert.equal(normalizeGrafanaStackUrl('https://172.15.0.1'), 'https://172.15.0.1');
    assert.equal(normalizeGrafanaStackUrl('https://172.32.0.1'), 'https://172.32.0.1');
    assert.equal(normalizeGrafanaStackUrl('https://192.169.0.1'), 'https://192.169.0.1');
    assert.equal(normalizeGrafanaStackUrl('https://169.253.0.1'), 'https://169.253.0.1');
  });
});
