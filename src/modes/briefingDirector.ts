import type { Team } from '@/world/mapTypes';
import type { GameBus } from '@/core/events';
import { t } from '@/i18n';
import type { Briefing } from '@/audio/briefing/Briefing';
import { CUES, type CueId } from '@/audio/briefing/cues';
import type { CritTone } from '@/ui/CriticalStrip';
import type { ZoneMode } from './ZoneMode';
import {
  ConquestRules,
  EscortRules,
  FortressRules,
  FreeForAllRules,
  FrontlineRules,
  GunGameRules,
  HardpointRules,
  LastStandRules,
  PointsRules,
  RushRules,
  SearchDestroyRules,
  SND,
  SoloRules,
  type ModeEvent,
} from './matchRules';

/** What the director needs from the game. */
export interface BriefingHost {
  readonly myTeam: Team;
  readonly myId: number;
  /** The player is out of the last-soldier circle (and alive on the field). */
  outsideCircle(): boolean;
  /** The player is alive on the field. */
  onField(): boolean;
}

const other = (team: Team): Team => (team === 'blue' ? 'red' : 'blue');

/**
 * The battle briefing's triggers (docs/design/battle-briefing.md §3): turns
 * the game's events (zone captures, the mode's events, the end) and a look at
 * the match's state once a second (score lead, near the target, tickets, the
 * attack timer, zones held, the payload, the hardpoint, the last-soldier
 * circle) into cues, from the player's side of things. Works the same on a
 * multiplayer client: the server's events come through the same bus.
 */
export class BriefingDirector {
  private readonly offs: (() => void)[] = [];
  private since = 0;
  private clock = 0;
  /** One-shot cues already said this match (near, tickets...). */
  private readonly once = new Set<string>();
  /** Score lead: who is ahead, since when it has been so, and what was last said. */
  private lead: { side: 'us' | 'them' | 'even'; since: number; said: 'us' | 'them' | 'even' } = { side: 'even', since: 0, said: 'even' };
  private readonly ticketPeak: Record<Team, number> = { blue: 0, red: 0 };
  private allState: 'us' | 'them' | 'mixed' = 'mixed';
  private payload = { moving: false, since: 0, said: false as boolean };
  private timerSaid = false;
  private hillSoonFor = -1;
  private soloLead = false;
  private lastAliveRound = -1;

  constructor(
    private readonly brief: Briefing,
    private readonly zm: ZoneMode,
    private readonly host: BriefingHost,
    bus: GameBus,
  ) {
    const ours = (team: Team) => team === host.myTeam;
    this.offs.push(
      bus.on('zone:captured', (e) => {
        if (this.solo) return;
        if (ours(e.team)) this.say('zone.taken', 'good', { zone: e.zone });
        else this.say('zone.lost', 'bad', { zone: e.zone });
      }),
      bus.on('zone:neutralized', (e) => {
        // `team` lost it: ours going neutral is a loss; theirs going neutral waits for our capture.
        if (!this.solo && ours(e.team)) this.say('zone.lost', 'bad', { zone: e.zone });
      }),
      bus.on('mode:event', (e) => this.onModeEvent(e)),
    );
    brief.preload((Object.keys(CUES) as CueId[]).filter((c) => (CUES[c].speaker === 'announcer') === this.solo));
  }

  dispose(): void {
    for (const off of this.offs) off();
  }

  private get solo(): boolean {
    return this.zm.match instanceof SoloRules;
  }

  private say(cue: CueId, tone: CritTone, opts: { zone?: string; detail?: string } = {}): void {
    this.brief.say(cue, tone, opts);
  }

  /** The opening line, once the match is on. */
  start(): void {
    const m = this.zm.match;
    const us = this.host.myTeam;
    if (m instanceof SoloRules) this.say('ffa.start', 'neutral');
    else if (m instanceof EscortRules) this.say(m.attacker === us ? 'start.escortAttack' : 'start.escortDefend', m.attacker === us ? 'good' : 'bad');
    else if (m instanceof ConquestRules || m instanceof RushRules) this.say(m.attacker === us ? 'start.attack' : 'start.defend', m.attacker === us ? 'good' : 'bad');
    else if (m instanceof SearchDestroyRules) this.say(m.attacker === us ? 'round.attack' : 'round.defend', 'neutral', { detail: t('snd.round').replace('{n}', String(m.round)) });
    else if (m instanceof FortressRules) this.say('start.fortress', 'neutral');
    else if (this.zm.kind === 'tdm') this.say('start.tdm', 'neutral');
    else if (this.zm.kind === 'killconfirm') this.say('start.killconfirm', 'neutral');
    else this.say('start.zone', 'neutral');
  }

  /** The closing line. */
  end(won: boolean): void {
    if (this.solo) this.brief.closing(won ? 'ffa.win' : 'ffa.lose', won ? 'good' : 'neutral');
    else this.brief.closing(won ? 'end.win' : 'end.lose', won ? 'good' : 'bad');
  }

  private onModeEvent(e: ModeEvent): void {
    const m = this.zm.match;
    const us = this.host.myTeam;
    const ours = (team: Team) => team === us;
    switch (e.type) {
      case 'attack':
        this.timerSaid = false;
        if (m instanceof FrontlineRules) {
          const weAttack = ours(e.attacker);
          if (e.reason === 'held') this.say(weAttack ? 'attack.heldUs' : 'attack.heldThem', weAttack ? 'good' : 'bad');
          else this.say(weAttack ? 'sector.lost' : 'sector.won', weAttack ? 'bad' : 'good');
          // The attackers' last sector toward the other end.
          const last = e.attacker === 'blue' ? m.sectors.length - 1 : 0;
          if (m.active === last) this.say(weAttack ? 'final.attack' : 'final.defend', weAttack ? 'good' : 'bad');
        }
        return;
      case 'sector':
        if (m instanceof ConquestRules || m instanceof RushRules) {
          const detail = t('mode.sector').replace('{n}', String(e.sector + 1)).replace('{total}', String(m.sectors.length));
          this.say(ours(e.team) ? 'breakthrough' : 'breached', ours(e.team) ? 'good' : 'bad', { detail });
          if (m.active === m.sectors.length - 1) this.say(ours(m.attacker) ? 'final.attack' : 'final.defend', ours(m.attacker) ? 'good' : 'bad');
        }
        return;
      case 'charge': {
        const we = ours(e.team);
        const cue: CueId =
          e.state === 'armed' ? (we ? 'charge.armedUs' : 'charge.armedThem') : e.state === 'defused' ? (we ? 'charge.defusedUs' : 'charge.defusedThem') : we ? 'charge.blownUs' : 'charge.blownThem';
        this.say(cue, we ? 'good' : 'bad', { detail: `${t('charge.name')} ${e.id}` });
        return;
      }
      case 'round': {
        this.brief.reset();
        const detail = t('snd.round').replace('{n}', String(e.n));
        this.say(ours(e.attacker) ? 'round.attack' : 'round.defend', 'neutral', { detail });
        if (m instanceof SearchDestroyRules && (m.wins.blue === SND.win - 1 || m.wins.red === SND.win - 1)) this.say('round.match', 'neutral');
        return;
      }
      case 'roundEnd':
        this.say(ours(e.winner) ? 'round.won' : 'round.lost', ours(e.winner) ? 'good' : 'bad', { detail: t(`snd.why.${e.why}` as Parameters<typeof t>[0]) });
        return;
      case 'hill':
        this.say('hill', 'neutral', { zone: e.zone });
        return;
      case 'checkpoint':
        if (m instanceof EscortRules) this.say(ours(m.attacker) ? 'checkpoint.us' : 'checkpoint.them', ours(m.attacker) ? 'good' : 'bad', { detail: e.zone });
        return;
      case 'built':
        this.say('fortress.built', 'neutral');
        return;
      case 'shrink':
        this.say('lastman.shrink', 'bad');
        return;
      case 'level':
        if (e.id !== this.host.myId || !(m instanceof GunGameRules)) return;
        if (!e.up) this.say('gungame.demoted', 'bad');
        else if (e.level === m.target - 1) this.say('gungame.last', 'good');
        return;
      default:
        return;
    }
  }

  /** Per frame; looks at the match's state once a second. */
  update(dt: number): void {
    this.clock += dt;
    this.since += dt;
    if (this.since < 1) return;
    this.since = 0;
    const m = this.zm.match;
    if (m.ended) return;
    const us = this.host.myTeam;
    const them = other(us);

    if (m instanceof SoloRules) {
      const list = m.standings();
      const mine = m.scoreOf(this.host.myId);
      const best = list.find((s) => s.id !== this.host.myId)?.n ?? 0;
      if (m instanceof FreeForAllRules) {
        const leading = mine > 0 && mine > best;
        if (leading !== this.soloLead && this.clock > 20) this.say(leading ? 'ffa.lead' : 'ffa.leadLost', leading ? 'good' : 'bad');
        this.soloLead = leading;
        if (mine >= m.target * 0.9) this.onceSay('ffa.near', 'good');
      }
      if (m instanceof LastStandRules) {
        if (this.host.outsideCircle()) this.say('lastman.storm', 'bad');
        if (m.aliveCount > 1 && m.aliveCount <= 3) this.onceSay('lastman.few', 'neutral');
      }
      return;
    }

    // Zones held: all ours / all theirs (zones in play only).
    const zones = this.zm.zones.filter((z) => !z.hidden && !z.noCapture);
    if (zones.length >= 2) {
      const state = zones.every((z) => z.owner === us) ? 'us' : zones.every((z) => z.owner === them) ? 'them' : 'mixed';
      if (state !== this.allState && state !== 'mixed') this.say(state === 'us' ? 'zones.allOurs' : 'zones.allTheirs', state === 'us' ? 'good' : 'bad');
      this.allState = state;
      const hit = zones.find((z) => z.owner === us && z.pushing === them && !z.locked);
      if (hit) this.say('zone.attacked', 'bad', { zone: hit.id });
    }

    // The score: lead changes held for 5 s, and the last stretch.
    if (m instanceof PointsRules && !(m instanceof FortressRules && m.points.blue + m.points.red === 0)) {
      const d = m.points[us] - m.points[them];
      const margin = Math.max(1, m.target * 0.03);
      const side = d >= margin ? 'us' : -d >= margin ? 'them' : 'even';
      if (side !== this.lead.side) this.lead = { side, since: this.clock, said: this.lead.said };
      if (side !== 'even' && side !== this.lead.said && this.clock - this.lead.since >= 5 && this.clock > 30) {
        this.say(side === 'us' ? 'lead.gained' : 'lead.lost', side === 'us' ? 'good' : 'bad');
        this.lead.said = side;
      }
      if (m.points[us] >= m.target * 0.9) this.onceSay('win.near', 'good');
      if (m.points[them] >= m.target * 0.9) this.onceSay('lose.near', 'bad');
    }

    // Tickets: against the most each side has had.
    for (const team of [us, them]) {
      const n = m.tickets[team];
      if (n === null) continue;
      this.ticketPeak[team] = Math.max(this.ticketPeak[team], n);
      const peak = this.ticketPeak[team];
      if (peak < 20) continue;
      if (team === us) {
        if (n <= peak * 0.1) this.onceSay('tickets.last', 'bad');
        else if (n <= peak * 0.25) this.onceSay('tickets.low', 'bad');
      } else if (n <= peak * 0.25) this.onceSay('tickets.enemyLow', 'good');
    }

    // Frontline: the attack's last half minute.
    if (m instanceof FrontlineRules && m.attacker && !this.timerSaid && m.timeLeft <= 30 && m.timeLeft > 0) {
      this.timerSaid = true;
      this.say(m.attacker === us ? 'timer.lowAttack' : 'timer.lowDefend', m.attacker === us ? 'bad' : 'good');
    }

    // Hardpoint: about to move.
    if (m instanceof HardpointRules) {
      if (m.moveIn <= 10 && this.hillSoonFor !== m.active) {
        this.hillSoonFor = m.active;
        this.say('hill.soon', 'neutral');
      }
    }

    // Escort: the payload starting or stopping (held for 2 s).
    if (m instanceof EscortRules) {
      if (m.moving !== this.payload.moving) this.payload = { moving: m.moving, since: this.clock, said: false };
      if (!this.payload.said && this.clock - this.payload.since >= 2 && this.clock > 15) {
        this.payload.said = true;
        const attack = m.attacker === us;
        if (m.moving && attack) this.say('payload.moving', 'good');
        else if (!m.moving) this.say(attack ? 'payload.stopped' : 'payload.held', attack ? 'bad' : 'good');
      }
    }

    // Search and destroy: the last one standing.
    if (m instanceof SearchDestroyRules && m.phase === 'live' && this.lastAliveRound !== m.round && m.alive[us] === 1 && m.alive[them] > 0 && this.host.onField()) {
      this.lastAliveRound = m.round;
      this.say('lastAlive', 'neutral');
    }
  }

  private onceSay(cue: CueId, tone: CritTone): void {
    if (this.once.has(cue)) return;
    this.once.add(cue);
    this.say(cue, tone);
  }
}
