import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerLink } from '../src/net/ServerLink';
import { ServerRtc, UDP_RX } from '../server/rtc';
import { RtcLimit } from '../server/rtcLimit';

const native = vi.hoisted(() => ({
  peers: [] as { opened: () => void; closed: () => void; message: (m: Uint8Array) => void }[],
}));
vi.mock('node-datachannel', () => ({
  PeerConnection: class {
    state = (_s: string): void => {};
    opened = (): void => {};
    closed = (): void => {};
    message = (_m: Uint8Array): void => {};
    dc = {
      onOpen: (fn: () => void) => (this.opened = fn),
      onClosed: (fn: () => void) => (this.closed = fn),
      onMessage: (fn: (m: Uint8Array) => void) => (this.message = fn),
      bufferedAmount: () => 0,
      sendMessageBinary: vi.fn(() => true),
      close: vi.fn(),
    };
    constructor() {
      native.peers.push(this);
    }
    onLocalDescription() {}
    onLocalCandidate() {}
    onStateChange(fn: (s: string) => void) {
      this.state = fn;
    }
    createDataChannel() {
      return this.dc;
    }
    close() {}
  },
}));

class Socket extends EventTarget {
  static OPEN = 1;
  static latest: Socket;
  readyState = 1;
  bufferedAmount = 0;
  sent: (string | Uint8Array)[] = [];
  constructor() {
    super();
    Socket.latest = this;
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
    if (typeof data === 'string' && JSON.parse(data).t === 'hello') {
      queueMicrotask(() => this.receive({ t: 'welcome', id: 'p', name: 'test', tag: 'TEST' }));
    }
  }
  receive(msg: object): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) }));
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

class Peer {
  static latest: Peer;
  ondatachannel: ((e: { channel: Channel }) => void) | null = null;
  remoteDescription = {};
  constructor() {
    Peer.latest = this;
  }
  async setRemoteDescription(): Promise<void> {}
  async createAnswer(): Promise<object> {
    return { sdp: 'answer' };
  }
  async setLocalDescription(): Promise<void> {}
  async addIceCandidate(): Promise<void> {}
  close(): void {}
}
class Channel {
  readyState = 'open';
  bufferedAmount = 0;
  onopen = (): void => {};
  onclose = (): void => {};
  onmessage = (_e: { data: ArrayBuffer }): void => {};
  send = vi.fn();
  receive(): void {
    this.onmessage({ data: new ArrayBuffer(1) });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('RTCPeerConnection', Peer);
  native.peers.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function browser(): Promise<{ link: ServerLink; ws: Socket; dc: Channel }> {
  const link = await ServerLink.connect(['ws://test'], {
    name: 'test',
    uid: 'test',
    device: 'desktop',
  });
  const ws = Socket.latest;
  link.startUdp();
  ws.receive({ t: 'rtc', sdp: 'offer', type: 'offer' });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const dc = new Channel();
  Peer.latest.ondatachannel!({ channel: dc });
  dc.onopen();
  dc.receive();
  ws.receive({ t: 'rtc', rx: true });
  return { link, ws, dc };
}

describe('UDP recovery', () => {
  it('reports a silent downlink without input frames, falls back, then recovers', async () => {
    const { link, ws, dc } = await browser();
    const frame = new Uint8Array([1, 2]);
    link.sendBinary(frame, false);
    expect(link.udp).toBe(true);
    expect(dc.send).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(
      ws.sent.filter((m) => typeof m === 'string').map((m) => JSON.parse(m as string)),
    ).toContainEqual({ t: 'rtc', rx: false });
    expect(link.udpIn).toBe(false);
    expect(link.udp).toBe(false);
    link.sendBinary(frame, false);
    expect(ws.sent.at(-1)).toBe(frame);
    dc.receive();
    expect(link.udpIn).toBe(true);
    link.sendBinary(frame, false);
    expect(dc.send).toHaveBeenCalledTimes(3); // live, fallback probe, recovered
    const timers = vi.getTimerCount();
    link.close();
    expect(vi.getTimerCount()).toBe(timers - 1);
  });

  it('keeps reporting through more than 80 losses, even while paused', async () => {
    const { link, ws, dc } = await browser();
    const limit = new RtcLimit();
    let processed = 0;
    let cursor = 0;
    for (let i = 0; i < 120; i++) {
      dc.receive();
      vi.advanceTimersByTime(1000);
      for (const raw of ws.sent.slice(cursor)) {
        if (typeof raw !== 'string' || typeof JSON.parse(raw).rx !== 'boolean') continue;
        expect(limit.take()).toBe(true);
        processed++;
      }
      cursor = ws.sent.length;
    }
    expect(processed).toBeGreaterThan(240);
    expect(link.udp).toBe(false);
    dc.receive();
    expect(link.udp).toBe(true);
    link.close();
  });

  it('bounds signalling floods and replenishes the allowance during a long connection', () => {
    const limit = new RtcLimit();
    for (let i = 0; i < 80; i++) expect(limit.take()).toBe(true);
    expect(limit.take()).toBe(false);
    vi.advanceTimersByTime(1000);
    for (let i = 0; i < 8; i++) expect(limit.take()).toBe(true);
    expect(limit.take()).toBe(false);
  });

  it('server falls back when incoming UDP stops even if the peer health flag is stale', () => {
    const send = vi.fn();
    const rtc = new ServerRtc({ config: { iceServers: [] } }, send, vi.fn());
    const pc = native.peers[0]!;
    pc.opened();
    pc.message(new Uint8Array([1]));
    rtc.remote({ rx: true });
    expect(rtc.send(new Uint8Array([2]))).toBe(true);
    vi.advanceTimersByTime(UDP_RX + 1);
    expect(rtc.send(new Uint8Array([3]))).toBe(false);
    expect(send).toHaveBeenLastCalledWith({ t: 'rtc', rx: false });
    pc.message(new Uint8Array([4]));
    expect(rtc.send(new Uint8Array([5]))).toBe(true);
    pc.closed();
    expect(send).toHaveBeenLastCalledWith({ t: 'rtc', rx: false });
    expect(rtc.send(new Uint8Array([6]))).toBe(false);
    rtc.close();
  });
});
