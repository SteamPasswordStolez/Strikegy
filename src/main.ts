import './styles.css';
import { Game } from '@/core/Game';

const container = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const mapId = params.get('map') ?? 'sandbox';
const mapUrl = `${import.meta.env.BASE_URL}maps/${encodeURIComponent(mapId)}.json`;

Game.create(container, {
  mapUrl,
  // Sandbox loadout: every weapon class for feel testing (1-9 / Q / mouse wheel).
  loadout: ['ar1', 'smg1', 'lmg1', 'sg1', 'dmr1', 'sr1', 'pistol1', 'ar3', 'dmr2'],
  viewModels: ['bolt_action_rifle_7_62', 'service_pistol'],
})
  .then((game) => {
    if (import.meta.env.DEV) {
      (window as unknown as { __strikegy: Game }).__strikegy = game;
    }
  })
  .catch((err: unknown) => console.error(err));
