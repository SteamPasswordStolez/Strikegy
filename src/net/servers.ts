/**
 * Where the signalling server is: `public/servers.json` (`{ "signal": ["wss://..."] }`),
 * so a new domain needs only that file changed. With an empty list a dev
 * build uses a server on the same machine (`npm run signal`).
 */
export async function signalUrls(): Promise<string[]> {
  let list: string[] = [];
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}servers.json`, { cache: 'no-cache' });
    if (res.ok) {
      const body = (await res.json()) as { signal?: unknown };
      if (Array.isArray(body.signal)) list = body.signal.filter((s): s is string => typeof s === 'string' && /^wss?:\/\//.test(s));
    }
  } catch {
    /* no file: fall through */
  }
  if (!list.length && import.meta.env.DEV) list = [`ws://${location.hostname || 'localhost'}:8787/signal`];
  return list;
}
