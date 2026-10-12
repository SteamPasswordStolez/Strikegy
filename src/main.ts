import './styles.css';
import type { Game } from '@/core/Game';
import type { NetOptions } from '@/net/NetMatch';
import { Lobby } from '@/ui/Lobby';
import { forgetPlay, recallMatch, rememberMatch, rememberRoom } from '@/core/session';
import { isTouchDevice, loadSettings } from '@/core/Settings';
import { MAPS } from '@/data/maps';

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
      stopShowcase();
      rememberMatch(query);
      startSolo(query, () => menu.root.remove());
    },
    () => void loadGame(),
    // A room's match on the game server: a reload comes back to the
    // multiplayer pages, where the server puts this browser back in its seat.
    (start, link) => {
      stopShowcase();
      rememberRoom();
      void startGame(new URLSearchParams({ map: start.map, mode: start.mode, bots: 'none' }), () => menu.root.remove(), { link, start });
    },
    (key) => {
      if (key !== 'menuScene') return;
      if (loadSettings().menuScene) startShowcase(menu.backdropMap);
      else stopShowcase();
    },
  );
  // The menu paints first; the battle behind it loads after.
  setTimeout(() => startShowcase(menu.backdropMap), 400);
}

/**
 * The main menu's background: a bot match on the last picked map, the camera
 * drifting over the fighting (Game's `showcase`). Desktop only, and only while
 * the menu is up: it is thrown away before a match loads.
 */
let showcase: { host: HTMLDivElement; game: Promise<Game | null> } | null = null;

function startShowcase(map: string): void {
  if (showcase || isTouchDevice() || !loadSettings().menuScene) return;
  const host = document.createElement('div');
  host.className = 'showcase';
  container.prepend(host);
  const n = Math.min(10, MAPS.find((m) => m.id === map)?.team ?? 8);
  const entry = { host, game: Promise.resolve<Game | null>(null) };
  entry.game = loadGame()
    .then(({ Game }) =>
      Game.create(host, {
        mapUrl: `${import.meta.env.BASE_URL}maps/${encodeURIComponent(map)}.json`,
        loadout: ['ar1'],
        bots: { allies: n, enemies: n, difficulty: 'normal', plain: null },
        mode: 'auto',
        showcase: true,
      }),
    )
    .then((game) => {
      // Left the menu while it loaded.
      if (showcase !== entry) {
        game.dispose();
        return null;
      }
      host.classList.add('ready');
      return game;
    })
    .catch((err: unknown) => {
      console.warn('menu background:', err);
      host.remove();
      return null;
    });
  showcase = entry;
}

function stopShowcase(): void {
  const s = showcase;
  if (!s) return;
  showcase = null;
  s.host.remove();
  void s.game.then((g) => g?.dispose());
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
  // ?mode=zone|frontline|conquest|hardpoint|tdm|killconfirm|ffa|gungame|skirmish (default: the map's own mode on maps with zones); ?tickets=300
  const mode =
    (['zone', 'frontline', 'conquest', 'hardpoint', 'tdm', 'killconfirm', 'ffa', 'gungame', 'skirmish'] as const).find(
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
    // ?tutorial: the menu's tutorial (the basics step by step on the range).
    tutorial: params.has('tutorial'),
    // ?side=red: the player's side in a solo match (blue without it).
    team: params.get('side') === 'red' ? 'red' : 'blue',
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
