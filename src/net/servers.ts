/**
 * Where the game server is: `public/servers.json` (`{ "servers": ["wss://.../play"] }`),
 * so a new domain needs only that file changed. A dev build tries a server on
 * the same machine first (`npm run server`), then the list.
 */
export async function serverUrls(): Promise<string[]> {
  let list: string[] = [];
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}servers.json`, { cache: 'no-cache' });
    if (res.ok) {
      const body = (await res.json()) as { servers?: unknown };
      if (Array.isArray(body.servers)) list = body.servers.filter((s): s is string => typeof s === 'string' && /^wss?:\/\//.test(s));
    }
  } catch {
    /* no file: fall through */
  }
  if (import.meta.env.DEV) list = [`ws://${location.hostname || 'localhost'}:8787/play`, ...list];
  return list;
}
