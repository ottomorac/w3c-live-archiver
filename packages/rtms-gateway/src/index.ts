import { createRedisPubSub } from '@transcriber/shared';
import { loadConfig } from './config';
import { RTMSGateway } from './rtms-gateway';

(async () => {
  console.log('[RTMSGateway] Starting...');

  const config = loadConfig();
  const { pub: redis, sub: redisSub } = createRedisPubSub(config.redis);

  const gateway = new RTMSGateway(config, redis, redisSub);

  await gateway.start();

  process.on('SIGINT', async () => {
    console.log('[RTMSGateway] Shutting down...');
    await gateway.stop();
    process.exit(0);
  });
})();
