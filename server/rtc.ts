/**
 * Match data over UDP: a WebRTC data channel per player next to the
 * WebSocket (unordered, no resends: a late snapshot or input is worth nothing,
 * and a lost one no longer holds up the ones after it as on TCP).
 *
 * In production the channel ends on the Oracle relay (`edge.ts`), never on
 * the server laptop: the owner's home address must not show, and a WebRTC
 * peer's address always shows to the other end (asking it to use only a TURN
 * relay did not stop libdatachannel from connecting directly, 2026-10-05).
 * The laptop's gateway only runs channels itself for local testing
 * (`STRIKEGY_RTC_LOCAL=1`).
 *
 * Signalling rides on the WebSocket as `rtc` messages (the browser asks, the
 * server offers, both trade candidates).
 */
import { networkInterfaces } from 'node:os';
import { PeerConnection, type DataChannel, type RtcConfig } from 'node-datachannel';
import type { ServerMsg } from '../src/net/lobbyProtocol.ts';

/** How channels are made: the WebRTC set-up, and (behind a 1:1 NAT) the private address to swap for the public one in what goes out. */
export interface RtcSetup {
  config: RtcConfig;
  rewrite?: { from: string; to: string };
}

/** The laptop's gateway: channels only for local testing. */
export function localRtcSetup(): RtcSetup | null {
  return process.env.STRIKEGY_RTC_LOCAL === '1' ? { config: { iceServers: [] } } : null;
}

/**
 * The edge on the Oracle relay: one UDP port for every channel (`port`, open
 * in the cloud's security list and the machine's firewall), its private
 * address swapped for the public one (the cloud's 1:1 NAT keeps the port).
 */
export function edgeRtcSetup(publicIp: string, port: number): RtcSetup {
  let priv = '';
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && !priv) priv = a.address;
  return {
    config: { iceServers: [], enableIceUdpMux: true, portRangeBegin: port, portRangeEnd: port },
    rewrite: priv && publicIp ? { from: priv, to: publicIp } : undefined,
  };
}

/** Bytes waiting on a channel past which a snapshot goes by the WebSocket instead (a backed-up line). */
const BACKLOG = 64 * 1024;
/** Largest message a browser may send down the channel (an input frame is well under 1 KB). */
const MAX_IN = 16 * 1024;

/**
 * A browser's answer, rebuilt from the few fields a data channel needs, each
 * checked (ICE user and password, DTLS fingerprint, roles, SCTP port): the
 * native SDP parser only ever sees text made here. Null when it doesn't fit.
 */
export function cleanAnswer(sdp: string): string | null {
  const get = (re: RegExp): string | undefined => re.exec(sdp)?.[1];
  const ufrag = get(/^a=ice-ufrag:([A-Za-z0-9+/]{4,256})\r?$/m);
  const pwd = get(/^a=ice-pwd:([A-Za-z0-9+/]{22,256})\r?$/m);
  const fp = /^a=fingerprint:(sha-256|sha-384|sha-512) ((?:[0-9A-Fa-f]{2}:){31,63}[0-9A-Fa-f]{2})\r?$/m.exec(sdp);
  const setup = get(/^a=setup:(active|passive)\r?$/m) ?? 'active';
  const mid = get(/^a=mid:([A-Za-z0-9_-]{1,16})\r?$/m) ?? '0';
  const sctp = Number(get(/^a=sctp-port:(\d{1,5})\r?$/m) ?? 5000);
  const maxMsg = Number(get(/^a=max-message-size:(\d{1,10})\r?$/m) ?? 262144);
  if (!ufrag || !pwd || !fp || !(sctp > 0 && sctp < 65536)) return null;
  return [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    `a=group:BUNDLE ${mid}`,
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=mid:${mid}`,
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:${fp[1]} ${fp[2]}`,
    `a=setup:${setup}`,
    `a=sctp-port:${sctp}`,
    `a=max-message-size:${Math.min(maxMsg, 262144)}`,
    '',
  ].join('\r\n');
}

/** One player's data channel. */
export class ServerRtc {
  private readonly pc: PeerConnection;
  private readonly dc: DataChannel;
  private open = false;
  private closed = false;

  constructor(
    setup: RtcSetup,
    send: (msg: ServerMsg) => void,
    onBinary: (data: Uint8Array) => void,
  ) {
    this.pc = new PeerConnection('player', { ...setup.config, maxMessageSize: MAX_IN });
    const fix = (s: string): string => (setup.rewrite ? s.split(setup.rewrite.from).join(setup.rewrite.to) : s);
    this.pc.onLocalDescription((sdp, type) => send({ t: 'rtc', sdp: fix(sdp), type: type as 'offer' }));
    this.pc.onLocalCandidate((cand, mid) => {
      // Only IPv4 the browser can reach (no link-local or IPv6 leftovers).
      if (/ (fe80|::1|[0-9a-f]+:[0-9a-f:]+) /i.test(cand)) return;
      send({ t: 'rtc', cand: fix(cand), mid });
    });
    this.pc.onStateChange((state) => {
      if (state === 'failed' || state === 'closed') this.open = false;
    });
    this.dc = this.pc.createDataChannel('match', { unordered: true, maxRetransmits: 0 });
    this.dc.onOpen(() => (this.open = true));
    this.dc.onClosed(() => (this.open = false));
    this.dc.onMessage((msg) => {
      if (typeof msg === 'string' || msg.byteLength > MAX_IN) return;
      const u8 = msg instanceof ArrayBuffer ? new Uint8Array(msg) : new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
      onBinary(u8);
    });
  }

  /**
   * The browser's answer. Its candidates are not used at all: the browser
   * reaches the server's public address itself and the server answers where
   * that came from (so nobody can make the server send packets to an address
   * of their choosing, inside the cloud or anyone else's).
   */
  remote(msg: { sdp?: string; type?: string; cand?: string; mid?: string }): void {
    if (this.closed || !msg.sdp || msg.type !== 'answer' || this.pc.remoteDescription()) return;
    const sdp = cleanAnswer(msg.sdp);
    if (!sdp) return;
    try {
      this.pc.setRemoteDescription(sdp, 'answer');
    } catch {
      /* this channel just never opens */
    }
  }

  /** Sends over UDP if the channel is up and not backed up; false: use the WebSocket. */
  send(data: Uint8Array): boolean {
    if (!this.open || this.closed) return false;
    try {
      if (this.dc.bufferedAmount() > BACKLOG) return false;
      return this.dc.sendMessageBinary(data);
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    try {
      this.dc.close();
      this.pc.close();
    } catch {
      /* already gone */
    }
  }
}

/**
 * A WebSocket text frame that is a channel's set-up (`rtc`): what the
 * gateway or the edge handles itself. Returns the parsed fields, `ask` for a
 * new channel, or null when it isn't one (or is malformed).
 */
export function parseRtc(text: string): { ask: true } | { sdp?: string; type?: string; cand?: string; mid?: string } | null {
  if (!text.startsWith('{"t":"rtc"') || text.length > 20000) return null;
  let m: { sdp?: unknown; type?: unknown; cand?: unknown; mid?: unknown };
  try {
    m = JSON.parse(text) as typeof m;
  } catch {
    return null;
  }
  const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined);
  if (m.sdp === undefined && m.cand === undefined) return { ask: true };
  return { sdp: str(m.sdp, 16000), type: str(m.type, 8), cand: str(m.cand, 512), mid: str(m.mid, 16) };
}
