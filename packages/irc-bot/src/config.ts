/**
 * IRC Bot configuration
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';
import type { IRCConfig, RedisConfig } from '@transcriber/shared';

// Try to find .env file in current directory or parent directories
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

export function loadConfig(): BotConfig {
  const server = process.env.IRC_SERVER;
  const channel = process.env.IRC_CHANNEL;

  if (!server || !channel) {
    throw new Error('IRC_SERVER and IRC_CHANNEL are required');
  }

  return {
    irc: {
      server,
      port: parseInt(process.env.IRC_PORT || '6667'),
      channel,
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
