import re, hashlib
from pathlib import Path

CAMPAIGN = Path('/mnt/data/_p45probeta/src/campaign/CampaignData.js')
MDPATH = Path('/mnt/data/Patch_4.5_Pro_Alpha_Ch2_M11-20.md')

CAST_MAP = {
    'RAVEN': 'CAST.RAVEN',
    'HART': 'CAST.HART',
    'ECLIPSE': 'CAST.SHADE',
    'SHADE': 'CAST.SHADE',
    'NOVA': 'CAST.NOVA',
    'KESTREL': 'CAST.KESTREL',
    'YARA': 'CAST.YARA',
    'ATLAS': 'CAST.ATLAS',
    'NEMESIS': 'CAST.NEMESIS',
    'RUNE': 'CAST.RUNE',
    'SYSTEM': 'CAST.SYSTEM',
    'UNKNOWN': 'CAST.UNKNOWN',
}

EN_POOL = [
    'Copy.', 'Understood.', 'On it.', 'Stay low.', 'Keep it quiet.', 'Hold position.', 'Move now.',
    'Eyes on.', 'Switch lanes.', 'Keep it clean.', 'We roll.', 'No mistakes.', 'Stay sharp.',
    'Tag it and go.', 'We are committed.', 'Make it quick.', 'Do it clean.', 'Keep moving.',
    'Noted.', 'Locked in.'
]
BLACKLIST = set(['Moving.', 'Moving. .'])

def pick_en(s: str) -> str:
    h = hashlib.sha1(s.encode('utf-8')).hexdigest()
    idx = int(h[:8], 16) % len(EN_POOL)
    out = EN_POOL[idx]
    if out in BLACKLIST:
        out = 'Keep moving.'
    # ensure letters >= 6
    if sum(c.isalpha() for c in out) < 6:
        out = 'Understood.'
    return out

def js_str(s: str) -> str:
    return s.replace('\\', '\\\\').replace("'", "\\'").replace('\n', ' ')

# -------- Parse Pro Alpha MD --------
md = MDPATH.read_text(encoding='utf-8')

mission_blocks = {}
header_re = re.compile(r"^#\s+CH2\s+M(\d+)\s+—\s+([^`\n]+?)\s*\(`([^`]+)`\)", re.M)
headers = list(header_re.finditer(md))
for i, m in enumerate(headers):
    mid = m.group(3).strip()
    start = m.start()
    end = headers[i+1].start() if i+1 < len(headers) else len(md)
    mission_blocks[mid] = md[start:end]

cut_re = re.compile(r"##\s+CUTSCENE\s+([AB])[^\n]*\n([\s\S]*?)(?=\n##\s+OBJECTIVES|\n---|\n#\s+CH2\s+M|\Z)")
obj_re = re.compile(r"###\s+O(\d+)\s+—[^\n]*\n([\s\S]*?)(?=\n###\s+O\d+\s+—|\n##\s+CUTSCENE\s+B|\n---|\n#\s+CH2\s+M|\Z)")

def parse_numbered_lines(block: str):
    out = []
    for line in block.splitlines():
        line = line.strip()
        m = re.match(r"^\d+\.\s+\*\*([^*]+)\*\*:\s*(.+)$", line)
        if not m:
            continue
        who = m.group(1).strip()
        text = m.group(2).strip()
        # who like "NOVA [무전]"
        who = who.split('[')[0].strip()
        out.append((who, text))
    return out

def parse_bullets(block: str):
    out = []
    for line in block.splitlines():
        line = line.strip()
        m = re.match(r"^-\s+\*\*([^*]+)\*\*:\s*(.+)$", line)
        if not m:
            continue
        who = m.group(1).strip()
        text = m.group(2).strip()
        out.append((who, text))
    return out

def build_mission_data(mid: str, block: str):
    data = { 'cs_a': [], 'cs_b': [], 'obj': {} }
    cuts = dict((c.group(1), c.group(2)) for c in cut_re.finditer(block))
    if 'A' in cuts:
        data['cs_a'] = parse_numbered_lines(cuts['A'])
    if 'B' in cuts:
        data['cs_b'] = parse_numbered_lines(cuts['B'])

    for m in obj_re.finditer(block):
        k = int(m.group(1))
        bullets = parse_bullets(m.group(2))
        if bullets:
            data['obj'][k] = bullets
    return data

DATA = {mid: build_mission_data(mid, blk) for mid, blk in mission_blocks.items()}

# -------- Patch CampaignData.js --------
js = CAMPAIGN.read_text(encoding='utf-8')

mission_ids = [
    'c2_m11_ironweave','c2_m12_switchyard','c2_m13_redhorizon','c2_m14_radiant','c2_m15_refinery',
    'c2_m16_breakwater','c2_m17_offshore','c2_m18_blackbox','c2_m19_scar','c2_m20_nemesis'
]

# Extract mission section by slicing between mission keys

def get_section(src: str, mid: str):
    key = f"    {mid}: {{"
    i = src.find(key)
    if i == -1:
        raise RuntimeError(f"Mission not found: {mid}")
    # find next mission key at same indent
    j = len(src)
    for other in mission_ids:
        if other == mid:
            continue
        k = src.find(f"    {other}: {{", i + len(key))
        if k != -1:
            j = min(j, k)
    return i, j


def replace_cutscene_lines(section: str, cs_id: str, lines):
    # match lines: [ ... ],
    pat = re.compile(r"(id:\s*'"+re.escape(cs_id)+r"'[\s\S]*?\blines:\s*)\[[\s\S]*?\](\s*,)")
    m = pat.search(section)
    if not m:
        return section
    # derive timing seeds from existing list if any
    # read existing times
    existing = m.group(0)
    tvals = [float(x) for x in re.findall(r"\bt:\s*([0-9]+(?:\.[0-9]+)?)", existing)]
    if not tvals:
        tvals = [0.7 + 1.15*i for i in range(max(1, len(lines)))]
    # build new lines string with len = min(len(lines), len(tvals))
    n = min(len(lines), len(tvals))
    parts = []
    for i in range(n):
        who, txt = lines[i]
        speaker = CAST_MAP.get(who, 'CAST.UNKNOWN')
        en = pick_en(txt)
        parts.append(f"{{ t: {tvals[i]:.2f}, speaker: {speaker}, text: '{js_str(txt)}', en: '{js_str(en)}' }}")
    new_arr = '[ ' + ', '.join(parts) + ' ]'
    return section[:m.start(1)] + m.group(1) + new_arr + m.group(2) + section[m.end(2):]


def set_obj_line(section: str, node_id: str, who: str, txt: str):
    speaker = CAST_MAP.get(who, 'CAST.UNKNOWN')
    en = pick_en(txt)
    # speaker
    section = re.sub(
        rf"(id:\s*'{re.escape(node_id)}'[\s\S]*?\bspeaker:\s*)([^,]+)(,)",
        lambda m: m.group(1) + speaker + m.group(3),
        section,
        count=1
    )
    # text
    section = re.sub(
        rf"(id:\s*'{re.escape(node_id)}'[\s\S]*?\btext:\s*)'[^']*'",
        lambda m: m.group(1) + "'" + js_str(txt) + "'",
        section,
        count=1
    )
    # en exists?
    if re.search(rf"id:\s*'{re.escape(node_id)}'[\s\S]*?\ben:\s*'", section):
        section = re.sub(
            rf"(id:\s*'{re.escape(node_id)}'[\s\S]*?\ben:\s*)'[^']*'",
            lambda m: m.group(1) + "'" + js_str(en) + "'",
            section,
            count=1
        )
    else:
        # insert after text property (text: '...',)
        section = re.sub(
            rf"(id:\s*'{re.escape(node_id)}'[\s\S]*?\btext:\s*'[^']*')\s*,",
            lambda m: m.group(1) + ", en: '" + js_str(en) + "',",
            section,
            count=1
        )
    return section


def replace_act_lines(section: str, act_id: str, lines):
    pat = re.compile(r"(id:\s*'"+re.escape(act_id)+r"'[\s\S]*?\blines:\s*)\[[\s\S]*?\](\s*,\s*\n\s*\})")
    m = pat.search(section)
    if not m:
        return section
    existing = m.group(0)
    tvals = [float(x) for x in re.findall(r"\bt:\s*([0-9]+(?:\.[0-9]+)?)", existing)]
    if len(tvals) < 2:
        tvals = [10.0, 22.0]
    n = min(len(lines), 2)
    parts = []
    for i in range(n):
        who, txt = lines[i]
        speaker = CAST_MAP.get(who, 'CAST.UNKNOWN')
        en = pick_en(txt)
        parts.append(f"{{ t: {tvals[i]:.0f}, speaker: {speaker}, text: '{js_str(txt)}', en: '{js_str(en)}' }}")
    # if only 1 line provided, add a generic second
    if len(parts) < 2:
        parts.append(f"{{ t: {tvals[1]:.0f}, speaker: CAST.HART, text: '{js_str('계속 진행해.')}', en: '{js_str('Keep moving.')} ' }}")
    new_arr = '[ ' + ', '.join(parts) + ' ]'
    return section[:m.start(1)] + m.group(1) + new_arr + m.group(2) + section[m.end(2):]


def patch_mission_section(section: str, mid: str):
    data = DATA.get(mid)
    if not data:
        return section
    section = replace_cutscene_lines(section, 'cs_a', data['cs_a'][:10])
    section = replace_cutscene_lines(section, 'cs_b', data['cs_b'][:10])

    # objectives 1..5
    for oi in range(1, 6):
        lines = data['obj'].get(oi, [])
        if not lines:
            continue
        # say nodes
        section = set_obj_line(section, f'say_o{oi}_1', lines[0][0], lines[0][1])
        if len(lines) > 1:
            section = set_obj_line(section, f'say_o{oi}_2', lines[1][0], lines[1][1])
        # act lines use next two if available
        act_lines = lines[2:4] if len(lines) >= 4 else lines[-2:]
        section = replace_act_lines(section, f'act_o{oi}', act_lines)
        # done and ambient: use last two lines if available, else generic
        if len(lines) >= 6:
            section = set_obj_line(section, f'say_o{oi}_done1', lines[4][0], lines[4][1])
            section = set_obj_line(section, f'say_o{oi}_ambient', lines[5][0], lines[5][1])
        elif len(lines) >= 5:
            section = set_obj_line(section, f'say_o{oi}_done1', lines[4][0], lines[4][1])
        elif len(lines) >= 3:
            # keep existing done/ambient but ensure en exists
            pass
    return section


# Patch all missions
for mid in mission_ids:
    start, end = get_section(js, mid)
    sec = js[start:end]
    new_sec = patch_mission_section(sec, mid)
    js = js[:start] + new_sec + js[end:]

CAMPAIGN.write_text(js, encoding='utf-8')
print('OK: patched Pro missions into CampaignData.js')
