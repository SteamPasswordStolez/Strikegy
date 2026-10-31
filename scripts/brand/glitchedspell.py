"""GlitchedSpell studio logo (owner, 2026-10-31: "make the logo yourself").

Writes public/brand/glitchedspell-{emblem,logo,stacked,wordmark}.svg: an emblem (a
four-point spell spark inside a broken ring) and the wordmark in Barlow
Condensed Bold (OFL, no reserved name; outlines turned into paths, so the SVGs
need no font), both cut by a few glitch bands that slide sideways with cyan /
magenta fringes. Run: python3 scripts/brand/glitchedspell.py (needs fonttools
and brotli).
"""
import math
import os

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
FONT = os.path.join(ROOT, 'public', 'assets', 'fonts', 'BarlowCondensed-700.woff2')
OUT = os.path.join(ROOT, 'public', 'brand')

INK = '#F2EFE8'
BG = '#0B0C0E'
CYAN = '#22E4FF'
MAGENTA = '#FF2E88'


def emblem(cx, cy, r):
    """Path data for the emblem centred on (cx, cy), ring radius r."""
    parts = []
    # Broken ring: four arcs with notches at the diagonals.
    w = r * 0.08
    for a0, a1 in ((-35, 50), (58, 140), (148, 228), (236, 317)):
        o0, o1 = math.radians(a0), math.radians(a1)
        ro, ri = r + w / 2, r - w / 2
        p = (f'M{cx + ro * math.cos(o0):.2f},{cy + ro * math.sin(o0):.2f}'
             f'A{ro:.2f},{ro:.2f} 0 0 1 {cx + ro * math.cos(o1):.2f},{cy + ro * math.sin(o1):.2f}'
             f'L{cx + ri * math.cos(o1):.2f},{cy + ri * math.sin(o1):.2f}'
             f'A{ri:.2f},{ri:.2f} 0 0 0 {cx + ri * math.cos(o0):.2f},{cy + ri * math.sin(o0):.2f}Z')
        parts.append(p)
    # Four-point spark (the spell), long vertical, shorter horizontal.
    tip_v, tip_h, waist = r * 0.86, r * 0.7, r * 0.15
    pts = [(0, -tip_v), (waist, -waist), (tip_h, 0), (waist, waist), (0, tip_v), (-waist, waist), (-tip_h, 0), (-waist, -waist)]
    parts.append('M' + 'L'.join(f'{cx + x:.2f},{cy + y:.2f}' for x, y in pts) + 'Z')
    # Small ticks on the ring's notches (runes).
    for a in (54, 144, 232, 321):
        o = math.radians(a)
        r0, r1 = r * 1.12, r * 1.24
        t = r * 0.035
        nx, ny = -math.sin(o), math.cos(o)
        x0, y0, x1, y1 = cx + r0 * math.cos(o), cy + r0 * math.sin(o), cx + r1 * math.cos(o), cy + r1 * math.sin(o)
        parts.append(f'M{x0 + nx * t:.2f},{y0 + ny * t:.2f}L{x1 + nx * t:.2f},{y1 + ny * t:.2f}L{x1 - nx * t:.2f},{y1 - ny * t:.2f}L{x0 - nx * t:.2f},{y0 - ny * t:.2f}Z')
    hole = r * 0.11
    inner = f'M{cx},{cy - hole}L{cx + hole},{cy}L{cx},{cy + hole}L{cx - hole},{cy}Z'
    return ' '.join(parts), inner


def wordmark(text, x, baseline, cap, spacing):
    """Path data for `text` with its cap height `cap`, starting at x on `baseline`; returns (d, width)."""
    font = TTFont(FONT)
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    caps = font['OS/2'].sCapHeight or 700
    k = cap / caps
    d = []
    pen_x = x
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        g = gs[name]
        g.draw(TransformPen(pen, (k, 0, 0, -k, pen_x, baseline)))
        d.append(pen.getCommands())
        pen_x += g.width * k + spacing
    return ' '.join(d), pen_x - spacing - x


def glitched(mark_id, width, height, bands):
    """The mark drawn whole outside the bands, shifted inside them, with colour fringes."""
    p = mark_id  # every id carries the variant's name: several logos on one page must not share them
    defs = [f'<clipPath id="{p}-keep"><path fill-rule="evenodd" d="M0,0H%dV%dH0Z %s"/></clipPath>' % (
        width, height, ' '.join(f'M0,{y}H{width}V{y + h}H0Z' for y, h, _ in bands))]
    body = [f'<g clip-path="url(#{p}-keep)"><use href="#{mark_id}" fill="{INK}"/></g>']
    for i, (y, h, dx) in enumerate(bands):
        defs.append(f'<clipPath id="{p}-b{i}"><rect x="0" y="{y}" width="{width}" height="{h}"/></clipPath>')
        body.append(
            f'<g clip-path="url(#{p}-b{i})">'
            f'<use href="#{mark_id}" fill="{CYAN}" opacity="0.9" transform="translate({dx - 4},0)"/>'
            f'<use href="#{mark_id}" fill="{MAGENTA}" opacity="0.9" transform="translate({dx + 4},0)"/>'
            f'<use href="#{mark_id}" fill="{INK}" transform="translate({dx},0)"/></g>')
    return defs, body


def svg(name, width, height, mark, bands, dark):
    mid = f'gs-{name}'
    defs, body = glitched(mid, width, height, bands)
    bg = f'<rect width="{width}" height="{height}" fill="{BG}"/>' if dark else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">'
            f'<title>GlitchedSpell</title><defs><g id="{mid}">{mark}</g>{"".join(defs)}</defs>{bg}{"".join(body)}</svg>\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    ring, hole = emblem(128, 128, 96)
    em = f'<path fill-rule="evenodd" d="{ring} {hole}"/>'
    bands = [(70, 9, 9), (146, 6, -12), (186, 11, 6)]
    with open(os.path.join(OUT, 'glitchedspell-emblem.svg'), 'w') as f:
        f.write(svg('emblem', 256, 256, em, bands, False))

    # Horizontal: emblem left, wordmark right.
    ring, hole = emblem(100, 100, 74)
    words, w = wordmark('GLITCHEDSPELL', 210, 132, 64, 7)
    width = int(210 + w + 40)
    mark = f'<path fill-rule="evenodd" d="{ring} {hole}"/><path d="{words}"/>'
    with open(os.path.join(OUT, 'glitchedspell-logo.svg'), 'w') as f:
        f.write(svg('logo', width, 200, mark, [(58, 7, 10), (110, 6, -12)], False))

    # Wordmark alone (the trailer's opening reveals it under the emblem; no glitch bands, the animation adds them).
    words, w = wordmark('GLITCHEDSPELL', 10, 70, 58, 9)
    with open(os.path.join(OUT, 'glitchedspell-wordmark.svg'), 'w') as f:
        f.write(svg('wordmark', int(w + 20), 80, f'<path d="{words}"/>', [], False))

    # Stacked (the trailer's opening card): emblem over the wordmark.
    words, w = wordmark('GLITCHEDSPELL', 0, 0, 58, 9)
    width = int(max(w + 80, 360))
    x0 = (width - w) / 2
    words, _ = wordmark('GLITCHEDSPELL', x0, 400, 58, 9)
    ring, hole = emblem(width / 2, 170, 110)
    mark = f'<path fill-rule="evenodd" d="{ring} {hole}"/><path d="{words}"/>'
    with open(os.path.join(OUT, 'glitchedspell-stacked.svg'), 'w') as f:
        f.write(svg('stacked', width, 440, mark, [(96, 10, 12), (204, 7, -16), (370, 9, 10)], False))


if __name__ == '__main__':
    main()
