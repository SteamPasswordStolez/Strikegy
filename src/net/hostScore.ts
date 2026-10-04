/**
 * Picking the PC that runs a match. Each member measures in the waiting room
 * (round trips to the candidates, whether a link needs TURN, a short sim
 * benchmark, battery) and reports it; the signalling server runs this to
 * name the host and a backup. Lower score = better host. Shared with the Node
 * server: no imports, erasable TypeScript only.
 */
import type { Member, Report } from './signalProtocol';

/** How many desktops everyone opens test links to. */
export const CANDIDATES = 4;

export const HOST_SCORE = {
  /** Round trip assumed to a member nobody measured against. */
  unknownRtt: 150,
  /** Weight of the slowest member's round trip (they suffer most). */
  worst: 1,
  /** Weight of the average round trip. */
  mean: 0.5,
  /** Added per member reached only through TURN. */
  relayed: 40,
  /** Points per benchmark millisecond. */
  bench: 2,
  /** Benchmark assumed when a member didn't run it. */
  unknownBench: 40,
  onBattery: 60,
  /** Over this share of links through TURN, the PC can't host (everything would be relayed). */
  maxRelayedShare: 0.5,
} as const;

function linkBetween(reports: ReadonlyMap<string, Report>, a: string, b: string): { rtt: number; relayed: boolean } | null {
  return reports.get(a)?.links[b] ?? reports.get(b)?.links[a] ?? null;
}

/** Score of one member as host, or null when it can't host. */
export function hostScore(id: string, members: readonly Member[], reports: ReadonlyMap<string, Report>): number | null {
  const self = members.find((m) => m.id === id);
  const report = reports.get(id);
  if (!self || self.device !== 'desktop' || report?.device === 'mobile') return null;
  const others = members.filter((m) => m.id !== id);
  let worst = 0;
  let sum = 0;
  let relayed = 0;
  for (const m of others) {
    const link = linkBetween(reports, id, m.id);
    const rtt = link?.rtt ?? HOST_SCORE.unknownRtt;
    worst = Math.max(worst, rtt);
    sum += rtt;
    if (link?.relayed) relayed++;
  }
  if (others.length > 0 && relayed / others.length > HOST_SCORE.maxRelayedShare) return null;
  const mean = others.length ? sum / others.length : 0;
  return (
    worst * HOST_SCORE.worst +
    mean * HOST_SCORE.mean +
    relayed * HOST_SCORE.relayed +
    (report?.benchMs ?? HOST_SCORE.unknownBench) * HOST_SCORE.bench +
    (report?.onBattery ? HOST_SCORE.onBattery : 0)
  );
}

/**
 * Host and backup for a room. When no desktop can host (phones only, or
 * every desktop behind TURN), the best-placed member hosts anyway rather
 * than nobody: a slow match beats none.
 */
export function pickHost(members: readonly Member[], reports: ReadonlyMap<string, Report>, owner: string): { host: string | null; backup: string | null } {
  if (!members.length) return { host: null, backup: null };
  const scored = members
    .map((m) => ({ id: m.id, score: hostScore(m.id, members, reports) }))
    .filter((s): s is { id: string; score: number } => s.score !== null)
    // Ties go to the owner, then to who joined first (members are in join order).
    .sort((a, b) => a.score - b.score || Number(b.id === owner) - Number(a.id === owner));
  if (!scored.length) {
    const fallback = members.find((m) => m.device === 'desktop') ?? members.find((m) => m.id === owner) ?? members[0]!;
    const backup = members.find((m) => m.id !== fallback.id && m.device === 'desktop') ?? null;
    return { host: fallback.id, backup: backup?.id ?? null };
  }
  return { host: scored[0]!.id, backup: scored[1]?.id ?? null };
}

/**
 * Desktops worth test links before anyone measured round trips: by benchmark,
 * mains power first, the owner on ties. Everyone links to these few rather
 * than to everyone (that would be n² links).
 */
export function pickCandidates(members: readonly Member[], reports: ReadonlyMap<string, Report>, owner: string): string[] {
  return members
    .filter((m) => m.device === 'desktop' && reports.get(m.id)?.device !== 'mobile')
    .map((m) => {
      const r = reports.get(m.id);
      return { id: m.id, key: (r?.benchMs ?? HOST_SCORE.unknownBench) * HOST_SCORE.bench + (r?.onBattery ? HOST_SCORE.onBattery : 0) };
    })
    .sort((a, b) => a.key - b.key || Number(b.id === owner) - Number(a.id === owner))
    .slice(0, CANDIDATES)
    .map((c) => c.id);
}
