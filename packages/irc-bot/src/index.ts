/**
 * IRC Bot entry point
 */

import { createRedisPubSub } from '@transcriber/shared';
import { loadConfig } from './config';
import { TranscriptionBot } from './bot';

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function ts(): string {
  const d = new Date();
  return `[${d.getFullYear()}-${MONTHS[d.getMonth()]}-${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}]`;
}
(['log','warn','error'] as const).forEach((m) => {
  const orig = console[m].bind(console);
  console[m] = (...args: unknown[]) => orig(ts(), ...args);
});

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
