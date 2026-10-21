import { PROTOCOL_VERSION, type ClientMsg, type Device, type ErrorCode, type ServerMsg } from './lobbyProtocol';

type Handlers = {
  [K in ServerMsg['t']]: (msg: Extract<ServerMsg, { t: K }>) => void;
} & { close: () => void };

export class ServerError extends Error {
  constructor(
    readonly code: ErrorCode | 'connect',
    /** What came with it (for `version`: the server's protocol number). */
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/** Bytes waiting on the data channel past which match data goes by the WebSocket instead. */
const UDP_BACKLOG = 64 * 1024;
/** The channel counts as heard while something came down it within this (ms); a copy goes down it this often while the server doesn't hear it (server/rtc.ts `UDP_RX`). */
const UDP_RX = 600;
const UDP_PROBE = 250;

/**
 * The browser's end of the game server's WebSocket: hello, then typed
 * messages both ways. In a match, match data can also go over UDP (a WebRTC
 * data channel the server offers through its relay, `startUdp`).
 */
export class ServerLink {
  private readonly listeners = new Map<keyof Handlers, Set<(msg: ServerMsg) => void>>();
  private readonly binaryListeners = new Set<(data: Uint8Array) => void>();
  id = '';
  name = '';
  /** The server's tag for this browser (shown after the name). */
  tag = '';
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private udpAsked = false;
  /** When something last came down the channel, whether that counts as heard (and the server was told), whether the server hears us. */
  private lastIn = -Infinity;
  private heard = false;
  private peerHears = false;
  private lastProbe = -Infinity;

  private lastReport = -Infinity;
  private udpWatch: ReturnType<typeof setInterval> | null = null;

  private constructor(private readonly ws: WebSocket) {
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', (e) => {
      if (e.data instanceof ArrayBuffer) {
        const data = new Uint8Array(e.data);
        this.binaryListeners.forEach((fn) => fn(data));
        return;
      }
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      this.listeners.get(msg.t)?.forEach((fn) => fn(msg));
    });
    ws.addEventListener('close', () => {
      this.stopUdpWatch();
      this.pc?.close();
      this.pc = this.dc = null;
      this.listeners.get('close')?.forEach((fn) => (fn as () => void)());
    });
    this.on('rtc', (m) => void this.onRtc(m));
  }

  /** Match data over UDP from here on, if the server offers it (it carries on over the WebSocket meanwhile, or for good). */
  startUdp(): void {
    if (this.udpAsked || typeof RTCPeerConnection === 'undefined') return;
    this.udpAsked = true;
    this.send({ t: 'rtc' });
    // Inputs stop in menus / background tabs; a dead downlink must still be
    // reported so snapshots resume over the WebSocket.
    this.udpWatch = setInterval(() => this.report(), UDP_PROBE);
  }

  /** Match data goes out over UDP: the channel is up and both ends hear it. */
  get udp(): boolean {
    return this.udpIn && this.peerHears;
  }

  /** Match data comes in over UDP (the channel is heard from). */
  get udpIn(): boolean {
    return this.dc?.readyState === 'open' && performance.now() - this.lastIn < UDP_RX;
  }

  /** Whether the channel is heard from now; the server is told when that changes. */
  private report(): void {
    const now = performance.now();
    const heard = this.udpIn;
    if (heard === this.heard && now - this.lastReport < 1000) return;
    this.heard = heard;
    this.lastReport = now;
    this.send({ t: 'rtc', rx: heard });
  }

  private stopUdpWatch(): void {
    if (this.udpWatch !== null) clearInterval(this.udpWatch);
    this.udpWatch = null;
  }

  private async onRtc(m: Extract<ServerMsg, { t: 'rtc' }>): Promise<void> {
    if (typeof m.rx === 'boolean') {
      this.peerHears = m.rx;
      return;
    }
    try {
      if (m.sdp && m.type === 'offer') {
        this.pc?.close();
        this.dc = null;
        this.lastIn = -Infinity;
        this.report();
        // STUN on the relay: this browser's public address, so the relay lets its packets through.
        this.peerHears = false;
        const pc = (this.pc = new RTCPeerConnection({ iceServers: m.stun ? [{ urls: `stun:${m.stun}` }] : [] }));
        pc.ondatachannel = (e) => {
          if (this.pc !== pc) return;
          const dc = e.channel;
          dc.binaryType = 'arraybuffer';
          dc.onopen = () => {
            if (this.pc !== pc) return;
            this.dc = dc;
            if (import.meta.env.DEV) console.info('[strikegy] match data over UDP');
          };
          dc.onclose = () => {
            if (this.dc !== dc) return;
            this.dc = null;
            this.report();
          };
          dc.onmessage = (ev) => {
            if (this.dc !== dc) return;
            if (ev.data instanceof ArrayBuffer) {
              this.lastIn = performance.now();
              this.report();
              const data = new Uint8Array(ev.data);
              this.binaryListeners.forEach((fn) => fn(data));
            }
          };
        };
        pc.onicecandidate = (e) => {
          if (e.candidate?.candidate) this.send({ t: 'rtc', cand: e.candidate.candidate, mid: e.candidate.sdpMid ?? '0' });
        };
        await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send({ t: 'rtc', sdp: answer.sdp, type: 'answer' });
        for (const c of this.pendingCandidates.splice(0)) await pc.addIceCandidate(c);
      } else if (m.cand) {
        const c: RTCIceCandidateInit = { candidate: m.cand, sdpMid: m.mid ?? '0' };
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(c);
        else this.pendingCandidates.push(c);
      }
    } catch {
      // No UDP: everything stays on the WebSocket.
    }
  }

  /** Connects to the first server that answers and says hello. */
  static async connect(urls: readonly string[], hello: { name: string; uid: string; device: Device }): Promise<ServerLink> {
    let last: unknown = new ServerError('connect', 'no server');
    for (const url of urls) {
      try {
        const ws = await open(url);
        const client = new ServerLink(ws);
        const welcome = await client.request({ t: 'hello', v: PROTOCOL_VERSION, ...hello }, 'welcome');
        client.id = welcome.id;
        client.name = welcome.name;
        client.tag = welcome.tag;
        return client;
      } catch (err) {
        last = err;
      }
    }
    throw last;
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  on<K extends keyof Handlers>(t: K, fn: Handlers[K]): () => void {
    let set = this.listeners.get(t);
    if (!set) this.listeners.set(t, (set = new Set()));
    const f = fn as unknown as (msg: ServerMsg) => void;
    set.add(f);
    return () => void set.delete(f);
  }

  send(msg: ClientMsg): void {
    if (this.open) this.ws.send(JSON.stringify(msg));
  }

  /**
   * Match data (inputs): over UDP when `reliable` is false, the channel is up
   * and both ends hear it, else the WebSocket (with now and then a copy
   * down the channel, so the server notices when it gets through again).
   */
  sendBinary(data: Uint8Array, reliable = true): void {
    this.report();
    const dc = this.dc;
    if (!reliable && dc && dc.readyState === 'open' && dc.bufferedAmount < UDP_BACKLOG) {
      try {
        if (this.peerHears && this.heard) {
          dc.send(data as Uint8Array<ArrayBuffer>);
          return;
        }
        const now = performance.now();
        if (now - this.lastProbe >= UDP_PROBE) {
          this.lastProbe = now;
          dc.send(data as Uint8Array<ArrayBuffer>);
        }
      } catch {
        /* the WebSocket then */
      }
    }
    if (this.open) this.ws.send(data as Uint8Array<ArrayBuffer>);
  }

  /** Match data from the server (snapshots). */
  onBinary(fn: (data: Uint8Array) => void): () => void {
    this.binaryListeners.add(fn);
    return () => void this.binaryListeners.delete(fn);
  }

  /** Bytes waiting to go out (a slow line backs up here). */
  get buffered(): number {
    return this.ws.bufferedAmount;
  }

  /** Sends and waits for the answer of a kind (or an error, which rejects). */
  request<K extends ServerMsg['t']>(msg: ClientMsg, answer: K, timeoutMs = 8000): Promise<Extract<ServerMsg, { t: K }>> {
    return new Promise((resolve, reject) => {
      const done = (): void => {
        offOk();
        offErr();
        offClose();
        clearTimeout(timer);
      };
      const offOk = this.on(answer, ((m: Extract<ServerMsg, { t: K }>) => {
        done();
        resolve(m);
      }) as Handlers[K]);
      const offErr = this.on('error', (m) => {
        done();
        reject(new ServerError(m.code, m.detail));
      });
      const offClose = this.on('close', () => {
        done();
        reject(new ServerError('connect', 'closed'));
      });
      const timer = setTimeout(() => {
        done();
        reject(new ServerError('connect', 'timeout'));
      }, timeoutMs);
      this.send(msg);
    });
  }

  close(): void {
    this.stopUdpWatch();
    this.pc?.close();
    this.ws.close();
  }
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new ServerError('connect', 'timeout'));
    }, 5000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new ServerError('connect', url));
    });
  });
}
