// ROK Army rank insignia drawn in code, as worn: the enlisted's gold-framed black bars; on a dark
// green shoulder board with a gold button the NCOs' gold chevrons, the officers' silver
// diamonds and rose of Sharon blossoms, the generals' silver stars, with a laurel under them.
(() => {
  let uid = 0;
  const DEFS = (id) => `
    <defs>
      <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff0ad"/><stop offset=".45" stop-color="#e6b93f"/><stop offset="1" stop-color="#8d6715"/>
      </linearGradient>
      <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#c9d1d6"/><stop offset="1" stop-color="#737b81"/>
      </linearGradient>
      <linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#143a33"/><stop offset=".5" stop-color="#2a6256"/><stop offset="1" stop-color="#123029"/>
      </linearGradient>
      <radialGradient id="${id}p" cx=".35" cy=".3" r=".8">
        <stop offset="0" stop-color="#fff3b8"/><stop offset=".55" stop-color="#dcae35"/><stop offset="1" stop-color="#7c5a10"/>
      </radialGradient>
      <filter id="${id}d" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity=".55"/>
      </filter>
    </defs>`;

  const star = (x, y, r, fill) => {
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      const q = k % 2 ? r * 0.42 : r;
      pts.push(`${(x + Math.cos(a) * q).toFixed(1)} ${(y + Math.sin(a) * q).toFixed(1)}`);
    }
    return `<path d="M${pts.join('L')}Z" fill="${fill}"/>`;
  };
  const diamond = (x, y, r, fill) =>
    `<path d="M${x} ${y - r}L${x + r * 1.15} ${y}L${x} ${y + r}L${x - r * 1.15} ${y}Z" fill="${fill}"/>` +
    `<path d="M${x} ${y - r}L${x + r * 1.15} ${y}L${x} ${y}Z" fill="#fff" opacity=".55"/>` +
    `<path d="M${x} ${y + r}L${x - r * 1.15} ${y}L${x} ${y}Z" fill="#000" opacity=".22"/>`;
  const blossom = (x, y, r, fill) => {
    let s = '';
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 360;
      s += `<ellipse cx="${x}" cy="${y - r * 0.6}" rx="${r * 0.2}" ry="${r * 0.52}" fill="${fill}" transform="rotate(${a} ${x} ${y})"/>`;
    }
    return `${s}<circle cx="${x}" cy="${y}" r="${r * 0.22}" fill="#6d7479"/>`;
  };
  const chevron = (y, fill) => `<path d="M36 ${y}L100 ${y + 44}L164 ${y}V${y + 22}L100 ${y + 66}L36 ${y + 22}Z" fill="${fill}"/>`;
  /** Two sprays of leaves meeting under the mark. */
  const laurel = (y, fill) => {
    let s = '';
    for (const side of [-1, 1]) {
      for (let k = 0; k < 7; k++) {
        const f = k / 6;
        const x = 100 + side * (10 + f * 56);
        const yy = y + 34 - f * f * 46;
        const rot = side * (58 - f * 44);
        s += `<ellipse cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" rx="8" ry="15" fill="${fill}" transform="rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${yy.toFixed(1)})"/>`;
      }
    }
    return s;
  };

  /** The insignia as SVG markup; `height` is its height on screen in px. */
  window.rankSvg = (kind, n, height) => {
    const id = `r${++uid}`;
    const gold = `url(#${id}g)`;
    const silver = `url(#${id}s)`;
    if (kind === 'bar') {
      const h = 34 + n * 36;
      let bars = '';
      for (let i = 0; i < n; i++) bars += `<rect x="24" y="${24 + i * 36}" width="272" height="24" rx="2" fill="#0d0e0c"/>`;
      return `<svg viewBox="0 0 320 ${h}" style="height:${height ?? h * 1.15}px;display:block">${DEFS(id)}
        <g filter="url(#${id}d)"><rect x="4" y="4" width="312" height="${h - 8}" rx="8" fill="${gold}"/>
        <rect x="14" y="14" width="292" height="${h - 28}" rx="3" fill="#b89332"/>${bars}</g></svg>`;
    }
    let marks = '';
    if (kind === 'chevron' || kind === 'chevronStar') {
      const count = n;
      const top = 196 - (count * 34) / 2 + (kind === 'chevronStar' ? 16 : 0);
      if (kind === 'chevronStar') marks += star(100, top - 34, 24, gold);
      for (let i = 0; i < count; i++) marks += chevron(top + i * 34, gold);
      marks += laurel(310, gold);
    } else if (kind === 'diamond') {
      for (let i = 0; i < n; i++) marks += diamond(100, 196 - ((n - 1) * 44) / 2 + i * 44, 28, silver);
      marks += laurel(318, silver);
    } else if (kind === 'blossom') {
      for (let i = 0; i < n; i++) marks += blossom(100, 196 - ((n - 1) * 62) / 2 + i * 62, 38, silver);
      marks += laurel(318, silver);
    } else if (kind === 'star') {
      for (let i = 0; i < n; i++) marks += star(100, 202 - ((n - 1) * 52) / 2 + i * 52, 34, silver);
      marks += laurel(322, silver);
    } else if (kind === 'marshal') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        marks += star(100 + Math.cos(a) * 46, 212 + Math.sin(a) * 46, 28, silver);
      }
      marks += laurel(322, silver);
    }
    return `<svg viewBox="0 0 200 400" style="height:${height ?? 380}px;display:block">${DEFS(id)}
      <g filter="url(#${id}d)">
        <path d="M10 76L100 8L190 76V392H10Z" fill="url(#${id}b)" stroke="#0b211c" stroke-width="3"/>
        <path d="M20 82L100 21L180 82V382H20Z" fill="none" stroke="#6f9c91" stroke-width="2" stroke-dasharray="6 6" opacity=".55"/>
        <circle cx="100" cy="72" r="22" fill="url(#${id}p)"/>
        <circle cx="100" cy="72" r="14" fill="none" stroke="#7c5a10" stroke-width="2" opacity=".6"/>
        <g filter="url(#${id}d)">${marks}</g>
      </g></svg>`;
  };
})();
