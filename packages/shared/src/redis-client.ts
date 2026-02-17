/**
 * Shared Redis client configuration
 */

import Redis from 'ioredis';
import type { RedisConfig } from './types';

export function createRedisClient(config: RedisConfig): Redis {
  const redis = new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db || 0,
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError(err: Error) {
      const targetErrors = ['READONLY', 'ECONNRESET'];
      if (targetErrors.some(targetError => err.message.includes(targetError))) {
        return true;
      }
      return false;
    }
  });

  redis.on('connect', () => {
    console.log('[Redis] Connected');
  });

  redis.on('error', (err: Error) => {
    console.error('[Redis] Error:', err.message);
  });

  redis.on('close', () => {
    console.log('[Redis] Connection closed');
  });

  return redis;
}

export function createRedisPubSub(config: RedisConfig): { pub: Redis; sub: Redis } {
  return {
    pub: createRedisClient(config),
    sub: createRedisClient(config)
  };
}
