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
/** Candidates a browser may send (more is somebody playing games). */
const CANDIDATES_MAX = 40;

/** One player's data channel. */
export class ServerRtc {
  private readonly pc: PeerConnection;
  private readonly dc: DataChannel;
  private open = false;
  private candidates = 0;
  private closed = false;

  constructor(
    setup: RtcSetup,
    send: (msg: ServerMsg) => void,
    onBinary: (data: Uint8Array) => void,
  ) {
    this.pc = new PeerConnection('player', setup.config);
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
      if (typeof msg === 'string') return;
      const u8 = msg instanceof ArrayBuffer ? new Uint8Array(msg) : new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
      onBinary(u8);
    });
  }

  /** The browser's answer or one of its candidates. */
  remote(msg: { sdp?: string; type?: string; cand?: string; mid?: string }): void {
    if (this.closed) return;
    try {
      if (msg.sdp && msg.type === 'answer' && !this.pc.remoteDescription()) this.pc.setRemoteDescription(msg.sdp, 'answer');
      else if (msg.cand && this.candidates++ < CANDIDATES_MAX) this.pc.addRemoteCandidate(msg.cand, msg.mid ?? '0');
    } catch {
      /* a bad description or candidate: this channel just never opens */
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
