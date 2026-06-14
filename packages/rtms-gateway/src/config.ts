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
    accountId?: string;
  };
  webhook: {
    port: number;
    path: string;
  };
  redis: RedisConfig;
  channelMeetingMap: Record<string, string>;
}

function parseChannelMeetingMap(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    const colonIdx = trimmed.lastIndexOf(':');
    if (colonIdx > 0) {
      const channel = trimmed.slice(0, colonIdx).trim();
      const meetingId = trimmed.slice(colonIdx + 1).trim();
      if (channel && meetingId) map[channel] = meetingId;
    }
  }
  return map;
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
    throw new Error('CHANNEL_MEETING_MAP is required (e.g. "#did:5637387869,#wpwg:86873854269")');
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
  };
}
