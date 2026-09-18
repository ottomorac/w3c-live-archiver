import { createRedisPubSub } from '@transcriber/shared';
import { loadConfig } from './config';
import { RTMSGateway } from './rtms-gateway';

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function ts(): string {
  const d = new Date();
  return `[${d.getFullYear()}-${MONTHS[d.getMonth()]}-${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}]`;
}
(['log','warn','error'] as const).forEach((m) => {
  const orig = console[m].bind(console);
  console[m] = (...args: unknown[]) => orig(ts(), ...args);
});

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
