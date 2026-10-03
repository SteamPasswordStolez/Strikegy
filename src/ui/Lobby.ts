import { setLocale, t, type Locale, type MessageKey } from '@/i18n';
import { loadSettings, resolveQuality, saveSettings, type Settings } from '@/core/Settings';
import { loadJSON, saveJSON } from '@/core/storage';
import { BIG_TEAM, MAPS, RANGE_ID, TEAM_SIZES, matchQuery, snapTeam, type Difficulty, type LobbyMode, type LobbyPick } from '@/data/maps';
import type { MapDef } from '@/world/mapTypes';
import { paintMap } from './mapPainter';

const PICK_KEY = 'strikegy.lobby.v1';
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

/** Modes a map offers (Zone whenever it has zones, skirmish always). */
function modesOf(map: MapDef): LobbyMode[] {
  const out: LobbyMode[] = [];
  if ((map.zones?.length ?? 0) > 0) {
    out.push('zone');
    if (map.modes?.frontline) out.push('frontline');
    if (map.modes?.conquest) out.push('conquest');
  }
  out.push('skirmish');
  return out;
}

function outline(map: MapDef): [number, number][] {
  if (map.world.boundary?.length) return map.world.boundary;
  const [w, d] = map.world.size;
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
}

/**
 * The lobby (Modern Warfare-style menu): pick a map from the list (its picture,
 * blurb and size beside it), a mode it offers, players a side and the bots'
 * difficulty, then start, which loads the game at that address. A settings tab
 * holds the stored settings (mouse, field of view, graphics, sound, language).
 * The last pick is remembered.
 */
export class Lobby {
  readonly root: HTMLDivElement;
  private pick: LobbyPick;
  private tab: 'play' | 'settings' = 'play';
  private settings: Settings = loadSettings();
  private readonly maps = new Map<string, MapDef>();
  private readonly loading = new Set<string>();
  private autoQuality: string | null = null;
  private body!: HTMLDivElement;
  private readonly touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  constructor(private readonly container: HTMLElement) {
    setLocale(this.settings.locale);
    const saved = loadJSON<Partial<LobbyPick>>(PICK_KEY) ?? {};
    const entry = MAPS.find((m) => m.id === saved.map);
    this.pick = {
      map: saved.map === RANGE_ID || entry ? saved.map! : MAPS[0]!.id,
      mode: saved.mode ?? 'zone',
      team: snapTeam(saved.team ?? entry?.team ?? MAPS[0]!.team),
      difficulty: DIFFICULTIES.includes(saved.difficulty as Difficulty) ? saved.difficulty! : 'normal',
    };
    this.root = el('div', 'lobby', container);
    window.addEventListener('keydown', this.onKey);
    this.render();
    void this.load(this.pick.map);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Enter' && this.tab === 'play') {
      e.preventDefault();
      this.start();
    }
  };

  private save(): void {
    saveJSON(PICK_KEY, this.pick);
  }

  private start(): void {
    this.save();
    window.removeEventListener('keydown', this.onKey);
    location.search = matchQuery(this.pick);
  }

  /** Fetches a map's JSON once (for its modes, size and picture), then redraws the play tab. */
  private async load(id: string): Promise<void> {
    if (this.maps.has(id) || this.loading.has(id)) return;
    this.loading.add(id);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}maps/${encodeURIComponent(id)}.json`);
      if (!res.ok) return;
      this.maps.set(id, (await res.json()) as MapDef);
    } catch {
      return;
    } finally {
      this.loading.delete(id);
    }
    if (id === this.pick.map) this.fixMode();
    if (this.tab === 'play') this.render();
  }

  /** Keeps the mode to one the picked map offers (its own default when the old one isn't). */
  private fixMode(): void {
    const map = this.maps.get(this.pick.map);
    if (!map) return;
    const offered = modesOf(map);
    if (!offered.includes(this.pick.mode)) this.pick.mode = map.modes?.default ?? offered[0]!;
  }

  private choose(id: string): void {
    if (id === this.pick.map) return;
    this.pick.map = id;
    const entry = MAPS.find((m) => m.id === id);
    if (entry) this.pick.team = entry.team;
    const map = this.maps.get(id);
    if (map) this.pick.mode = map.modes?.default ?? 'zone';
    this.fixMode();
    this.save();
    this.render();
    void this.load(id);
  }

  private render(): void {
    this.root.replaceChildren();
    const top = el('div', 'lb-top', this.root);
    const brand = el('div', 'lb-brand', top);
    el('div', 'lb-wordmark', brand).textContent = t('title');
    el('div', 'lb-tag', brand).textContent = t('lobby.tagline');
    const tabs = el('div', 'lb-tabs', top);
    for (const id of ['play', 'settings'] as const) {
      const b = el('button', `lb-tab${this.tab === id ? ' on' : ''}`, tabs);
      b.textContent = t(`lobby.${id}`);
      b.addEventListener('click', () => {
        this.tab = id;
        this.render();
      });
    }
    this.body = el('div', `lb-body lb-${this.tab}`, this.root);
    if (this.tab === 'play') this.renderPlay();
    else this.renderSettings();
  }

  // ---------------------------------------------------------------------------
  // Play

  private renderPlay(): void {
    const list = el('div', 'lb-maps', this.body);
    el('div', 'lb-head', list).textContent = t('lobby.maps');
    for (const m of [...MAPS.map((e) => e.id), RANGE_ID]) {
      const b = el('button', `lb-map${m === this.pick.map ? ' sel' : ''}${m === RANGE_ID ? ' range' : ''}`, list);
      el('span', 'lb-map-name', b).textContent = t(`map.${m}` as MessageKey);
      const map = this.maps.get(m);
      el('span', 'lb-map-sub', b).textContent = m === RANGE_ID ? t('lobby.rangeSub') : map ? this.mapFacts(map) : '';
      b.addEventListener('click', () => this.choose(m));
      void this.load(m);
    }

    const view = el('div', 'lb-view', this.body);
    const pic = el('div', 'lb-picture', view);
    const map = this.maps.get(this.pick.map);
    if (map) pic.appendChild(this.picture(map));
    else el('div', 'lb-loading', pic).textContent = t('loading');
    const info = el('div', 'lb-info', view);
    el('div', 'lb-info-name', info).textContent = t(`map.${this.pick.map}` as MessageKey);
    el('div', 'lb-info-desc', info).textContent = t(`mapDesc.${this.pick.map}` as MessageKey);

    const opts = el('div', 'lb-options', this.body);
    const isRange = this.pick.map === RANGE_ID;
    if (!isRange) {
      el('div', 'lb-head', opts).textContent = t('lobby.mode');
      const modes = map ? modesOf(map) : [this.pick.mode];
      const seg = el('div', 'lb-seg lb-modes', opts);
      for (const m of modes) {
        const b = el('button', `lb-opt${m === this.pick.mode ? ' sel' : ''}`, seg);
        b.textContent = t(m === 'skirmish' ? 'lobby.skirmish' : (`mode.${m}` as MessageKey));
        b.addEventListener('click', () => {
          this.pick.mode = m;
          this.save();
          this.render();
        });
      }
      el('div', 'lb-note', opts).textContent = t(`modeDesc.${this.pick.mode}` as MessageKey);

      el('div', 'lb-head', opts).textContent = t('lobby.team');
      const step = el('div', 'lb-step', opts);
      const i = TEAM_SIZES.indexOf(this.pick.team as (typeof TEAM_SIZES)[number]);
      const minus = el('button', 'lb-stepbtn', step);
      minus.textContent = '−';
      minus.disabled = i <= 0;
      el('div', 'lb-stepval', step).textContent = `${this.pick.team} vs ${this.pick.team}`;
      const plus = el('button', 'lb-stepbtn', step);
      plus.textContent = '+';
      plus.disabled = i >= TEAM_SIZES.length - 1;
      const bump = (d: number) => {
        this.pick.team = TEAM_SIZES[Math.max(0, Math.min(TEAM_SIZES.length - 1, i + d))]!;
        this.save();
        this.render();
      };
      minus.addEventListener('click', () => bump(-1));
      plus.addEventListener('click', () => bump(1));
      const entry = MAPS.find((e) => e.id === this.pick.map);
      const note = el('div', `lb-note${this.pick.team >= BIG_TEAM ? ' warn' : ''}`, opts);
      note.textContent = this.pick.team >= BIG_TEAM ? t('lobby.bigTeam') : t('lobby.teamHint').replace('{n}', String(entry?.team ?? 12));

      el('div', 'lb-head', opts).textContent = t('lobby.difficulty');
      const dseg = el('div', 'lb-seg', opts);
      for (const d of DIFFICULTIES) {
        const b = el('button', `lb-opt${d === this.pick.difficulty ? ' sel' : ''}`, dseg);
        b.textContent = t(`lobby.diff.${d}` as MessageKey);
        b.addEventListener('click', () => {
          this.pick.difficulty = d;
          this.save();
          this.render();
        });
      }
    } else {
      el('div', 'lb-note', opts).textContent = t('lobby.rangeNote');
    }
    const go = el('button', 'lb-start', opts);
    el('span', 'lb-start-text', go).textContent = t(isRange ? 'lobby.startRange' : 'lobby.start');
    if (!this.touch) el('span', 'keycap', go).textContent = 'Enter';
    go.addEventListener('click', () => this.start());
  }

  /** "5 zones · 500 × 360 m". */
  private mapFacts(map: MapDef): string {
    const pts = outline(map);
    const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
    const d = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
    return `${t('lobby.zones').replace('{n}', String(map.zones?.length ?? 0))} · ${Math.round(w)} × ${Math.round(d)} m`;
  }

  /** The map from above with its zones and both bases. */
  private picture(map: MapDef): HTMLCanvasElement {
    const img = paintMap(map, { points: outline(map) }, 900);
    const g = img.canvas.getContext('2d')!;
    const zoneColor = '#f2f2ee';
    for (const z of map.zones ?? []) {
      const [u, v] = img.project(z.pos[0], z.pos[2]);
      g.beginPath();
      g.arc(u, v, z.radius * img.scale, 0, Math.PI * 2);
      g.fillStyle = 'rgba(242, 242, 238, 0.14)';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = zoneColor;
      g.stroke();
      g.font = 'bold 22px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      g.strokeText(z.id, u, v);
      g.fillStyle = zoneColor;
      g.fillText(z.id, u, v);
    }
    for (const team of ['blue', 'red'] as const) {
      const own = map.spawns.filter((s) => s.team === team || (team === 'blue' && s.team === 'player'));
      if (!own.length) continue;
      const x = own.reduce((a, s) => a + s.pos[0], 0) / own.length;
      const z = own.reduce((a, s) => a + s.pos[2], 0) / own.length;
      const [u, v] = img.project(x, z);
      const color = team === 'blue' ? '#3fb2ff' : '#f2453a';
      g.fillStyle = 'rgba(8, 10, 13, 0.85)';
      g.fillRect(u - 13, v - 13, 26, 26);
      g.lineWidth = 2.5;
      g.strokeStyle = color;
      g.strokeRect(u - 13, v - 13, 26, 26);
      g.fillStyle = color;
      g.font = 'bold 16px sans-serif';
      g.fillText('⌂', u, v + 1);
    }
    img.canvas.className = 'lb-canvas';
    return img.canvas;
  }

  // ---------------------------------------------------------------------------
  // Settings

  private renderSettings(): void {
    const s = this.settings;
    const set = <K extends keyof Settings>(key: K, value: Settings[K], redraw = false) => {
      s[key] = value;
      saveSettings(s);
      if (redraw) this.render();
    };
    const col = el('div', 'lb-settings-col', this.body);
    const row = (label: MessageKey) => {
      const r = el('div', 'lb-row', col);
      el('div', 'lb-row-label', r).textContent = t(label);
      return el('div', 'lb-row-ctl', r);
    };
    const slider = (label: MessageKey, key: 'sensitivity' | 'adsSensitivity' | 'fov' | 'masterVolume', min: number, max: number, step: number, show: (v: number) => string) => {
      const ctl = row(label);
      const input = el('input', 'lb-range', ctl);
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(s[key]);
      const out = el('span', 'lb-range-val', ctl);
      out.textContent = show(s[key]);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        out.textContent = show(v);
        set(key, v);
      });
    };
    const choice = <V extends string>(label: MessageKey, current: V, values: readonly V[], name: (v: V) => string, apply: (v: V) => void) => {
      const seg = el('div', 'lb-seg', row(label));
      for (const v of values) {
        const b = el('button', `lb-opt${v === current ? ' sel' : ''}`, seg);
        b.textContent = name(v);
        b.addEventListener('click', () => apply(v));
      }
    };
    const toggle = (label: MessageKey, key: 'invertY' | 'showFps') =>
      choice(label, s[key] ? 'on' : 'off', ['off', 'on'] as const, (v) => t(`lobby.${v}`), (v) => set(key, v === 'on', true));

    el('div', 'lb-head', col).textContent = t('lobby.controls');
    slider('lobby.sensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2));
    slider('lobby.adsSensitivity', 'adsSensitivity', 0.3, 1.5, 0.05, (v) => v.toFixed(2));
    toggle('lobby.invertY', 'invertY');
    el('div', 'lb-head', col).textContent = t('lobby.video');
    slider('lobby.fov', 'fov', 60, 100, 1, (v) => `${Math.round(v)}°`);
    // Asks the GPU's name (a throwaway WebGL context): once.
    this.autoQuality ??= resolveQuality('auto');
    const auto = t(`lobby.q.${this.autoQuality}` as MessageKey);
    choice('lobby.quality', s.quality, ['auto', 'low', 'medium', 'high'] as const, (v) => (v === 'auto' ? `${t('lobby.q.auto')} (${auto})` : t(`lobby.q.${v}` as MessageKey)), (v) => set('quality', v, true));
    toggle('lobby.showFps', 'showFps');
    el('div', 'lb-head', col).textContent = t('lobby.audioLang');
    slider('lobby.volume', 'masterVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    choice('lobby.language', s.locale, ['ko', 'en'] as const satisfies readonly Locale[], (v) => (v === 'ko' ? '한국어' : 'English'), (v) => {
      set('locale', v);
      setLocale(v);
      this.render();
    });
  }
}
