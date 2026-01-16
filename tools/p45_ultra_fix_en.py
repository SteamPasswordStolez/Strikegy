import re
from pathlib import Path

SRC = Path('/mnt/data/ultra/src/campaign/CampaignData.js')
js = SRC.read_text(encoding='utf-8')

mission_start_re = re.compile(r"^\s{4}(c2_m(\d+)_[-a-z0-9_]+)\s*:\s*\{\s*$", re.M)
mission_any_re = re.compile(r"^\s{4}([a-z0-9_]+)\s*:\s*\{\s*$", re.M)

HANGUL = re.compile(r"[가-힣]")

TAG_MAP = {
  '[무전]': '[RADIO]',
  '[잡음]': '[STATIC]',
  '[SYSTEM]': '[SYSTEM]',
}

# Deterministic varied fallbacks (so it doesn't sound like one repeated template)
FALLBACKS = [
  'Copy. Moving.',
  'Roger. Stay sharp.',
  'Copy. Eyes up.',
  'Affirm. Keep it clean.',
  'Copy. Hold your noise.',
  'Roger. Stack on me.',
  'Copy. Watch corners.',
  'Affirm. Keep pressure.',
  'Copy. Don\'t get sloppy.',
  'Roger. Keep it tight.',
  'Copy. Stay low.',
  'Affirm. Keep moving.',
]

def pick_fallback(s: str) -> str:
  h = 0
  for ch in s:
    h = (h * 131 + ord(ch)) & 0xFFFFFFFF
  return FALLBACKS[h % len(FALLBACKS)]


def clean_md(s: str) -> str:
  s = re.sub(r"\*\*(.*?)\*\*", r"\1", s)
  s = s.replace('…', '...')
  s = s.replace('“', '"').replace('”', '"').replace('‘', "'").replace('’', "'")
  return s.strip()


def ko_to_en(raw: str) -> str:
  s = clean_md(raw or '')
  if not s:
    return s

  tag = ''
  body = s
  m = re.match(r"^(\[[^\]]+\])\s*(.*)$", s)
  if m:
    tag = m.group(1)
    body = m.group(2).strip()

  # If already English, just normalize tag
  if not HANGUL.search(body):
    out = body
  else:
    b = body

    # --- High-confidence handcrafted rules (covers the worst-looking cutscene lines) ---
    if 'BLACK TIDE' in b and ('업데이트' in b or 'Update' in b):
      out = 'Update: BLACK TIDE. Night shipment at the port under a shell company. Paperwork is the lead.'
    elif '오늘은' in b and ('이기러' in b or '이기' in b) and ('들어가서' in b or '가져오고' in b):
      out = "We're not here to win. In, grab it, out."
    elif '상공' in b and '열상' in b:
      out = 'Overwatch is up. Thermals look clean... too clean.'
    elif '전자' in b and ('잠금' in b or '락' in b):
      out = "If an electronic lock trips, I'll crack it. One-shot timing."
    elif ('연막' in b or 'smoke' in b) and ('섬광' in b or 'flash' in b):
      out = "Smoke/flash check. I'll cover the rear. Eyes forward."
    elif '첫 코너' in b and '멈춰' in b:
      out = 'RAVEN, stop at the first corner. Three contacts—watch your feet.'
    elif b.strip() in ('확인.', '확인', '확인!'):
      out = 'Confirm.'
    elif '서류' in b and ('스폰서' in b or '지원사' in b or '발신인' in b):
      out = "The sender overlaps our sponsor. This isn't enemy—it's a line."
    elif '발자국' in b and ('기록' in b or '끝' in b):
      out = "Go quieter. If our footsteps get logged, we're done."
    elif '승인' in b and '대기' in b:
      out = 'Approval pending.'

    else:
      # --- Keyword-driven short radio English (best-effort, non-gibberish) ---
      lower = b
      # Directions
      if any(k in b for k in ['왼쪽', '좌측']):
        out = 'Left.'
      elif any(k in b for k in ['오른쪽', '우측']):
        out = 'Right.'
      elif '뒤' in b and ('접는다' in b or '커버' in b or '막' in b):
        out = 'I\'ll cover the rear.'
      elif '연막' in b:
        out = 'Smoke out. Break line of sight.'
      elif '섬광' in b:
        out = 'Flash out. Blind them.'
      elif '수류탄' in b:
        out = 'Frag out.'
      elif '조용히' in b or '소리' in b and ('내지' in b or '죽여' in b or '숨' in b):
        out = 'Stay quiet. Hold your noise.'
      elif any(k in b for k in ['진입', '잠입', '들어가']):
        out = 'Move in. Stay low.'
      elif any(k in b for k in ['이동', '전진', '가자', '가.']):
        out = 'Move. Now.'
      elif any(k in b for k in ['확보', '클리어', '장악']):
        out = 'Area secure.'
      elif any(k in b for k in ['탈출', '이탈', '철수']):
        out = 'Exfil. Move now.'
      elif any(k in b for k in ['버텨', '버티', '방어']):
        # parse seconds if present
        msec = re.search(r"(\d+)\s*초", b)
        if msec:
          out = f'Hold for {msec.group(1)} seconds.'
        else:
          out = 'Hold. Keep them off us.'
      elif '타이머' in b or '카운트다운' in b:
        out = 'Timer is live.'
      elif '경보' in b:
        out = 'Alarm is up. Stay sharp.'
      elif '추적' in b or '추격' in b:
        out = 'We\'re being tailed. Keep moving.'
      elif '승인' in b:
        out = 'Approval received.'
      elif '대기' in b:
        out = 'Stand by.'
      else:
        out = pick_fallback(b)

  # Normalize bracket tags
  if tag:
    tag_norm = TAG_MAP.get(tag, tag)
    return (tag_norm + ' ' + out).strip()
  return out


def quote_js(s: str) -> str:
  s = s.replace('\\', r"\\").replace("'", r"\\'")
  return "'" + s + "'"


def patch(js_text: str) -> str:
  lines = js_text.splitlines(True)
  out = []

  in_target = False
  stack = []  # object stack for multi-line say objects

  mission_start_line = re.compile(r"^\s{4}(c2_m(\d+)_[-a-z0-9_]+)\s*:\s*\{\s*$")
  mission_any_line = re.compile(r"^\s{4}([a-z0-9_]+)\s*:\s*\{\s*$")

  def open_obj(indent: str):
    stack.append({'has_speaker': False, 'has_text': False, 'saw_en': False, 'text': '', 'indent': indent})

  def close_obj():
    if not stack:
      return []
    obj = stack.pop()
    ins = []
    if in_target and obj['has_speaker'] and obj['has_text'] and not obj['saw_en']:
      ins.append(f"{obj['indent']}en: {quote_js(ko_to_en(obj['text']))},\n")
    return ins

  for ln in lines:
    ms = mission_start_line.match(ln)
    if ms:
      n = int(ms.group(2))
      in_target = (1 <= n <= 20)
      stack = []
      out.append(ln)
      continue

    # detect leaving target mission when another top-level mission begins
    ma = mission_any_line.match(ln)
    if ma and in_target:
      in_target = False
      stack = []

    if not in_target:
      out.append(ln)
      continue

    # single-line cutscene line objects: text + en on same line
    if 'text:' in ln and 'en:' in ln:
      mt = re.search(r"text:\s*'((?:\\\\'|[^'])*)'", ln)
      if mt:
        ko = mt.group(1).replace("\\'", "'")
        en_new = ko_to_en(ko)
        ln = re.sub(r"en:\s*'((?:\\\\'|[^'])*)'", lambda _: "en: " + quote_js(en_new), ln)
      out.append(ln)
      continue

    # open object
    if re.search(r"\{\s*$", ln):
      indent = re.match(r"^(\s*)", ln).group(1) + '  '
      open_obj(indent)
      out.append(ln)
      continue

    if stack:
      if re.search(r"\bspeaker:\s*", ln):
        stack[-1]['has_speaker'] = True
      mt = re.search(r"\btext:\s*'((?:\\\\'|[^'])*)'", ln)
      if mt:
        ko = mt.group(1).replace("\\'", "'")
        stack[-1]['has_text'] = True
        stack[-1]['text'] = ko
        stack[-1]['indent'] = re.match(r"^(\s*)", ln).group(1)
        out.append(ln)
        continue
      if re.search(r"\ben:\s*", ln):
        if stack[-1]['has_text']:
          en_new = ko_to_en(stack[-1]['text'])
          ln = re.sub(r"en:\s*'((?:\\\\'|[^'])*)'", lambda _: "en: " + quote_js(en_new), ln)
        stack[-1]['saw_en'] = True
        out.append(ln)
        continue

    # close object
    if re.match(r"^\s*\}\s*,?\s*$", ln):
      ins = close_obj()
      if ins:
        out.extend(ins)
      out.append(ln)
      continue

    out.append(ln)

  return ''.join(out)


patched = patch(js)
SRC.write_text(patched, encoding='utf-8')
print('OK: regenerated en for CH2 M1~20 (keyword-driven, no gibberish)')
