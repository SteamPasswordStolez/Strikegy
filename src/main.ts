import './styles.css';
import type { Game } from '@/core/Game';
import { Lobby } from '@/ui/Lobby';

const container = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
// No map in the address: the lobby (it starts a match by loading the address for it).
if (!params.has('map')) new Lobby(container);
else void startGame();

async function startGame(): Promise<void> {
  const mapId = params.get('map') ?? 'sandbox';
  const mapUrl = `${import.meta.env.BASE_URL}maps/${encodeURIComponent(mapId)}.json`;

  // ?bots=4v5 (allies v enemies), ?bots=0 for the practice range; ?difficulty=easy|normal|hard
  const botsParam = params.get('bots') ?? '4v5';
  const botMatch = /^(\d+)v(\d+)$/.exec(botsParam);
  const difficulty =
    (['easy', 'normal', 'hard'] as const).find((d) => d === params.get('difficulty')) ?? 'normal';
  const bots = botMatch
    ? { allies: Number(botMatch[1]), enemies: Number(botMatch[2]), difficulty }
    : null;
  // ?mode=zone|frontline|conquest|skirmish (default: the map's own mode on maps with zones); ?tickets=300
  const mode =
    (['zone', 'frontline', 'conquest', 'skirmish'] as const).find(
      (m) => m === params.get('mode'),
    ) ?? 'auto';
  const tickets = Number(params.get('tickets')) || undefined;

  // The game itself loads only now: the lobby stays light (no three.js / physics yet).
  const { Game } = await import('@/core/Game');
  Game.create(container, {
    mapUrl,
    // Sandbox loadout: every weapon class for feel testing (1-9 / mouse wheel). The
    // practice range (?bots=0) and ?sandbox use it; bot matches use the class picked on the deploy screen.
    loadout: ['ar1', 'smg1', 'lmg1', 'sg1', 'dmr1', 'sr1', 'pistol1', 'ar4', 'sg3'],
    sandbox: !bots || params.has('sandbox'),
    viewModels: ['bolt_action_rifle_7_62', 'service_pistol'],
    bots,
    mode,
    tickets,
  })
    .then((game) => {
      if (import.meta.env.DEV) {
        (window as unknown as { __strikegy: Game }).__strikegy = game;
      }
    })
    .catch((err: unknown) => console.error(err));
}
