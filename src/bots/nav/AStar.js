// src/bots/nav/AStar.js
// Patch 8-4B: grid A* with binary heap.
// Returns an array of {ix, iz} nodes (inclusive start+goal) or null.

class MinHeap {
  constructor(){
    /** @type {{k:number, v:any}[]} */
    this.a = [];
  }
  get size(){ return this.a.length; }
  push(k, v){
    const a = this.a;
    a.push({k, v});
    let i = a.length - 1;
    while(i > 0){
      const p = (i - 1) >> 1;
      if(a[p].k <= a[i].k) break;
      const t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  }
  pop(){
    const a = this.a;
    if(a.length === 0) return null;
    const root = a[0];
    const last = a.pop();
    if(a.length){
      a[0] = last;
      let i = 0;
      while(true){
        const l = i*2 + 1, r = l + 1;
        let m = i;
        if(l < a.length && a[l].k < a[m].k) m = l;
        if(r < a.length && a[r].k < a[m].k) m = r;
        if(m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t;
        i = m;
      }
    }
    return root.v;
  }
}

function hManhattan(ix, iz, gx, gz){
  return Math.abs(ix - gx) + Math.abs(iz - gz);
}

export function aStarGrid(grid, start, goal, opts={}){
  const maxExpansions = (opts.maxExpansions ?? 24000) | 0;
  const allowDiag = (opts.allowDiag ?? true);
  const openPenaltyW = Number(opts.openPenalty ?? 0.06); // bias away from walls (0..)

  const sx = start.ix|0, sz = start.iz|0;
  const gx = goal.ix|0,  gz = goal.iz|0;
  if(!grid.isWalkableCell(sx, sz) || !grid.isWalkableCell(gx, gz)) return null;
  if(sx === gx && sz === gz) return [{ix:sx, iz:sz}];

  const cols = grid.cols|0, rows = grid.rows|0;
  const N = cols * rows;

  // 1D arrays for speed
  const came = new Int32Array(N);
  came.fill(-1);
  const gScore = new Float32Array(N);
  gScore.fill(1e9);
  const fScore = new Float32Array(N);
  fScore.fill(1e9);
  const openMark = new Uint8Array(N);

  const heap = new MinHeap();

  const sIdx = sz * cols + sx;
  const gIdx = gz * cols + gx;

  gScore[sIdx] = 0;
  fScore[sIdx] = hManhattan(sx, sz, gx, gz);
  heap.push(fScore[sIdx], sIdx);
  openMark[sIdx] = 1;

  const dirs4 = [[1,0],[-1,0],[0,1],[0,-1]];
  const dirs8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const dirs = allowDiag ? dirs8 : dirs4;

  let expanded = 0;

  while(heap.size){
    const cur = heap.pop();
    if(cur === null) break;

    const cIdx = cur|0;
    if(cIdx === gIdx){
      // reconstruct
      const path = [];
      let t = cIdx;
      while(t !== -1){
        const iz = (t / cols) | 0;
        const ix = (t - iz*cols) | 0;
        path.push({ix, iz});
        t = came[t];
      }
      path.reverse();
      return path;
    }

    expanded++;
    if(expanded > maxExpansions) break;

    const cz = (cIdx / cols) | 0;
    const cx = (cIdx - cz*cols) | 0;
    openMark[cIdx] = 0;

    for(const d of dirs){
      const nx = cx + d[0], nz = cz + d[1];
      if(nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      if(!grid.isWalkableCell(nx, nz)) continue;

      // prevent cutting corners for diagonal moves
      if(allowDiag && d[0] !== 0 && d[1] !== 0){
        if(!grid.isWalkableCell(cx, nz) || !grid.isWalkableCell(nx, cz)) continue;
      }

      const nIdx = nz * cols + nx;
      const step = (d[0] === 0 || d[1] === 0) ? 1.0 : 1.4142135;
      const open = (typeof grid.opennessAtCell === 'function') ? grid.opennessAtCell(nx, nz) : 8;
      const wallPenalty = (8 - (open|0)) * openPenaltyW;
      const tent = gScore[cIdx] + step + wallPenalty;

      if(tent < gScore[nIdx]){
        came[nIdx] = cIdx;
        gScore[nIdx] = tent;
        const h = hManhattan(nx, nz, gx, gz);
        fScore[nIdx] = tent + h * 1.05;
        if(!openMark[nIdx]){
          heap.push(fScore[nIdx], nIdx);
          openMark[nIdx] = 1;
        }else{
          // no decrease-key; push duplicate (ok) - openMark keeps it "open"
          heap.push(fScore[nIdx], nIdx);
        }
      }
    }
  }

  return null;
}
