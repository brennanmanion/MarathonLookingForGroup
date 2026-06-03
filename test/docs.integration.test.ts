import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';

function buildDocsConfig(loadedConfig: AppConfig): AppConfig {
  return {
    ...loadedConfig,
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: undefined,
    appSessionSecret: loadedConfig.appSessionSecret ?? 'integration-test-session-secret'
  };
}

test('integration: docs routes serve Swagger UI and the OpenAPI YAML', async () => {
  const app = await createApp(buildDocsConfig(loadConfig()), null);
  await app.ready();

  try {
    const docsResponse = await app.inject({
      method: 'GET',
      url: '/docs'
    });

    assert.equal(docsResponse.statusCode, 200);
    assert.match(docsResponse.headers['content-type'] ?? '', /^text\/html/);
    assert.match(docsResponse.body, /SwaggerUIBundle/);
    assert.match(docsResponse.body, /\/openapi\.yaml/);

    const yamlResponse = await app.inject({
      method: 'GET',
      url: '/openapi.yaml'
    });

    assert.equal(yamlResponse.statusCode, 200);
    assert.match(yamlResponse.headers['content-type'] ?? '', /^application\/yaml/);
    assert.match(yamlResponse.body, /^openapi: 3\.1\.0/m);
    assert.match(yamlResponse.body, /title: Marathon LFG API/);
    assert.match(yamlResponse.body, /MlfgAccessCookie/);
  } finally {
    await app.close();
  }
});
