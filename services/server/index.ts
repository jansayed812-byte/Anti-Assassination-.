/**
 * Entry point: `npm start` (services) or `npm start` at the repo root.
 */
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { createOpsServer } from './app';

const production = process.env.NODE_ENV === 'production';
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (production) { console.error('JWT_SECRET must be set in production'); process.exit(1); }
  jwtSecret = randomBytes(32).toString('hex');
  console.warn('JWT_SECRET not set — using a random secret for this run (tokens reset on restart)');
}

const server = createOpsServer({
  jwtSecret,
  demoPassword: process.env.DEMO_PASSWORD ?? 'demo',
  demoMode: process.env.DEMO_MODE ? process.env.DEMO_MODE === 'true' : !production,
  corsOrigins: process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean),
  staticDir: process.env.STATIC_DIR ?? fileURLToPath(new URL('../../dashboard/dist', import.meta.url)),
});

const port = Number(process.env.PORT ?? 8000);
server.start(port, process.env.HOST ?? '0.0.0.0').then((p) => console.log(`ops console backend listening on :${p}`));

const shutdown = () => { server.stop().then(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
