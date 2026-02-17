/**
 * IRC Bot entry point
 */

import { createRedisPubSub } from '@transcriber/shared';
import { loadConfig } from './config';
import { TranscriptionBot } from './bot';

async function main() {
  console.log('[IRC Bot] Starting...');

  const config = loadConfig();
  const { pub, sub } = createRedisPubSub(config.redis);

  const bot = new TranscriptionBot(config, pub, sub);
  bot.start();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[IRC Bot] Shutting down...');
    bot.stop();
    pub.disconnect();
    sub.disconnect();
    process.exit(0);
  });

  console.log('[IRC Bot] Ready');
}

main().catch((error) => {
  console.error('[IRC Bot] Fatal error:', error);
  process.exit(1);
});
