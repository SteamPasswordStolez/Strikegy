import './styles.css';
import { Game } from '@/core/Game';

const container = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const mapId = params.get('map') ?? 'sandbox';
const mapUrl = `${import.meta.env.BASE_URL}maps/${encodeURIComponent(mapId)}.json`;

// ?bots=4v5 (allies v enemies), ?bots=0 for the practice range; ?difficulty=easy|normal|hard
const botsParam = params.get('bots') ?? '4v5';
const botMatch = /^(\d+)v(\d+)$/.exec(botsParam);
const difficulty = (['easy', 'normal', 'hard'] as const).find((d) => d === params.get('difficulty')) ?? 'normal';
const bots = botMatch ? { allies: Number(botMatch[1]), enemies: Number(botMatch[2]), difficulty } : null;
// ?mode=zone|skirmish (default: Zone on maps with zones); ?tickets=200
const mode = (['zone', 'skirmish'] as const).find((m) => m === params.get('mode')) ?? 'auto';
const tickets = Number(params.get('tickets')) || undefined;

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
