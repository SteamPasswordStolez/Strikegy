import './styles.css';
import type { Game } from '@/core/Game';
import type { NetOptions } from '@/net/NetMatch';
import { Lobby } from '@/ui/Lobby';
import { forgetPlay, recallMatch, rememberMatch, rememberRoom } from '@/core/session';
import { loadSettings } from '@/core/Settings';
import { music } from '@/audio/music';
import { currentProfile } from '@/net/account';
import { levelOf } from '@/progression/levels';
import { MARSHAL_MUSIC_LEVEL } from '@/progression/unlocks';

/** The menu's track: the marshal's from level 1000 on (unless the setting says the usual one). */
const menuTrack = () => (levelOf(currentProfile().xp).level >= MARSHAL_MUSIC_LEVEL && loadSettings().marshalMusic ? 'marshal' : 'menu');
import { MAPS } from '@/data/maps';
import { watchInstall } from '@/ui/install';

const container = document.getElementById('app')!;
// The browser's "install app" event comes early: catch it before the menu is up.
watchInstall();
const fetchGame = () => import('@/core/Game');
// A tab opened before a new deploy asks for the old build's game chunk, which is gone (Pages
// keeps the page cached for 10 min, the new build has new chunk names): reload once to get
// the new page. The match the player picked is kept in the tab (core/session.ts), so the
// reload goes straight into it. Once in 30 s, so a real outage doesn't loop.
const STALE_KEY = 'strikegy.staleReload';
function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(STALE_KEY)) || 0;
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(STALE_KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}
const loadGame = () =>
  fetchGame().catch((err: unknown) => {
    if (reloadForNewBuild()) return new Promise<never>(() => {});
    throw err;
  });
// No map in the address: the lobby, or the solo match this tab was playing
// (a reload or "again"). The address stays the site's own: the match's
// settings are kept in the tab (core/session.ts), a history entry with the
// same address makes "back" return to the menu. The game starts in this page
// (its code was fetched while the menu was up); the menu stays until the
// game's loading screen covers it. ?map=... still starts a match directly (links, testing).
const replay = recallMatch();
const devShowcase = import.meta.env.DEV ? new URLSearchParams(location.search).get('showcase') : null;
if (devShowcase) recordingShowcase(devShowcase);
else if (new URLSearchParams(location.search).has('map')) void startGame(new URLSearchParams(location.search));
else if (replay) startSolo(replay);
else {
  const menu: Lobby = new Lobby(
    container,
    (query) => {
      stopShowcase();
      rememberMatch(query);
      startSolo(query, () => menu.root.remove());
    },
    // Prefetch while the setup is open: a failure waits for the start press (which reloads).
    () => void fetchGame().catch(() => {}),
    // A room's match on the game server: a reload comes back to the
    // multiplayer pages, where the server puts this browser back in its seat.
    (start, link) => {
      stopShowcase();
      rememberRoom();
      void startGame(new URLSearchParams({ map: start.map, mode: start.mode, bots: 'none', ...(start.simple ? { simple: '1' } : {}) }), () => menu.root.remove(), { link, start });
    },
    (key) => {
      const s = loadSettings();
      if (key === 'musicVolume' || key === 'masterVolume') music.setVolume(s.musicVolume, s.masterVolume);
      if (key === 'marshalMusic') void music.play(menuTrack());
      // The menu was laid out for the other kind of controls: again for this one.
      if (key === 'inputMode') location.reload();
      if (key !== 'menuScene') return;
      if (s.menuScene) startShowcase();
      else stopShowcase();
    },
  );
  // The menu paints first; the scene behind it starts after.
  setTimeout(() => startShowcase(), 200);
  const s = loadSettings();
  music.setVolume(s.musicVolume, s.masterVolume);
  void music.play(menuTrack());
}

/**
 * The main menu's background: a looping film of the dusk battle diorama
 * (owner, 2026-10-27: the real-time scene `menu/MenuScene.ts` never showed on
 * phones and was heavy enough to stutter on computers, so it was recorded
 * frame by frame and looped; docs/menu-film.md). Phones too, unless the
 * browser asks to save data; off in the settings (화면 → 메뉴 배경 전투).
 */
const FILM = `${import.meta.env.BASE_URL}menu/scene.mp4`;
let showcase: HTMLDivElement | null = null;

function startShowcase(): void {
  if (showcase || !loadSettings().menuScene) return;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const host = document.createElement('div');
  host.className = 'showcase';
  const video = document.createElement('video');
  video.src = FILM;
  video.poster = `${import.meta.env.BASE_URL}menu/scene.jpg`;
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  video.addEventListener('playing', () => host.classList.add('ready'), { once: true });
  video.addEventListener('error', () => host.remove(), { once: true });
  host.appendChild(video);
  container.prepend(host);
  showcase = host;
  void video.play().catch(() => {});
}

function stopShowcase(): void {
  const s = showcase;
  if (!s) return;
  showcase = null;
  const v = s.querySelector('video');
  v?.pause();
  v?.removeAttribute('src');
  v?.load();
  s.remove();
}

/**
 * Dev only: the menu film's source, a bot match on `map` with the showcase
 * camera, full screen; `window.__showcase` is the game, for recording it frame
 * by frame (docs/menu-film.md).
 */
function recordingShowcase(map: string): void {
  const host = document.createElement('div');
  host.className = 'showcase ready';
  container.prepend(host);
  const n = Math.min(10, MAPS.find((m) => m.id === map)?.team ?? 8);
  void loadGame()
    .then(({ Game }) =>
      Game.create(host, {
        mapUrl: `${import.meta.env.BASE_URL}maps/${encodeURIComponent(map)}.json`,
        loadout: ['ar1'],
        bots: { allies: n, enemies: n, difficulty: 'normal', plain: null },
        mode: 'auto',
        showcase: true,
      }),
    )
    .then((game) => ((window as unknown as { __showcase: Game }).__showcase = game));
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
  // The loading screen's music (the menu's goes on if there is none); the game fades it out on the field.
  const s = loadSettings();
  music.setVolume(s.musicVolume, s.masterVolume);
  void music.play('loading');
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
  // ?mode=zone|frontline|conquest|hardpoint|tdm|killconfirm|ffa|gungame|rush|snd|escort|fortress|lastman|skirmish (default: the map's own mode on maps with zones); ?tickets=300
  const mode =
    (['zone', 'frontline', 'conquest', 'hardpoint', 'tdm', 'killconfirm', 'ffa', 'gungame', 'rush', 'snd', 'escort', 'fortress', 'lastman', 'skirmish', 'fleet'] as const).find(
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
    // ?simple=1: the simplified controls (a room setting on the game server).
    simple: params.get('simple') === '1',
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
