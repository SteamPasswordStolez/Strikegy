import './styles.css';
import type { Game } from '@/core/Game';
import { Lobby } from '@/ui/Lobby';

const container = document.getElementById('app')!;
const loadGame = () => import('@/core/Game');
// No map in the address: the lobby. It hands over the match's address, which
// goes into the history (reload = the same match, back = the lobby) and the
// game starts in this page (its code was fetched while the room counted down).
// The menu stays up until the game's loading screen covers it.
if (!new URLSearchParams(location.search).has('map')) {
  const menu: Lobby = new Lobby(
    container,
    (query) => {
      history.pushState(null, '', query);
      window.addEventListener('popstate', () => location.reload());
      void startGame(new URLSearchParams(query), () => menu.root.remove());
    },
    () => void loadGame(),
  );
} else void startGame(new URLSearchParams(location.search));

async function startGame(params: URLSearchParams, onLoadingShown?: () => void): Promise<void> {
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
    sandbox: !bots || params.has('sandbox'),
    viewModels: ['bolt_action_rifle_7_62', 'service_pistol'],
    bots,
    mode,
    tickets,
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
