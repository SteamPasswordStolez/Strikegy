/** Entry point: `npm run signal` (env PORT, CF_TURN_KEY_ID, CF_TURN_API_TOKEN). */
import { startSignalServer } from './signal.ts';
import { turnConfigFrom } from './turn.ts';

const server = await startSignalServer({ port: Number(process.env.PORT) || 8787, turn: turnConfigFrom(process.env) });
const stop = (): void => void server.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
