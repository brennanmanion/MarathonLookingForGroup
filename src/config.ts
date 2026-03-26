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
  appSessionSecret: string | undefined;
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
    appSessionSecret: readOptional('APP_SESSION_SECRET')
  };
}
