import { config as loadDotEnv } from 'dotenv';

loadDotEnv();

type Environment = 'development' | 'test' | 'production';

export interface AppConfig {
  nodeEnv: Environment;
  host: string;
  port: number;
  databaseUrl: string | undefined;
  bungieClientId: string | undefined;
  bungieClientSecret: string | undefined;
  bungieApiKey: string | undefined;
  bungieRedirectUri: string | undefined;
  appUniversalLinkBase: string | undefined;
  webAppBaseUrl: string | undefined;
  sessionCookieDomain: string | undefined;
  appSessionSecret: string | undefined;
}

function assertHttpsUrl(name: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${name} must use https in production`);
  }
}

function assertCookieDomain(value: string | undefined): void {
  if (!value) {
    return;
  }

  if (value.includes('://') || value.includes('/') || /\s/.test(value)) {
    throw new Error('SESSION_COOKIE_DOMAIN must be a bare domain such as example.com or .example.com');
  }
}

function parseNodeEnv(value: string | undefined): Environment {
  if (value === 'production' || value === 'test') {
    return value;
  }

  return 'development';
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? '3000');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3000;
}

function readOptional(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== '' ? value : undefined;
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: parseNodeEnv(process.env.NODE_ENV),
    host: process.env.HOST ?? '0.0.0.0',
    port: parsePort(process.env.PORT),
    databaseUrl: readOptional('DATABASE_URL'),
    bungieClientId: readOptional('BUNGIE_CLIENT_ID'),
    bungieClientSecret: readOptional('BUNGIE_CLIENT_SECRET'),
    bungieApiKey: readOptional('BUNGIE_API_KEY'),
    bungieRedirectUri: readOptional('BUNGIE_REDIRECT_URI'),
    appUniversalLinkBase: readOptional('APP_UNIVERSAL_LINK_BASE'),
    webAppBaseUrl: readOptional('WEB_APP_BASE_URL'),
    sessionCookieDomain: readOptional('SESSION_COOKIE_DOMAIN'),
    appSessionSecret: readOptional('APP_SESSION_SECRET')
  };
}

export function validateConfig(config: AppConfig): void {
  if (config.nodeEnv !== 'production') {
    return;
  }

  if (!config.appSessionSecret) {
    throw new Error('APP_SESSION_SECRET is required in production');
  }

  assertHttpsUrl('WEB_APP_BASE_URL', config.webAppBaseUrl);
  assertHttpsUrl('BUNGIE_REDIRECT_URI', config.bungieRedirectUri);
  assertHttpsUrl('APP_UNIVERSAL_LINK_BASE', config.appUniversalLinkBase);
  assertCookieDomain(config.sessionCookieDomain);
}
