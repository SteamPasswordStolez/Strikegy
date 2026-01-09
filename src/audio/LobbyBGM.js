// LobbyBGM.js
// - Plays ./assets/audio/bgm/Lobby.mp3 in a loop (when enabled)
// - Works around browser autoplay restrictions by waiting for a user gesture

const STORAGE_KEY = 'strikegy_bgm_lobby_v1';
const DEFAULT_STATE = { enabled: true, volume: 0.35 };

function clamp(n, min, max){
  n = Number(n);
  if(Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return { ...DEFAULT_STATE };
    const p = JSON.parse(raw);
    return {
      enabled: (p.enabled === false) ? false : true,
      volume: clamp(p.volume ?? DEFAULT_STATE.volume, 0, 1),
    };
  }catch{
    return { ...DEFAULT_STATE };
  }
}

function saveState(state){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch{}
}

async function fileExists(url){
  try{
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  }catch{
    return false;
  }
}

export function initLobbyBGM(options = {}){
  const src = options.src || './assets/audio/bgm/Lobby.mp3';
  const state = loadState();

  // Optional callbacks (used by UI to show/hide autoplay hint)
  const onAutoplayBlocked = (typeof options.onAutoplayBlocked === 'function') ? options.onAutoplayBlocked : null;
  const onPlaying = (typeof options.onPlaying === 'function') ? options.onPlaying : null;

  // optional UI
  const enabledEl = options.enabledEl || null;
  const volumeEl = options.volumeEl || null;
  const volumeValueEl = options.volumeValueEl || null;

  let audio = null;
  let started = false;
  let waitingGesture = false;
  let destroyed = false;

  function applyVolume(){
    if(audio) audio.volume = clamp(state.volume, 0, 1);
    if(volumeValueEl){
      volumeValueEl.textContent = `${Math.round(clamp(state.volume,0,1)*100)}%`;
    }
    if(volumeEl){
      volumeEl.value = String(clamp(state.volume,0,1));
    }
  }

  function applyEnabled(){
    if(enabledEl) enabledEl.checked = !!state.enabled;
    if(!state.enabled) stop();
    else armAutoplay();
  }

  async function ensureAudio(){
    if(audio || destroyed) return;
    const ok = await fileExists(src);
    if(!ok) return; // 파일이 없으면 조용히 종료 (콘솔 스팸 방지)
    audio = new Audio(src);
    audio.loop = true;
    audio.preload = 'auto';
    applyVolume();
  }

  async function play(){
    if(destroyed) return;
    if(!state.enabled) return;
    await ensureAudio();
    if(!audio) return;
    try{
      await audio.play();
      started = true;
      if(onPlaying) onPlaying();
    }catch(e){
      // autoplay blocked → wait for gesture
      if(onAutoplayBlocked) onAutoplayBlocked(e);
      armAutoplay();
    }
  }

  function stop(){
    if(audio){
      try{ audio.pause(); }catch{}
      try{ audio.currentTime = 0; }catch{}
    }
    started = false;
  }

  function armAutoplay(){
    if(destroyed) return;
    if(waitingGesture) return;
    if(started) return;
    if(!state.enabled) return;

    waitingGesture = true;

    const onGesture = async ()=>{
      if(destroyed) return;
      waitingGesture = false;
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      await play();
    };

    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
  }

  function setEnabled(v){
    state.enabled = !!v;
    saveState(state);
    applyEnabled();
  }

  function setVolume(v){
    state.volume = clamp(v, 0, 1);
    saveState(state);
    applyVolume();
  }

  // bind UI
  if(enabledEl){
    enabledEl.addEventListener('change', ()=>setEnabled(enabledEl.checked));
  }
  if(volumeEl){
    volumeEl.addEventListener('input', ()=>setVolume(volumeEl.value));
  }

  // initial apply + try start
  applyEnabled();
  applyVolume();
  // start attempt (will arm autoplay if blocked)
  play();

  return {
    get state(){ return { ...state }; },
    play,
    stop,
    setEnabled,
    setVolume,
    destroy(){
      destroyed = true;
      stop();
    }
  };
}
