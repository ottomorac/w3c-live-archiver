import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';
import type { RedisConfig } from '@transcriber/shared';

const envPaths = [
  join(process.cwd(), '.env'),
  join(process.cwd(), '../.env'),
  join(process.cwd(), '../../.env'),
  join(process.cwd(), '../../../.env'),
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

export interface RTMSGatewayConfig {
  zoom: {
    clientId: string;
    clientSecret: string;
    secretToken: string;
    oauthRedirectUri: string;
  };
  webhook: {
    port: number;
    path: string;
  };
  redis: RedisConfig;
  irc: {
    channel: string;
  };
}

export function loadConfig(): RTMSGatewayConfig {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  const secretToken = process.env.ZOOM_SECRET_TOKEN;
  const ircChannel = process.env.IRC_CHANNEL;

  if (!clientId || !clientSecret || !secretToken) {
    throw new Error('ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, and ZOOM_SECRET_TOKEN are required');
  }
  if (!ircChannel) {
    throw new Error('IRC_CHANNEL is required');
  }

  return {
    zoom: {
      clientId,
      clientSecret,
      secretToken,
      oauthRedirectUri: process.env.ZOOM_OAUTH_REDIRECT_URI || '',
    },
    webhook: {
      port: parseInt(process.env.WEBHOOK_PORT || '3000'),
      path: process.env.WEBHOOK_PATH || '/webhook',
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    },
    irc: { channel: ircChannel },
  };
}
