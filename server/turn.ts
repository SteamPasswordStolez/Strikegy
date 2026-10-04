/**
 * Cloudflare TURN credentials (Cloudflare Realtime). Short-lived ICE servers
 * come from Cloudflare's API with the TURN key's token, which stays on the
 * server and never reaches a browser. One set is shared and refreshed well
 * before it expires (fewer API calls). Without a key: STUN only, so players
 * behind carrier NAT (most phones) may fail to connect.
 */
import type { IceServer } from '../src/net/signalProtocol.ts';

export interface TurnConfig {
  keyId: string;
  apiToken: string;
}

/** Credentials live this long (longer than any match); refreshed after half. */
const TTL_S = 6 * 3600;
const STUN_ONLY: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

/**
 * Drops Cloudflare's port-53 fallbacks. On the owner's line (and likely other
 * Korean home lines) UDP 53 is caught by the router / ISP DNS, and a STUN
 * server there kept two browsers on the same PC from ever connecting
 * (measured 2026-10-04: with :53 in the list ICE stayed in "checking"; 3478
 * alone connected every time).
 */
export function withoutPort53(list: IceServer[]): IceServer[] {
  return list
    .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length > 0);
}

export function turnConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TurnConfig | null {
  const keyId = env.CF_TURN_KEY_ID?.trim();
  const apiToken = env.CF_TURN_API_TOKEN?.trim();
  return keyId && apiToken ? { keyId, apiToken } : null;
}

export class TurnCredentials {
  private cached: IceServer[] | null = null;
  private fetchedAt = 0;
  private pending: Promise<IceServer[]> | null = null;
  private readonly config: TurnConfig | null;
  private readonly log: (line: string) => void;

  constructor(config: TurnConfig | null, log: (line: string) => void) {
    this.config = config;
    this.log = log;
  }

  get enabled(): boolean {
    return this.config !== null;
  }

  async iceServers(): Promise<IceServer[]> {
    if (!this.config) return STUN_ONLY;
    if (this.cached && Date.now() - this.fetchedAt < (TTL_S * 1000) / 2) return this.cached;
    this.pending ??= this.fetch(this.config).finally(() => (this.pending = null));
    return this.pending;
  }

  private async fetch(cfg: TurnConfig): Promise<IceServer[]> {
    try {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cfg.keyId)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_S }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { iceServers?: IceServer | IceServer[] };
      const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
      const usable = withoutPort53(list);
      if (!usable.length) throw new Error('no iceServers in the answer');
      this.cached = usable;
      this.fetchedAt = Date.now();
      return usable;
    } catch (err) {
      // Keep the old set if there is one; else STUN only (direct links still work).
      this.log(`TURN credentials failed: ${String(err)}`);
      return this.cached ?? STUN_ONLY;
    }
  }
}
