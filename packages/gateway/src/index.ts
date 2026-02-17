/**
 * Transcription Gateway entry point
 */

import { createRedisPubSub } from '@transcriber/shared';
import { loadConfig } from './config';
import { GatewayServer } from './gateway-server';

async function main() {
  console.log('[Gateway] Starting...');

  const config = loadConfig();
  const { pub, sub } = createRedisPubSub(config.redis);

  const gateway = new GatewayServer(config, pub, sub);

  // For now, start with default channel and no chairs
  // In Phase 3, this will be triggered via API
  const ircChannel = process.env.IRC_CHANNEL || '#test';
  await gateway.start(ircChannel);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Gateway] Shutting down...');
    await gateway.stop();
    pub.disconnect();
    sub.disconnect();
    process.exit(0);
  });

  console.log('[Gateway] Ready and listening for audio');
}

main().catch((error) => {
  console.error('[Gateway] Fatal error:', error);
  process.exit(1);
});
