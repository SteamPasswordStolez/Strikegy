// assets/ui/shell.js
// Lobby/Campaign shell helpers (Pre2)

function qs(sel, root=document){return root.querySelector(sel);} 
function qsa(sel, root=document){return Array.from(root.querySelectorAll(sel));}

export function mountModal({overlayId, openBtnIds=[]}){
  const overlay = document.getElementById(overlayId);
  if(!overlay) return { open() {}, close() {} };
  const closeBtn = overlay.querySelector('[data-close="modal"]');

  function open(){ overlay.classList.add('open'); }
  function close(){ overlay.classList.remove('open'); }

  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  closeBtn?.addEventListener('click', close);
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && overlay.classList.contains('open')) close(); });

  for(const id of openBtnIds){
    const b = document.getElementById(id);
    b?.addEventListener('click', open);
  }

  return { open, close };
}

export function mountLobbyMenu({items, onActivate}){
  let idx = 0;
  const els = items.map(it => document.getElementById(it.id)).filter(Boolean);
  function setCurrent(i){
    idx = Math.max(0, Math.min(i, els.length-1));
    els.forEach((el,k)=> el.setAttribute('aria-current', k===idx ? 'true' : 'false'));
    const it = items[idx];
    onActivate?.(it);
  }
  els.forEach((el,k)=>{
    el.addEventListener('mouseenter', ()=>setCurrent(k));
    el.addEventListener('click', ()=>{
      setCurrent(k);
      items[idx] && items[idx].action && items[idx].action();
    });
  });

  document.addEventListener('keydown', (e)=>{
    // ignore when typing in inputs
    const t = e.target;
    if(t && (t.tagName==='INPUT' || t.tagName==='TEXTAREA' || t.isContentEditable)) return;
    if(e.key === 'ArrowDown'){ e.preventDefault(); setCurrent(idx+1); }
    if(e.key === 'ArrowUp'){ e.preventDefault(); setCurrent(idx-1); }
    if(e.key === 'Enter'){ items[idx] && items[idx].action && items[idx].action(); }
  });

  // init
  setCurrent(0);
}

export function setHero({imgEl, kickerEl, titleEl, metaEl, mode}){
  if(imgEl) imgEl.style.backgroundImage = `url('${mode.hero}')`;
  if(kickerEl) kickerEl.textContent = mode.kicker;
  if(titleEl) titleEl.textContent = mode.title;
  if(metaEl) metaEl.textContent = mode.meta;
}

export function showAudioHint(el){
  if(!el) return;
  el.classList.add('show');
}

export function hideAudioHint(el){
  if(!el) return;
  el.classList.remove('show');
}

// simple SFX helper (optional files)
export function makeUISfx(){
  const base = './assets/ui/sfx/';
  const map = {
    hover: base + 'ui_hover.mp3',
    click: base + 'ui_click.mp3',
    back: base + 'ui_back.mp3',
  };

  async function tryPlay(url, vol=0.45){
    try{
      const a = new Audio(url);
      a.volume = vol;
      await a.play();
    }catch{ /* ignore */ }
  }

  return {
    hover: ()=>tryPlay(map.hover, 0.25),
    click: ()=>tryPlay(map.click, 0.38),
    back: ()=>tryPlay(map.back, 0.34),
  };
}
