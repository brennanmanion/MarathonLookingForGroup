import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';

function buildShellConfig(loadedConfig: AppConfig): AppConfig {
  return {
    ...loadedConfig,
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: undefined,
    webAppBaseUrl: 'https://app.example.test/app/',
    appSessionSecret: loadedConfig.appSessionSecret ?? 'integration-test-session-secret'
  };
}

test('integration: web shell routes serve the initial PWA app', async () => {
  const app = await createApp(buildShellConfig(loadConfig()), null);
  await app.ready();

  try {
    const rootResponse = await app.inject({
      method: 'GET',
      url: '/app'
    });

    assert.equal(rootResponse.statusCode, 200);
    assert.match(rootResponse.headers['content-type'] ?? '', /^text\/html/);
    assert.match(rootResponse.body, /Marathon LFG/);
    assert.match(rootResponse.body, /\/app\//);

    const callbackResponse = await app.inject({
      method: 'GET',
      url: '/app/auth/callback/success'
    });

    assert.equal(callbackResponse.statusCode, 200);
    assert.match(callbackResponse.headers['content-type'] ?? '', /^text\/html/);

    const feedResponse = await app.inject({
      method: 'GET',
      url: '/app/parties'
    });

    assert.equal(feedResponse.statusCode, 200);
    assert.match(feedResponse.headers['content-type'] ?? '', /^text\/html/);

    const detailResponse = await app.inject({
      method: 'GET',
      url: '/app/parties/test-party-id'
    });

    assert.equal(detailResponse.statusCode, 200);
    assert.match(detailResponse.headers['content-type'] ?? '', /^text\/html/);

    const scriptMatch = rootResponse.body.match(/src="([^"]*\/app\/assets\/[^"]+\.js)"/);
    assert.ok(scriptMatch?.[1]);

    const scriptResponse = await app.inject({
      method: 'GET',
      url: scriptMatch[1]
    });

    assert.equal(scriptResponse.statusCode, 200);
    assert.match(scriptResponse.headers['content-type'] ?? '', /^text\/javascript/);
    assert.ok(scriptResponse.body.length > 0);

    const manifestResponse = await app.inject({
      method: 'GET',
      url: '/app/manifest.webmanifest'
    });

    assert.equal(manifestResponse.statusCode, 200);
    assert.match(manifestResponse.headers['content-type'] ?? '', /^application\/manifest\+json/);
    assert.match(manifestResponse.body, /"start_url": "\/app"/);
  } finally {
    await app.close();
  }
});
