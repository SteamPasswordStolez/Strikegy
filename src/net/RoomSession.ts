import { onBattery, runBench } from './bench';
import { PeerLink, type LinkSignal } from './PeerLink';
import type { SignalClient } from './SignalClient';
import type { Device, Report, Room } from './signalProtocol';

/** How often links are pinged and the waiting-room measurements are sent. */
const PING_MS = 1000;
const REPORT_MS = 3000;
/** Nothing from the host for this long in a match: tell the server it's gone. */
const HOST_SILENT_MS = 3000;

/**
 * The browser's side of a room: keeps the room as the server describes it and
 * opens the WebRTC links this member needs.
 * - Waiting: links to the host candidates (a candidate links to everyone), to
 *   measure round trips; measurements go to the server, which picks the host.
 * - In a match: the host links to everyone; the others to the host and the
 *   backup (so a takeover needs no new connection).
 */
export class RoomSession {
  room: Room | null = null;
  readonly links = new Map<string, PeerLink>();
  /** Called whenever the room or a link changes (for the menu to redraw). */
  onChange: (() => void) | null = null;
  /** The server took this member out of the room. */
  onLeft: ((reason: 'leave' | 'kicked' | 'closed') => void) | null = null;
  private readonly offs: (() => void)[] = [];
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private bench: number | null = null;
  private battery = false;
  private lastReport = '';
  private hostLostSent = false;

  constructor(
    readonly signal: SignalClient,
    readonly device: Device,
  ) {
    this.offs.push(
      signal.on('room', (m) => {
        const wasHost = this.room?.host;
        this.room = m.room;
        if (m.room.host !== wasHost) this.hostLostSent = false;
        this.syncLinks();
        this.onChange?.();
      }),
      signal.on('left', (m) => {
        this.room = null;
        this.closeLinks();
        this.onLeft?.(m.reason);
        this.onChange?.();
      }),
      signal.on('signal', (m) => void this.onSignal(m.from, m.data as LinkSignal)),
      signal.on('close', () => {
        this.room = null;
        this.closeLinks();
        this.onLeft?.('closed');
        this.onChange?.();
      }),
    );
    this.timers.push(
      setInterval(() => this.tick(), PING_MS),
      setInterval(() => this.report(), REPORT_MS),
    );
    // Measure once, after the menu has drawn (the benchmark blocks ~0.1-0.3 s).
    setTimeout(() => {
      if (device === 'desktop') this.bench = runBench();
      void onBattery().then((b) => {
        this.battery = b;
        this.report();
      });
    }, 300);
  }

  get me(): string {
    return this.signal.id;
  }

  get isHost(): boolean {
    return !!this.room && this.room.host === this.me;
  }

  /** Peers this member should be linked to right now. */
  wanted(): Set<string> {
    const r = this.room;
    const out = new Set<string>();
    if (!r) return out;
    const others = r.members.map((m) => m.id).filter((id) => id !== this.me);
    if (r.state === 'lobby') {
      if (r.candidates.includes(this.me)) others.forEach((id) => out.add(id));
      else r.candidates.forEach((id) => id !== this.me && out.add(id));
    } else if (r.host === this.me) others.forEach((id) => out.add(id));
    else {
      if (r.host) out.add(r.host);
      if (r.backup && r.backup !== this.me) out.add(r.backup);
      // The backup keeps links to everyone, ready to take over.
      if (r.backup === this.me) others.forEach((id) => out.add(id));
    }
    return out;
  }

  private syncLinks(): void {
    const want = this.wanted();
    for (const [id, link] of this.links) if (!want.has(id)) link.close();
    for (const id of want) {
      if (this.links.has(id)) continue;
      if (this.me < id) this.makeLink(id, true);
      else this.signal.send({ t: 'signal', to: id, data: { k: 'want' } satisfies LinkSignal });
    }
  }

  private makeLink(peer: string, offerer: boolean): PeerLink {
    const link = new PeerLink(peer, offerer, this.signal.ice, (data) => this.signal.send({ t: 'signal', to: peer, data }));
    this.links.set(peer, link);
    link.onOpen = () => {
      link.ping();
      this.onChange?.();
    };
    link.onClose = () => {
      if (this.links.get(peer) === link) this.links.delete(peer);
      this.onChange?.();
    };
    return link;
  }

  private async onSignal(from: string, data: LinkSignal): Promise<void> {
    if (!this.room?.members.some((m) => m.id === from)) return;
    let link = this.links.get(from);
    if (data.k === 'want') {
      if (!link && this.me < from) this.makeLink(from, true);
      return;
    }
    if (!link) {
      if (data.k !== 'offer' || this.me < from) return;
      link = this.makeLink(from, false);
    } else if (data.k === 'offer' && link.offerer === false && link.pc.remoteDescription) {
      // The peer started over (reload): replace the old link.
      link.onClose = null;
      link.close();
      link = this.makeLink(from, false);
    }
    await link.handleSignal(data);
  }

  private tick(): void {
    for (const link of this.links.values()) if (link.isOpen) link.ping();
    const r = this.room;
    if (r?.state === 'playing' && r.host && r.host !== this.me && !this.hostLostSent) {
      const link = this.links.get(r.host);
      if (link?.isOpen && performance.now() - link.lastHeard > HOST_SILENT_MS) {
        this.hostLostSent = true;
        this.signal.send({ t: 'hostLost' });
      }
    }
    this.onChange?.();
  }

  /** Sends the waiting-room measurements when they changed noticeably. */
  private report(): void {
    if (!this.room) return;
    const links: Report['links'] = {};
    for (const [id, link] of this.links) {
      if (!link.isOpen || link.rtt < 0) continue;
      void link.refreshRoute();
      links[id] = { rtt: Math.round(link.rtt), relayed: link.relayed };
    }
    const report: Report = { device: this.device, benchMs: this.bench, onBattery: this.battery, links };
    // Round trips to 10 ms so jitter doesn't resend every time.
    const key = JSON.stringify({ ...report, links: Object.entries(links).map(([id, l]) => [id, Math.round(l.rtt / 10), l.relayed]) });
    if (key === this.lastReport) return;
    this.lastReport = key;
    this.signal.send({ t: 'report', report });
  }

  private closeLinks(): void {
    for (const link of [...this.links.values()]) link.close();
    this.links.clear();
  }

  leave(): void {
    if (this.room) this.signal.send({ t: 'leave' });
  }

  dispose(): void {
    this.offs.forEach((off) => off());
    this.timers.forEach((t) => clearInterval(t));
    this.closeLinks();
  }
}
