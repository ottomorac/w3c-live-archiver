import { config } from 'dotenv';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { parseChannelMeetingMap, type ChannelMeetingMap, type RedisConfig } from '@transcriber/shared';

const envPaths = [
  join(process.cwd(), '.env'),
  join(process.cwd(), '../.env'),
  join(process.cwd(), '../../.env'),
  join(process.cwd(), '../../../.env'),
];

let projectRoot = process.cwd();
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    projectRoot = dirname(envPath);
    break;
  }
}

export interface RTMSGatewayConfig {
  zoom: {
    clientId: string;
    clientSecret: string;
    secretToken: string;
    oauthRedirectUri: string;
    accountId?: string;
  };
  webhook: {
    port: number;
    path: string;
  };
  redis: RedisConfig;
  channelMeetingMap: ChannelMeetingMap;
  tokenStoragePath: string;
}

export function loadConfig(): RTMSGatewayConfig {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  const secretToken = process.env.ZOOM_SECRET_TOKEN;
  const channelMeetingMapRaw = process.env.CHANNEL_MEETING_MAP;

  if (!clientId || !clientSecret || !secretToken) {
    throw new Error('ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, and ZOOM_SECRET_TOKEN are required');
  }
  if (!channelMeetingMapRaw) {
    throw new Error('CHANNEL_MEETING_MAP is required (e.g. "#did:5637387869:zoomUserIdA,#wpwg:86873854269:zoomUserIdB")');
  }

  const channelMeetingMap = parseChannelMeetingMap(channelMeetingMapRaw);
  if (Object.keys(channelMeetingMap).length === 0) {
    throw new Error('CHANNEL_MEETING_MAP contains no valid entries');
  }

  return {
    zoom: {
      clientId,
      clientSecret,
      secretToken,
      oauthRedirectUri: process.env.ZOOM_OAUTH_REDIRECT_URI || '',
      accountId: process.env.ZOOM_ACCOUNT_ID || undefined,
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
    channelMeetingMap,
    tokenStoragePath: resolve(projectRoot, process.env.TOKEN_STORAGE_PATH || '.zoom-tokens.json'),
  };
}
