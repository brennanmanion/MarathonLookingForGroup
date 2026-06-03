import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppConfig } from '../src/config.js';
import { loadConfig, validateConfig } from '../src/config.js';

function buildProductionConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'production',
    host: '0.0.0.0',
    port: 3000,
    databaseUrl: 'postgres://postgres:postgres@localhost:5432/marathon_lfg',
    bungieClientId: 'client-id',
    bungieClientSecret: 'client-secret',
    bungieApiKey: 'api-key',
    bungieRedirectUri: 'https://lfg.example.com/auth/bungie/callback',
    appUniversalLinkBase: 'https://lfg.example.com',
    webAppBaseUrl: 'https://lfg.example.com/app/',
    sessionCookieDomain: undefined,
    appSessionSecret: 'production-secret',
    ...overrides
  };
}

test('config validation allows the recommended same-origin production setup', () => {
  assert.doesNotThrow(() => validateConfig(buildProductionConfig()));
});

test('config validation rejects insecure production web origins', () => {
  assert.throws(
    () => validateConfig(buildProductionConfig({ webAppBaseUrl: 'http://lfg.example.com/app/' })),
    /WEB_APP_BASE_URL must use https in production/
  );
});

test('config validation rejects malformed production cookie domains', () => {
  assert.throws(
    () => validateConfig(buildProductionConfig({ sessionCookieDomain: 'https://example.com/app' })),
    /SESSION_COOKIE_DOMAIN must be a bare domain/
  );
});

test('config derives production web URLs from Render external URL when explicit values are omitted', () => {
  const originalEnv = {
    BUNGIE_REDIRECT_URI: process.env.BUNGIE_REDIRECT_URI,
    APP_UNIVERSAL_LINK_BASE: process.env.APP_UNIVERSAL_LINK_BASE,
    WEB_APP_BASE_URL: process.env.WEB_APP_BASE_URL,
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL
  };

  try {
    delete process.env.BUNGIE_REDIRECT_URI;
    delete process.env.APP_UNIVERSAL_LINK_BASE;
    delete process.env.WEB_APP_BASE_URL;
    process.env.RENDER_EXTERNAL_URL = 'https://marathon-lfg.onrender.com/';

    const config = loadConfig();

    assert.equal(config.bungieRedirectUri, 'https://marathon-lfg.onrender.com/auth/bungie/callback');
    assert.equal(config.appUniversalLinkBase, 'https://marathon-lfg.onrender.com');
    assert.equal(config.webAppBaseUrl, 'https://marathon-lfg.onrender.com/app/');
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
