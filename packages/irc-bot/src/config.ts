/**
 * IRC Bot configuration
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';
import type { IRCConfig, RedisConfig } from '@transcriber/shared';

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

export interface BotConfig {
  irc: IRCConfig;
  redis: RedisConfig;
  logging: {
    level: string;
  };
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

export function loadConfig(): BotConfig {
  const server = process.env.IRC_SERVER;
  const channelMeetingMapRaw = process.env.CHANNEL_MEETING_MAP;

  if (!server) {
    throw new Error('IRC_SERVER is required');
  }
  if (!channelMeetingMapRaw) {
    throw new Error('CHANNEL_MEETING_MAP is required (e.g. "#did:5637387869,#wpwg:86873854269")');
  }

  const channelMeetingMap = parseChannelMeetingMap(channelMeetingMapRaw);
  if (Object.keys(channelMeetingMap).length === 0) {
    throw new Error('CHANNEL_MEETING_MAP contains no valid entries');
  }

  return {
    irc: {
      server,
      port: parseInt(process.env.IRC_PORT || '6667'),
      channelMeetingMap,
      nick: process.env.IRC_BOT_NICK || 'transcriber-bot',
      username: process.env.IRC_BOT_USERNAME || 'transcriber',
      realname: process.env.IRC_BOT_REALNAME || 'Meeting Transcription Bot',
      sasl: process.env.IRC_SASL_USERNAME ? {
        username: process.env.IRC_SASL_USERNAME,
        password: process.env.IRC_SASL_PASSWORD || ''
      } : undefined
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info'
    }
  };
}
