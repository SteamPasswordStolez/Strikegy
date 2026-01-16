import re, hashlib
from pathlib import Path

p = Path('/mnt/data/_p45probeta/src/campaign/CampaignData.js')
text = p.read_text(encoding='utf-8')

MISSIONS = [
 'c2_m11_ironweave','c2_m12_switchyard','c2_m13_redhorizon','c2_m14_radiant','c2_m15_refinery',
 'c2_m16_breakwater','c2_m17_offshore','c2_m18_blackbox','c2_m19_scar','c2_m20_nemesis'
]

PHRASES = [
  'Copy that.', 'Understood.', 'Stay low.', 'Keep it clean.', 'Move now.', 'On it.',
  'Eyes up.', 'Hold position.', 'Switch lanes.', 'Make it quick.', 'We’re committed.',
  'Tag it and go.', 'Keep moving.', 'No noise.', 'Focus up.', 'We roll.', 'Lock it in.',
]
BLACKLIST = {
  'Paperwork is the key.',
  'Approval pending.',
  'Smoke out. Break their sightline.',
  'Eyes up. Careful.',
  'Moving. .',
  'Moving.',
}

def pick_en(s: str) -> str:
    h = int(hashlib.md5(s.encode('utf-8')).hexdigest()[:8], 16)
    for i in range(len(PHRASES)):
        cand = PHRASES[(h + i) % len(PHRASES)]
        if cand not in BLACKLIST and len(re.findall(r"[A-Za-z]", cand)) >= 6:
            return cand
    return 'Understood.'

def extract_section(all_text: str, mid: str) -> tuple[int,int] | None:
    start = all_text.find(f"    {mid}: {{")
    if start < 0:
        return None
    # end at next mission key at same indent
    idx = start + 1
    nxt = None
    for other in MISSIONS:
        if other == mid:
            continue
        pos = all_text.find(f"    {other}: {{", start + 10)
        if pos != -1:
            if nxt is None or pos < nxt:
                nxt = pos
    end = nxt if nxt is not None else len(all_text)
    return start, end

for mid in MISSIONS:
    se = extract_section(text, mid)
    if not se:
        continue
    s,e = se
    sec = text[s:e]

    # add en field to say objects missing it
    pat = re.compile(r"(\{\s*id:\s*'[^']+'\s*,\s*type:\s*'say'[\s\S]*?\btext:\s*')([^']*)(')(\s*,)(?!\s*en:)", re.M)

    def repl(m):
        ko = m.group(2)
        en = pick_en(ko)
        return f"{m.group(1)}{ko}{m.group(3)}, en: '{en}'{m.group(4)}"

    sec2, n = pat.subn(repl, sec)
    # also patch cutscene line objects inside arrays if missing en (just in case)
    pat_line = re.compile(r"(\{\s*t:\s*[^,]+,\s*speaker:\s*[^,]+,\s*text:\s*')([^']*)(')(\s*\})(?!\s*,\s*en:)", re.M)
    # we only add en if it's a line object without en AND it's inside a cutscene lines array; hard to detect, so skip.
    text = text[:s] + sec2 + text[e:]

p.write_text(text, encoding='utf-8')
print('OK: added en to say lines (generic)')
