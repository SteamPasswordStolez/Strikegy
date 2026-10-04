/** Entry point: `npm run server` (env PORT, default 8787). */
import { startGateway } from './gateway.ts';

const server = await startGateway({ port: Number(process.env.PORT) || 8787 });
const stop = (): void => void server.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
