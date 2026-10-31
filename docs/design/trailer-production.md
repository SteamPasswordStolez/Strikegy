# 출시 트레일러 제작 안내서

**누가 읽나:** 이 트레일러를 실제로 만들 **오너 PC의 로컬 세션**. 이전 대화를 모르는 세션이 이 문서만 보고 끝까지 만들 수 있도록 썼다. 2026-10-31 클라우드 세션 작성.

**먼저 읽을 것:**
1. 이 문서 전체
2. `docs/design/trailer.md`: 이야기, 대사, 장면표, 촬영 위치. *무엇을* 만드는지.
3. `CLAUDE.md`의 "Launch trailer" 항목

이 문서는 *어떻게* 만드는지를 다룬다.

---

## 1. 오너가 정한 것 (바꾸지 말 것)

| 항목 | 결정 |
|---|---|
| 참고 | 콜 오브 듀티 모던 워페어 4 출시 트레일러 같은 느낌 |
| 음악 | `Engaging` **원곡 그대로**, 2분 17초. 자르지 않는다 |
| 장면 전환 | 음악의 파형·분위기·**묵직한 타격**에 맞춘다. 타격 시간은 trailer.md 2장과 `scripts/trailer/data/shots.json` |
| 오프닝 | 처음 5초는 게임사 로고와 이름만. 게임사 **GlitchedSpell**, 로고는 `public/brand/glitchedspell-*.svg` (Claude가 만듦) |
| 화면 | **게임 UI는 한 조각도 보이면 안 된다.** 게임 안 F2(촬영 모드)로 찍는다 |
| 실플레이 | 봇을 3인칭으로 찍은 게 아니라 **1인칭 실제 플레이**. 오너가 직접 찍는다 |
| 이야기 | 분명한 이야기에 **대사를 많이**: 신병 무전병("kid")과 분대장("Sarge")의 "부름" |
| 언어 | **대사만 영어**, 한국어 자막. **화면 글자는 모두 한국어**(카드, 진급 그래픽, 끝 화면). 예외는 오프닝의 "PRESENTS"와 로고(STRIKEGY, GLITCHEDSPELL) |
| 공개 | **출시 당일**. 끝 화면은 날짜 없이 "지금 플레이" |
| 제작 | **전부 로컬 세션에서** (촬영, 녹음, 편집) |

**아직 안 정한 것** (trailer.md 7장):
- 끝 화면에 "무료 플레이"를 넣을지
- 연출 컷용 장면 세팅 도구를 만들지

정해지지 않은 것은 오너에게 묻는다.

## 2. 파일 지도

| 경로 | 무엇 | git |
|---|---|---|
| `docs/design/trailer.md` | 이야기, 대사표, 장면표, 촬영 위치표 (사람이 읽는 원본) | O |
| `scripts/trailer/data/shots.json` | 컷 67개: id, start, end(초), type, desc. **조립의 기준** | O |
| `scripts/trailer/data/lines.json` | 대사 60줄: id(L01–L60), start, end, speaker, delivery, en, ko | O |
| `scripts/trailer/gfx.html` | 그래픽 그리는 페이지 (오프닝, 카드, 타이틀, 끝 화면, 진급, 자막, 대체 화면) | O |
| `scripts/trailer/render.mjs` | gfx.html을 프레임마다 찍어 영상/PNG로 | O |
| `scripts/trailer/voices.mjs` | 대사 → 목소리 파일 (OpenRouter의 ElevenLabs) + 무전 효과 | O |
| `scripts/trailer/peek.mjs` | 촬영 영상에서 섬광 순간 찾기 + 시간 찍힌 썸네일 판 | O |
| `scripts/trailer/build.mjs` | 전부 조립 → 최종 영상 | O |
| `public/brand/glitchedspell-*.svg`, `scripts/brand/glitchedspell.py` | 로고 (emblem / logo / stacked / wordmark) | O |
| `assets-src/trailer/footage/` | 오너가 찍은 영상 | X (git-ignored) |
| `assets-src/trailer/edit.json` | 컷마다 어느 영상의 몇 초부터 쓰는지 | X |
| `assets-src/trailer/gfx/` | render.mjs 결과 | X |
| `assets-src/trailer/voice/` | `raw/Lnn.mp3` 원본 목소리, `Lnn.wav` 효과 입힌 것 | X |
| `assets-src/trailer/out/` | `trailer.mp4`(자막 입힘), `trailer_nosubs.mp4`, `subtitles.ko.srt` | X |
| 음악 | `assets-src/sounds/Engaging.mp3` (오너 PC의 원본). 없으면 `public/music/engaging.mp3` | — |

**시간을 바꿀 때:** `shots.json` / `lines.json`과 `trailer.md`의 표를 **같이** 고친다. 둘이 어긋나면 안 된다.

## 3. 전체 순서

```
① 그래픽 렌더 → ② 대체 화면으로 초안 조립(타이밍 확인) → ③ 목소리 → ④ 촬영
→ ⑤ edit.json 채우기 → ⑥ 연출 컷 → ⑦ 최종 조립 → ⑧ 점검 → ⑨ 오너 시청
```

각 단계가 끝날 때마다 `build.mjs`로 조립해 볼 수 있다. 영상이 없는 컷은 대체 화면, 목소리가 없는 줄은 빠진 채로 조립된다.

### ① 그래픽 렌더 (약 1.5분)

```bash
node scripts/trailer/render.mjs --placeholders
```

`assets-src/trailer/gfx/`에 다음이 생긴다.
- `opening.mp4` (150프레임)
- `card_S7/S9/S11/S13/S57/S58/S59/S60.mp4` (각 컷 길이 그대로)
- `promo/` (일병 진급, 투명 PNG 21장)
- `subs/` (자막 60장)
- `placeholders/` (아직 안 찍은 컷 자리)

**그래픽 규칙:**
- 글자는 Pretendard(한글)와 Barlow Condensed(영문). 둘 다 `public/assets/fonts`에 있다.
- 색은 따뜻한 흰색 `#f2efe8`, 앰버 `#e8a33a`, 글리치 시안 `#22e4ff`, 마젠타 `#ff2e88`.
- 모양은 `gfx.html`의 `draws.*` 함수에서 바꾼다. 프레임 번호만으로 그리게 되어 있어서, 렌더할 때마다 결과가 똑같다.

### ② 초안 조립

```bash
node scripts/trailer/build.mjs --check
node scripts/trailer/build.mjs --draft
```

- **`--check`:** 컷마다 무엇으로 채워지는지, 영상이 짧지 않은지 표로 보여 준다.
- **`--draft`:** 빠른 저화질 조립이다. 클라우드에서 처음 3분 25초, 다시 할 때 2분 24초 걸렸다. 입력이 안 바뀐 컷 조각은 `out/seg/*.key`로 알아보고 건너뛴다. PC는 더 빠르다.
- 결과는 `assets-src/trailer/out/trailer.mp4`이다. 오너에게 보여 주고 음악에 맞는지 확인받는다.

### ③ 목소리 (오너 PC의 키 필요)

```bash
node scripts/trailer/voices.mjs
```

- **키:** `assets-src/openrouter.key`(`OPENROUTER_API_KEY=...`)를 쓴다. 전장 브리핑 목소리와 같은 경로다(`scripts/voice-generate.mjs`). 모델은 `elevenlabs/eleven-v4`.
- **목소리 배정:** `voices.mjs`의 `VOICES`에 있다. Sarge adam, Private liam, Command brian(브리핑 본부와 같은 목소리), Iron One bill, Hawk Two eric, Coral One daniel, Sub captain george, Coxswain roger, 분대원 charlie / callum, 상륙 병사 harry, 대공포 사수 will. ElevenLabs의 설명만 보고 고른 것이라 **오너가 들어 보고 바꾼다**: `--voice Sarge=bill`.
- **검수:** Claude는 소리를 못 듣는다. 그래서 줄마다 받아쓰기(`elevenlabs/scribe-v2`)로 되돌려 대사와 비교한다. 80 % 아래면 `RETAKE`로 표시된다.
  - 다시 만들기: `--only L05 --force`
  - 효과만 다시 입히기: `--fx-only` (API를 부르지 않는다)
- **효과:** delivery 값에 따라 정한다.
  - `무전*` → 무전 효과. 320 Hz–3.2 kHz 대역, 압축, 약한 잡음. 게임의 무전(`src/audio/radio.ts`)과 같은 대역이다.
  - `슬로` → 먹먹하게(저역 통과 + 울림)
  - 나머지 → 근접 육성(가벼운 압축)
- **길이 초과:** 표의 `LONG`은 음악 칸(start–end)보다 0.3초 넘게 긴 줄이다. 시작을 당기거나 문장을 줄인다. 가장 센 타격(38.60 / 66.42 / 70.89 / 91.17 / 128.15)과 무음(69.90, 89.75–91.0)에는 말이 겹치면 안 된다. 바꾸면 `lines.json`과 trailer.md를 같이 고친다.
- **확인 범위:** 클라우드에서는 키가 없어 API 호출은 실행해 보지 못했다. 효과 처리와 길이 보고는 시험음으로 확인했다. 첫 실행에서 오류가 나면 `scripts/voice-generate.mjs`(실제로 쓰던 스크립트)와 비교한다.

### ④ 촬영 (오너)

**어디서 무엇을:** trailer.md 6장 표를 따른다. 컷, 맵, 주소, 찍을 것, 확인 여부가 있다.

**게임 쪽 도구** (2026-10-31에 만듦):
- **F2:** 촬영 모드. UI가 전부 사라진다.
- **`?nohud=1`:** 처음부터 촬영 모드로 시작한다.
- **`?at=x,z,방위` / `?at=x,y,z,방위`:** 배치할 때마다 그 자리에 선다. 싱글 매치만 되고, 진급 기록에 남지 않는다.
- **F3:** 현재 좌표와 방위가 나온다.

**녹화 설정 (OBS 등):**
- 1920×1080 이상, 60 fps.
- 게임 소리도 함께 녹음한다. 조립할 때 효과음으로 쓴다(컷마다 `gain`).
- 게임 화질은 높음 이상.

**파일 이름:** `assets-src/trailer/footage/S06_t1.mp4`처럼 컷 id와 몇 번째 시도인지. 여러 컷을 한 파일에 찍어도 된다.

**넉넉하게:** 컷 길이보다 앞뒤로 3–5초 더 찍는다. 슬로모션 컷(S20, S53)은 `speed 0.5`로 쓰므로 **두 배 길이**가 필요하다.

**UI 확인:** 찍은 영상에 UI가 한 프레임이라도 보이면 다시 찍는다(F2를 깜빡한 경우). 피격 붉은 화면과 스코프 렌즈는 UI가 아니라 남는다.

### ⑤ edit.json 채우기 (로컬 세션의 Claude)

```json
{
  "S6":  { "file": "footage/S06_t2.mp4", "in": 12.40, "gain": -6 },
  "S20": { "file": "footage/S20_t1.mp4", "in": 3.10, "speed": 0.5 },
  "S16": { "file": "footage/S15-16_t1.mp4", "in": 41.85 }
}
```

- **`in`:** 영상 파일에서 그 컷이 시작할 시점(초).
- **`gain`:** 그 컷 게임 소리의 크기(dB, 기본 -6).
- **`speed`:** 1보다 작으면 슬로모션.

**타격 컷의 원칙:** 컷 시작(`start`)이 음악의 타격이다. 그러니 영상 속 **사격 섬광, 폭발, 램프가 열리는 순간이 컷의 첫 프레임 근처**에 오게 `in`을 잡는다. 예를 들어 S16은 38.60초 타격에 포탄이 터지는 프레임이 와야 한다.

**찾는 법:**

```bash
node scripts/trailer/peek.mjs assets-src/trailer/footage/S16_t1.mp4 --from 30 --to 50
```

- 밝기가 갑자기 오르는 순간(섬광, 폭발) 10개를 시간과 함께 알려 준다.
- `assets-src/trailer/peek/`에 0.5초 간격 썸네일 판(시간 표시)을 만든다. Read로 열어 보고 고른다. 더 세밀하게 보려면 `--every 0.1`.

**길이 확인:** `node scripts/trailer/build.mjs --check`로 모든 컷에 영상이 충분히 있는지 본다(`TOO SHORT`가 없어야 한다).

### ⑥ 연출 컷 (FP·연출, CINE)

- **아직 도구가 없다.** 분대원이 정해진 자리에 있어야 하는 컷이 해당한다: S1–S3, S5, S14, S23, S52–S53과 CINE 컷들. 오너가 만들기로 하면 개발 전용 `?trailer=<컷>`을 만든다.
- **도구가 할 일:**
  - 고정 시드 매치에서 봇 위치·자세·행동을 고정한다.
  - 슬로모션은 시뮬 시간 배속으로 한다.
  - CINE 컷은 카메라 경로를 스크립트로 짜고, 메뉴 배경 영상처럼 프레임 단위로 렌더한다(`docs/menu-film.md`).
- **도구 없이 갈 때:** 오너가 비슷한 장면을 실플레이로 찍는다. 예를 들어 봇 분대와 함께 같은 자리에 서서 찍는다.

### ⑦ 최종 조립

```bash
node scripts/trailer/build.mjs
```

1. **화면 이어 붙이기:**
   - 컷마다 정확한 프레임 수(`round(end×30) − round(start×30)`)로 자른다.
   - 1920×1080, 30 fps로 맞추고(넘치는 부분은 잘라 냄) 이어 붙인다.
2. **소리:**
   - 원곡 위에 대사를 시작 시간에 놓는다.
   - 대사가 나올 때 음악을 자동으로 낮춘다(사이드체인).
   - 게임 소리를 섞고, 전체 음량을 −14 LUFS(유튜브 기준)로 맞춘다.
3. **위에 얹기:** 114.8–115.5초 일병 진급 그래픽, 자막(대사 시간 + 0.2초, 최소 0.8초).
4. **결과:** `trailer.mp4`(자막 입힘), `trailer_nosubs.mp4`(영상 사이트 자막 기능용), `subtitles.ko.srt`.

### ⑧ 점검 (Claude가 할 수 있는 것)

- **길이:**

  ```bash
  ffprobe -v error -show_entries format=duration -of csv=p=0 assets-src/trailer/out/trailer.mp4
  ```

  137.0이어야 한다.
- **타격 프레임:** 아래 시간마다 `ffmpeg -ss <t> -i trailer.mp4 -frames:v 1 x.png`로 직전·직후 프레임을 뽑아 Read로 본다. 컷이 바뀌었는지, 섬광이 맞는지 확인한다.
  - 0.33, 9.40, 10.10, 18.56, 23.24, 27.82, 32.17, 36.64, 38.60, 48.19
  - 57.25, 61.84, 64.14, 66.42, 68.52, 70.89, 89.27, 91.17, 100.70, 106.04
  - 116.86, 128.15, 132.39, 133.54
- **UI:** FP 컷마다 가운데 프레임을 하나씩 뽑아 미니맵, 크로스헤어, 숫자, 알림이 없는지 본다.
- **자막:** 겹치는 줄이 없는지, 영어 대사 시간과 맞는지(`lines.json`) 본다.
- **음량:**

  ```bash
  ffmpeg -i trailer.mp4 -af loudnorm=print_format=summary -f null -
  ```

  입력 I가 −14 근처여야 한다. 시험 조립은 −13.5 LUFS, 최대 피크 −0.5 dBTP였다.

### ⑨ 오너 시청

**Claude는 소리를 들을 수 없고 영상을 실시간으로 볼 수도 없다.** 아래는 반드시 오너가 보고 들어야 한다.
- 컷이 음악에 맞는 느낌
- 목소리의 연기와 무전 느낌
- 음악과 대사의 균형
- 전체 흐름

오너의 지적을 받아 ③–⑦을 반복한다.

## 4. 알려진 한계 (2026-10-31 기준)

- **클라우드에서 확인한 것 (2026-10-31):**
  - 그래픽 렌더 전부
  - 대체 화면, 시험음 목소리, 시험 영상(1440p 60 fps를 1080p 30 fps로)으로 끝까지 조립
    - 정확히 137.00초, 4,110프레임
    - 18.52 → 18.60초 컷 경계가 프레임 단위로 맞음
    - 슬로모션(speed 0.5), 자막과 진급 그래픽 얹기, SRT, 덕킹, 음량
    - 끝 화면의 마지막 자막이 로고와 겹치던 것을 고침
  - `peek.mjs`
- **실제로 돌려 보지 못한 것:** `voices.mjs`의 API 호출(키 없음), 실제 촬영 영상, 오너 PC의 ffmpeg 빌드 차이.
- **drawtext:** `peek.mjs`의 시간 표시는 ffmpeg의 drawtext와 TTF 글꼴이 필요하다. 없으면 시간 표시 없이 그린다(시간 = from + k × every).
- **장면 세팅 도구가 없다** (위 ⑥).
