import './styles.css';
import type { Game } from '@/core/Game';
import type { NetOptions } from '@/net/NetMatch';
import { Lobby } from '@/ui/Lobby';
import { forgetPlay, recallMatch, rememberMatch, rememberRoom } from '@/core/session';

const container = document.getElementById('app')!;
const loadGame = () => import('@/core/Game');
// No map in the address: the lobby, or the solo match this tab was playing
// (a reload or "again"). The address stays the site's own: the match's
// settings are kept in the tab (core/session.ts), a history entry with the
// same address makes "back" return to the menu. The game starts in this page
// (its code was fetched while the menu was up); the menu stays until the
// game's loading screen covers it. ?map=... still starts a match directly (links, testing).
const replay = recallMatch();
if (new URLSearchParams(location.search).has('map')) void startGame(new URLSearchParams(location.search));
else if (replay) startSolo(replay);
else {
  const menu: Lobby = new Lobby(
    container,
    (query) => {
      rememberMatch(query);
      startSolo(query, () => menu.root.remove());
    },
    () => void loadGame(),
    // A room's match on the game server: a reload comes back to the
    // multiplayer pages, where the server puts this browser back in its seat.
    (start, link) => {
      rememberRoom();
      void startGame(new URLSearchParams({ map: start.map, mode: start.mode, bots: 'none' }), () => menu.root.remove(), { link, start });
    },
  );
}

/** A solo match; "back" in the browser returns to the menu. */
function startSolo(query: string, onLoadingShown?: () => void): void {
  history.pushState({ match: true }, '', location.pathname);
  window.addEventListener('popstate', () => {
    forgetPlay();
    location.reload();
  });
  void startGame(new URLSearchParams(query), onLoadingShown);
}

async function startGame(params: URLSearchParams, onLoadingShown?: () => void, net?: NetOptions): Promise<void> {
  const mapId = params.get('map') ?? 'sandbox';
  const mapUrl = `${import.meta.env.BASE_URL}maps/${encodeURIComponent(mapId)}.json`;

  // ?bots=4v5 (allies v enemies), ?bots=0 for the practice range; ?difficulty=easy|normal|hard
  const botsParam = params.get('bots') ?? '4v5';
  const botMatch = /^(\d+)v(\d+)$/.exec(botsParam);
  const difficulty =
    (['easy', 'normal', 'hard'] as const).find((d) => d === params.get('difficulty')) ?? 'normal';
  // ?plain=red|blue|both: that side's bots play the older, plainer way (for comparing the two).
  const plain = (['blue', 'red', 'both'] as const).find((t) => t === params.get('plain')) ?? null;
  const bots = botMatch
    ? { allies: Number(botMatch[1]), enemies: Number(botMatch[2]), difficulty, plain }
    : null;
  // ?mode=zone|frontline|conquest|skirmish (default: the map's own mode on maps with zones); ?tickets=300
  const mode =
    (['zone', 'frontline', 'conquest', 'skirmish'] as const).find(
      (m) => m === params.get('mode'),
    ) ?? 'auto';
  const tickets = Number(params.get('tickets')) || undefined;

  // The game itself loads only now: the lobby stays light (no three.js / physics yet).
  const { Game } = await loadGame();
  const created = Game.create(container, {
    mapUrl,
    // Sandbox loadout: every weapon class for feel testing (1-9 / mouse wheel). The
    // practice range (?bots=0) and ?sandbox use it; bot matches use the class picked on the deploy screen.
    loadout: ['ar1', 'smg1', 'lmg1', 'sg1', 'dmr1', 'sr1', 'pistol1', 'ar4', 'sg3'],
    sandbox: !net && (!bots || params.has('sandbox')),
    viewModels: ['bolt_action_rifle_7_62', 'service_pistol'],
    bots,
    mode,
    tickets,
    net,
  });
  // Game.create puts its loading screen up before its first await.
  onLoadingShown?.();
  void created
    .then((game) => {
      // Dev builds, and builds made for automated sims (VITE_SIM=1), expose the game for scripts.
      if (import.meta.env.DEV || import.meta.env.VITE_SIM) {
        (window as unknown as { __strikegy: Game }).__strikegy = game;
      }
    })
    .catch((err: unknown) => console.error(err));
}
