/**
 * Match data over UDP: a WebRTC data channel per player next to the
 * WebSocket (unordered, no resends: a late snapshot or input is worth nothing,
 * and a lost one no longer holds up the ones after it as on TCP).
 *
 * The game server's home address must not show (the owner's wish), so it
 * only offers a relayed address on the TURN server on the Oracle relay
 * (coturn there, `docs/server-setup.md`), which it logs into with the
 * credentials in `~/.strikegy-turn.json` (never in git). Without that file
 * there is no UDP and everything stays on the WebSocket; `STRIKEGY_RTC_LOCAL=1`
 * allows direct connections instead (local testing).
 *
 * Signalling rides on the WebSocket as `rtc` messages (the browser asks, the
 * server offers, both trade candidates).
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PeerConnection, type DataChannel, type RtcConfig } from 'node-datachannel';
import type { ServerMsg } from '../src/net/lobbyProtocol.ts';

export interface TurnLogin {
  host: string;
  port: number;
  user: string;
  pass: string;
}

/** How the server sets up UDP: through the TURN relay, directly (local testing), or not at all. */
export type RtcSetup = { turn: TurnLogin } | { direct: true } | null;

export function rtcSetup(): RtcSetup {
  if (process.env.STRIKEGY_RTC_LOCAL === '1') return { direct: true };
  const file = process.env.STRIKEGY_TURN_FILE ?? join(homedir(), '.strikegy-turn.json');
  if (!existsSync(file)) return null;
  try {
    const t = JSON.parse(readFileSync(file, 'utf8')) as TurnLogin;
    return t.host && t.port && t.user && t.pass ? { turn: t } : null;
  } catch {
    return null;
  }
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
    setup: NonNullable<RtcSetup>,
    send: (msg: ServerMsg) => void,
    onBinary: (data: Uint8Array) => void,
  ) {
    const config: RtcConfig =
      'turn' in setup
        ? { iceServers: [{ hostname: setup.turn.host, port: setup.turn.port, username: setup.turn.user, password: setup.turn.pass, relayType: 'TurnUdp' }], iceTransportPolicy: 'relay' }
        : { iceServers: [] };
    this.pc = new PeerConnection('player', config);
    // Browsers find their own public address with plain STUN on the same relay (so it lets their packets through).
    const stun = 'turn' in setup ? `${setup.turn.host}:${setup.turn.port}` : undefined;
    this.pc.onLocalDescription((sdp, type) => send({ t: 'rtc', sdp, type: type as 'offer', stun }));
    this.pc.onLocalCandidate((cand, mid) => send({ t: 'rtc', cand, mid }));
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
