/**
 * Gateway configuration
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';
import type { DeepgramConfig, RedisConfig } from '@transcriber/shared';

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

export interface GatewayConfig {
  deepgram: DeepgramConfig;
  redis: RedisConfig;
  websocket: {
    port: number;
  };
  logging: {
    level: string;
  };
}

export function loadConfig(): GatewayConfig {
  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  if (!deepgramKey) {
    throw new Error('DEEPGRAM_API_KEY is required');
  }

  return {
    deepgram: {
      apiKey: deepgramKey,
      model: 'nova-2',
      language: 'en',
      diarize: true,
      punctuate: true,
      interim_results: true
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    },
    websocket: {
      port: parseInt(process.env.GATEWAY_WS_PORT || '8080')
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info'
    }
  };
}
