/** Entry point: `npm run server` (env PORT, default 8787). */
import { startGateway } from './gateway.ts';

// Each room in its own thread: building a map or a heavy tick holds up nobody else.
const server = await startGateway({ port: Number(process.env.PORT) || 8787, workers: true });
const stop = (): void => void server.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
