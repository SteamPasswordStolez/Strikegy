import type { IceServer } from './signalProtocol';

/** WebRTC set-up messages, passed through the signalling server. */
export type LinkSignal =
  | { k: 'want' }
  | { k: 'offer' | 'answer'; sdp: string }
  | { k: 'ice'; c: RTCIceCandidateInit }
  | { k: 'bye' };

/** First byte of messages on the `state` channel that the link handles itself. */
const PING = 0xf0;
const PONG = 0xf1;
/** Smoothing of the round-trip estimate (share of a new sample). */
const RTT_BLEND = 0.25;

/**
 * One WebRTC connection to a peer with two data channels, set up on both
 * sides by id (no in-band announcement):
 * - `state` (id 0): unordered, never resent. Positions and inputs: a lost
 *   packet is replaced by the next one instead of holding everything up.
 * - `events` (id 1): ordered and reliable. Kills, captures, the full state.
 * The peer with the lower id sends the offer; the other only answers, so the
 * two never offer at once.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  readonly state: RTCDataChannel;
  readonly events: RTCDataChannel;
  /** Smoothed round trip in ms, -1 until the first pong. */
  rtt = -1;
  /** True when the working connection goes through a TURN relay. */
  relayed = false;
  lastHeard = performance.now();
  onState: ((data: ArrayBuffer) => void) | null = null;
  onEvent: ((data: string | ArrayBuffer) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private closed = false;
  private opened = false;

  constructor(
    readonly peer: string,
    readonly offerer: boolean,
    ice: IceServer[],
    private readonly signal: (data: LinkSignal) => void,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ice });
    this.state = this.pc.createDataChannel('state', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    this.events = this.pc.createDataChannel('events', { negotiated: true, id: 1, ordered: true });
    for (const ch of [this.state, this.events]) {
      ch.binaryType = 'arraybuffer';
      ch.addEventListener('open', () => this.checkOpen());
      ch.addEventListener('close', () => this.close());
    }
    this.state.addEventListener('message', (e: MessageEvent<ArrayBuffer | string>) => this.onStateMessage(e.data));
    this.events.addEventListener('message', (e: MessageEvent<ArrayBuffer | string>) => {
      this.lastHeard = performance.now();
      this.onEvent?.(e.data);
    });
    this.pc.addEventListener('icecandidate', (e) => {
      if (e.candidate) this.signal({ k: 'ice', c: e.candidate.toJSON() });
    });
    this.pc.addEventListener('connectionstatechange', () => {
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') this.close();
    });
    if (offerer) void this.makeOffer();
  }

  get isOpen(): boolean {
    return this.opened && !this.closed;
  }

  private checkOpen(): void {
    if (this.opened || this.state.readyState !== 'open' || this.events.readyState !== 'open') return;
    this.opened = true;
    void this.refreshRoute();
    this.onOpen?.();
  }

  private async makeOffer(): Promise<void> {
    try {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      this.signal({ k: 'offer', sdp: this.pc.localDescription!.sdp });
    } catch {
      this.close();
    }
  }

  /** A set-up message from the peer. */
  async handleSignal(data: LinkSignal): Promise<void> {
    if (this.closed) return;
    try {
      if (data.k === 'offer' && !this.offerer) {
        await this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        await this.flushIce();
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        this.signal({ k: 'answer', sdp: this.pc.localDescription!.sdp });
      } else if (data.k === 'answer' && this.offerer) {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flushIce();
      } else if (data.k === 'ice') {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(data.c);
        else this.pendingIce.push(data.c);
      } else if (data.k === 'bye') this.close();
    } catch {
      this.close();
    }
  }

  private async flushIce(): Promise<void> {
    const list = this.pendingIce;
    this.pendingIce = [];
    for (const c of list) await this.pc.addIceCandidate(c).catch(() => {});
  }

  private onStateMessage(data: ArrayBuffer | string): void {
    this.lastHeard = performance.now();
    if (typeof data === 'string') return;
    const view = new DataView(data);
    if (data.byteLength === 9 && view.getUint8(0) === PING) {
      const pong = new Uint8Array(data.slice(0));
      pong[0] = PONG;
      this.sendState(pong.buffer);
      return;
    }
    if (data.byteLength === 9 && view.getUint8(0) === PONG) {
      const sample = performance.now() - view.getFloat64(1);
      if (sample >= 0 && sample < 60000) this.rtt = this.rtt < 0 ? sample : this.rtt + (sample - this.rtt) * RTT_BLEND;
      return;
    }
    this.onState?.(data);
  }

  /** Sends a ping on the state channel (the pong updates `rtt`). */
  ping(): void {
    const buf = new ArrayBuffer(9);
    const view = new DataView(buf);
    view.setUint8(0, PING);
    view.setFloat64(1, performance.now());
    this.sendState(buf);
  }

  sendState(data: ArrayBuffer | ArrayBufferView<ArrayBuffer>): void {
    if (this.state.readyState === 'open') this.state.send(data as ArrayBuffer);
  }

  sendEvent(data: string | ArrayBuffer | ArrayBufferView<ArrayBuffer>): void {
    if (this.events.readyState === 'open') this.events.send(data as ArrayBuffer);
  }

  /** Looks up whether the working candidate pair goes through TURN. */
  async refreshRoute(): Promise<void> {
    try {
      const stats = await this.pc.getStats();
      let pairId: string | undefined;
      stats.forEach((s: { type: string; selectedCandidatePairId?: string }) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
      });
      let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined;
      stats.forEach((s: { type: string; id: string; nominated?: boolean; state?: string }) => {
        if (s.type !== 'candidate-pair') return;
        if (pairId ? s.id === pairId : s.nominated && s.state === 'succeeded') pair = s as typeof pair;
      });
      if (!pair) return;
      const type = (id: string | undefined): string | undefined => (id ? (stats.get(id) as { candidateType?: string } | undefined)?.candidateType : undefined);
      this.relayed = type(pair.localCandidateId) === 'relay' || type(pair.remoteCandidateId) === 'relay';
    } catch {
      /* stats unavailable: keep the old answer */
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.signal({ k: 'bye' });
    } catch {
      /* signalling already gone */
    }
    this.pc.close();
    this.onClose?.();
  }
}
