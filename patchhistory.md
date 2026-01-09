# Patch History
이 파일은 기존에 흩어져 있던 각종 `*_NOTES.md`, `HF*.md` 등을 **통합**한 기록입니다.
> Generated: 2026-01-08 05:01:55
---

## Patch 4.0 Pre2 (Lobby/Campaign Shell Remaster)
```text
- 로비(index.html) UI를 BF 느낌 + CoD 톤 하이브리드로 리마스터
  - 버튼 7개 확정: Campaign / Zone Control / Conquest / Frontline / Settings / Help / Credits
  - 키보드 네비게이션: ↑↓ 이동, Enter 선택, ESC 닫기
  - 모드 버튼 클릭 시 selectedMode 저장 → 병과 선택 모달 → game.html 진입

- 캠페인(campaign.html) 메뉴 리마스터
  - 좌측 Chapter 네비게이션(버튼) 추가, 기존 챕터 필터(select)와 동기화
  - 캠페인 배경 이미지 슬롯(assets/ui/bg/campaign.webp)

- UI 리소스 슬롯 추가
  - assets/ui/shell.css (공통 셸 스타일)
  - assets/ui/README.txt (배경/효과음 배치 가이드)

- 문서 정리
  - 루트/서버/문서 내 흩어진 *_NOTES.md 등을 제거/정리하고 readme.md + patchhistory.md만 유지

NOTE: 브라우저 자동재생 정책으로 인해 BGM이 차단될 수 있음.
      이 경우 첫 클릭/키입력에서 자동으로 재시도하도록 처리됨.
```

## HF9-C-1_Notes.md
```text
# Patch 3 Campaign HF9-C-1

## 목표
- Chapter 1 미션 목표가 바뀐 것에 맞춰 **캠페인 맵 JSON을 실제 목표 지점/상호작용 지점 중심으로 재배치**.
- 각 맵에 `campaign.triggers`를 추가/정비해서 웨이포인트/인터랙션이 **임의 좌표가 아니라 맵에 실제로 존재하는 지점**을 가리키도록 함.
- 목표 지점에 최소한의 **시각적 세트피스(deco/cover/wall)**를 배치해서 “해킹/서버룸/트럭/옥상/참호 태그/헬기 LZ” 등 분위기 체감 강화.

## 변경된 파일
- `maps/campaign/ch1_m1_insertion.json`
- `maps/campaign/ch1_m2_blacksite.json`
- `maps/campaign/ch1_m3_convoy.json`
- `maps/campaign/ch1_m4_bridge.json`
- `maps/campaign/ch1_m5_city.json`
- `maps/campaign/ch1_m6_trench.json`
- `maps/campaign/ch1_m7_ridge.json`
- `maps/campaign/ch1_m8_counter.json`
- `maps/campaign/ch1_m9_lab.json`
- `maps/campaign/ch1_m10_exodus.json`

## 핵심 요약
- **CH1 전 미션**: o1~o5 트리거(필요한 것만) + rally/exfil을 맵에 실존 좌표로 반영.
- **세트피스 추가(간단 버전)**
  - M1: 중계기(안테나/콘솔) + 펜스/장비 커버
  - M2: 출입문/키패드 + 서버랙/터미널
  - M3: 트럭(커버) + 케이스 표시
  - M4: 교량 잔해/엄폐물 + 고정 화점 커버
  - M5: 옥상 플랫폼(간이 계단) + 카메라 허브 콘솔
  - M6: 태그 회수 지점 표시 + 참호 엄폐 보강
  - M7: 중계장치/폭약 포인트 표시 + 엄폐 보강
  - M8: 전환기(스위치) 표시 + 터널 탈출 마커
  - M9: 정문 게이트 + 전원 차단(브레이커) + VIP/봉쇄 포인트 표시
  - M10: 헬기 LZ 패드 + 엄폐 + 탑승 구역 마커
```

## HF9-C-3a_Notes.md
```text
# Strikegy Campaign — Patch 3 Camp HF9-C-3a

## 핵심 변경
1) **오프라인 한국어→영어 변환(내장 매핑) 도입**
- `Strikegy_Campaign_Chapter2_HF9A_EN_dialogue.md` + 기존 `CampaignData.js`의 대사 순서를 기반으로, **한국어 원문 대사를 영어로 매핑하는 데이터**를 생성해 내장했습니다.
- 설정이 `en`일 때, 대사(`say`/`cutscene`/`step.lines`)가 한글이면 **내장 매핑으로 영어로 변환**하여 자막 + TTS가 함께 영어로 나옵니다.
- `en` 필드가 **빈 문자열**인 경우에도 대사가 스킵되지 않도록 처리했습니다.

2) **체크포인트 재시작/이어하기 시 목표 체크(체크리스트) 복원**
- 목표 완료 상태를 세션에 저장하는 v2 구조 추가:
  - `session.progress.missionStates[missionId].objectivesDone`
- 체크포인트로 재시작/이어하기해도 **이미 완료한 목표가 체크된 상태로 복원**됩니다.
- 추가로 `stepIndex` 기준으로 이전 스텝의 `objectiveKey` 완료를 자동 추론해 체크합니다.

## 변경 파일
- `src/campaign/CampaignRuntime.js`
- `src/campaign/CampaignTranslationKOEN.js` (신규)

## 다음(C-3b 예정)
- 캠페인 메뉴에서 **클리어한 챕터/미션 다시 플레이**
- MW식 **타임라인/히스토리(미리보기/잠금 표시 포함)**
- 무전/귓속말/로컬 음질 필터(가능한 범위) 강화
```

## PATCH_0-F_NOTES.md
```text
# Patch 0-F — Foundation Reset (MP 제거 + 싱글 캠페인 전환)

## 목표
- 멀티플레이(WebSocket/Room/Sync) 관련 코드와 페이지를 제거하고, 프로젝트를 **싱글(기존 모드 유지) + 캠페인 진입점** 구조로 고정합니다.

## 변경 사항
- `index.html`
  - 멀티플레이 버튼 제거 → `campaign.html`(캠페인 진입) 버튼으로 대체
- `campaign.html` (신규)
  - 캠페인 진입점(새 게임/이어하기/로비)
  - 임시로 localStorage에 `strikegy_campaign_v0` 세션을 저장하고 `game.html?campaign=1`로 이동
- `game.html`
  - 멀티플레이 부트스트랩(`src/net/MPBootstrap.js`) import/call 제거
- 삭제
  - `multiplay.html`, `multigame.html`, `room.html`
  - `src/net/` 전체
  - `WSS_PROXY_SETUP.md`

## 유지(중요)
- 기존 싱글 모드(로비에서 선택 → `game.html`로 진입) 흐름은 그대로 유지됩니다.

## 다음 패치 제안
- Patch 1-G: 그래픽 기준선(야외 낮) + 캠페인 예외 프로필(실내/야간 등) 프리셋 구조 도입
```

## PATCH_1-G2_HF1_NOTES.md
```text
# Patch 1-G2 HF1

## Fixes
- Fixed browser error: `Failed to resolve module specifier "three"`.
  - Added an **import map** in `game.html` that maps the bare specifier `three` to the same CDN URL used elsewhere.
  - This allows Three.js `examples/jsm` modules (EffectComposer/FXAA/Bloom) to load in the browser without a bundler.

## Notes
- The import map also helps avoid accidentally loading multiple Three.js instances.
```

## PATCH_1-G2_HF2_NOTES.md
```text
# Patch 1-G2 HF2

## Fixes
- Removed deprecated `renderer.useLegacyLights` assignment (three r155+ warning).
- Reduced PMREMGenerator `sigmaRadians` from `0.06` to `0.04` to avoid sample clipping warnings.
- Clamped FXAAShader LOD bias from `-100.0` to `-8.0` at runtime to prevent WebGL program warnings on some GPUs.

## Notes
- These are warning-level fixes; functionality remains unchanged.
```

## PATCH_1-G2_NOTES.md
```text
# Patch 1-G2 — Visual Realism Upgrade (Perf-first)

**목표:** 그래픽 체감 개선(현실감) + 프레임 우선(B 90% / A 10%)

## 변경 사항
- **PostFX 추가 (가벼운 구성)**
  - FXAA(저비용 AA) 기본 ON
  - Subtle Bloom(하이라이트만 아주 약하게) 기본 ON
  - Indoor/Outdoor 프로필에 따라 Bloom 파라미터 자동 튜닝
- **렌더 성능 기본값**
  - renderer pixelRatio 상한을 2 → **1.5**로 낮춰 프레임 안정성 확보(고해상도 모니터에서 효과 큼)
- **런타임 토글**
  - `window.setPostFX({ enabled:true/false, fxaa:true/false, bloom:true/false })`
  - 상태는 localStorage(`strikegy_postfx_v1`)에 저장됨

## 테스트
- `game.html?map=maps/gfx_outdoor_day_v1.json`
- `game.html?map=maps/gfx_indoor_facility_v1.json`

## 기대 체감
- 에지 깔끔(FXAA)
- 금속/밝은 표면의 하이라이트가 살짝 살아남(약한 Bloom)
- 프레임은 최대한 지키면서 “10% AAA 감성”만 얹는 구성
```

## PATCH_1-G3_NOTES.md
```text
# Patch 1-G3 — Visual Realism (Performance-first)

목표: **프레임(B 90%)을 최대한 지키면서**, 맵의 현실감(실감)을 빠르게 끌어올리는 가성비 패치.

이번 패치는 무거운 SSAO/SSR 같은 고비용 효과 대신,
**(1) 타일 반복 깨기 + (2) 전장 잡티(데칼)** 두 축으로 체감을 올립니다.

---

## 1) Macro Variation (타일 반복 깨기)
- 바닥/벽/엄폐물 머티리얼에 **월드 좌표 기반 저주파 노이즈**를 적용.
- 중/원거리에서 보이는 **반복 패턴(타일링)**이 확 줄어듭니다.
- 비용: 텍스처 1회 샘플링 + 간단한 곱 연산(매우 저렴).

기본 적용값:
- ground: scale 0.006 / strength 0.20
- wall:   scale 0.010 / strength 0.14
- cover:  scale 0.012 / strength 0.10

---

## 2) Decals (전장 잡티)
- **얼룩(stain) / 균열(crack) / 그을음(scorch) / 탄흔(bullet)** 데칼을 자동 산포.
- 방식: 투명 Plane + polygonOffset (z-fighting 방지)
- 그림자/콜리전 없음 (성능 우선)
- 맵 로드 시 이전 데칼을 자동 제거하여 누적되지 않음.

자동 배치:
- 바닥: 얼룩/균열/그을음 랜덤 산포 (실내는 개수 감소)
- 벽/엄폐물: 얇은 면 방향 기준으로 탄흔 1~3개씩 랜덤

---

## 테스트
- Outdoor: `game.html?map=maps/gfx_outdoor_day_v1.json`
- Indoor:  `game.html?map=maps/gfx_indoor_facility_v1.json`

---

## 참고
- 더 강한 "A" 스타일로 가려면: (다음 선택지)
  - 데칼 종류/밀도 확장 + 근거리 디테일 노말(Detail Normal)
  - 또는 SSAO(품질/성능 토글 포함) 추가
```

## PATCH_1-G_HF1_NOTES.md
```text
# Patch 1-G HF1 (Hotfix)

## Fixes
- **Fix:** `applyVisualProfile()` 무한 재귀 호출로 인한 `RangeError: Maximum call stack size exceeded` 해결
  - 프로필 적용 로직을 실제로 구현(렌더러/안개/환경맵/기본 조명 2종 + 맵 포인트라이트)
  - 맵 리로드 시 라이트가 누적되지 않도록 scene.userData에 라이트 참조/정리 로직 추가

- **Fix:** `WARNING: Multiple instances of Three.js being imported` 해결
  - src 내부 모듈들의 Three.js import URL을 **단일 스펙(https://unpkg.com/three@0.160.0/build/three.module.js)** 로 통일

## Notes
- 이 핫픽스는 Patch 1-G의 그래픽 베이스라인 사양을 변경하지 않고, **오류/안정성**만 수정합니다.
```

## PATCH_1-G_NOTES.md
```text
# Patch 1-G — Graphics Baseline (멀티 삭제 이후 비주얼 강화 1차)

목표: **멀티플레이를 전면 포기**하고, 싱글/캠페인 중심으로 가기 위한 “그래픽 기반”을 먼저 깔아두는 패치.

## 1) 렌더러 기본값 업그레이드
- Color management 활성화 (`THREE.ColorManagement.enabled = true`)
- PBR 기준 세팅
  - `outputColorSpace = SRGB`
  - `toneMapping = ACESFilmic`
  - `physicallyCorrectLights = true`
  - `PCFSoftShadowMap`
- 텍스처 **anisotropy** 자동 적용 (필터링 품질 개선)

## 2) “비주얼 프로필” 도입
- `outdoor_day` (기본) / `indoor` 두 프로필 제공
- 프로필이 다음을 한 번에 세팅:
  - 배경색 + 안개(Fog)
  - Hemisphere + Directional(태양) 조명
  - 그림자 카메라/맵 크기
  - 환경광(간이 환경맵) 생성 후 `scene.environment` 적용
  - 프로필별 노출(exposure) 조절

> 맵 JSON에서 `world.visualProfile`로 선택:
> - `"visualProfile": "outdoor_day"`
> - `"visualProfile": "indoor"`

## 3) 월드 소재(PBR) 개선
- 기존 단색 Lambert 느낌에서
- **procedural(캔버스) 타일 텍스처 기반** PBR 재질로 변경
  - Dirt(지면), Concrete(벽), Metal(엄폐물)
  - `map + bumpMap` 사용 (외부 에셋 없이도 “질감 느낌” 확보)

## 4) 실내 캠페인용 추가 광원 지원
- 맵 JSON의 `world.pointLights`를 읽어 PointLight 자동 생성

## 5) 샘플 맵 2개 추가
- `maps/gfx_outdoor_day_v1.json`
- `maps/gfx_indoor_facility_v1.json`

실행 예시(쿼리로 맵 선택):
- `game.html?map=maps/gfx_outdoor_day_v1.json`
- `game.html?map=maps/gfx_indoor_facility_v1.json`

---

다음 패치(예정):
- 1인칭 무기(팔/총) **뷰모델(ViewModel)** 시스템 1차
- AI 캡슐에서 **저폴리/중폴리 프록시 모델**로 교체 + 애니메이션 뼈대(간이)
- 벽/바닥/엄폐물 “실제 텍스처 팩” 적용(용량/라이선스 고려)
```

## PATCH_11-A_NOTES.md
```text
# Patch 11-A — 멀티플레이 페이지 분리 + 메인 버튼 연결 + 설정 정리 + WSS 가이드

## 변경 요약
- index.html: 멀티플레이 버튼 활성화 → `multiplay.html`로 이동
- multiplay.html: 멀티플레이 로비/방 UI (WS)
- 모드 목록: Patch 10-A 기준으로 `zone / conquest / frontline` 반영
- GAME_START 시 `selectedMode`를 localStorage에 반영하여 game.html이 해당 모드로 시작하도록 준비
- GitHub Pages(https)에서 필요한 WSS 프록시 가이드 문서 추가: `WSS_PROXY_SETUP.md`

## 추가 파일
- multiplay.html
- src/net/LobbyWSClient.js
- src/net/multiplay-ui.js
- src/net/MPBootstrap.js
- WSS_PROXY_SETUP.md
```

## PATCH_11-C_NOTES.md
```text
# Patch 11-C (Lobby/Room UI 분리)

## 포함 내용
- `multiplay.html`
  - 멀티플레이 진입 시 **자동으로** `wss://ws.strikegy.org/ws` 연결 (로컬 저장된 URL이 있으면 그걸 우선)
  - **방 생성/참가**를 버튼 + **모달** 형태로 변경
  - 방 생성 옵션: 방 이름, 최대 인원, 비공개, 비밀번호(옵션)
- `room.html`
  - 방 관리 페이지 분리 (대기실 UI)
  - 설정 가능한 항목(요구사항 반영)
    - 봇 사용 여부(토글)
    - (Zone) 티켓
    - (공통) 리스폰 시간
    - 경제: 시작 돈, 상한, 30초당 획득, 킬, 점령(200/n)
  - **안전장치**: “밸런스 변경 이해” 체크 후에만 적용 버튼 활성화

## 주의(서버 측)
현재 서버가 **‘방이 비면 즉시 삭제’**라면,
- 방 생성 후 `room.html`로 이동하는 순간(페이지 전환) 방이 사라져서 `ROOM_NOT_FOUND`가 날 수 있어요.
- 11-D에서 서버에 TTL(예: 마지막 플레이어가 나간 후 60초 유지) 또는 “호스트가 room.html로 이동해도 방 유지” 로직을 넣으면 완전 해결됩니다.
```

## PATCH_9-3C_NOTES.md
```text
# Strikegy Patch 9-3C (Checkpoint)

이번 체크포인트는 **Patch 9-3B**(FixConquest_BotPerception_WeaponSwitch) 기반으로,
경제 시스템을 전투/오브젝트 행동과 연결하고, 봇 네비게이션을 한 번 더 다듬는 방향으로 들어갑니다.

## ✅ 경제 시스템 연동 (요청 반영)
- Kill: **+300**
- Damage: **입힌 데미지 1당 +$1**
  - Headshot: **데미지 보상 2배** (예: 30 dmg 헤드샷 = $60)
- Zone Capturing(게이지가 실제로 움직일 때만): **1초당 +$10**
- Zone Capture(존 점령 완료 시): **+200**

구현 포인트:
- `src/data/economy.js`에 보상 상수 추가/조정
- `src/game/EconomyManager.js`에 reward API 추가
- `src/game/ModeSystem.js`에 capture 이벤트 스트림(`consumeEvents`) 추가 → `game.html`에서 경제 보상 처리
- `game.html`에서 플레이어가 가한 피해/킬/점령 행위에 대해 `EconomyManager` 호출

> NOTE: 현재 싱글(플레이어+봇) 구조에서 **플레이어 경제만 반영**되도록 설계되어 있음.
> (봇 경제는 아직 구매/AI쪽으로 확장 가능)

## ✅ 봇 네비게이션 보강 (벽 비빔 완화)
- Path look-ahead(LOS면 코너 스킵) 추가로 **불필요한 꺾임 감소**
- `_computeAvoidance`에 **최근 벽 충돌 보정(impulse)** 추가로 벽에 붙는 현상 완화

관련 파일:
- `src/bots/BotManager.js`

---

이 체크포인트 파일명은 “9-3C” 기준으로 저장해 두고,
여기서부터 **교전 조건/AI 사고/길찾기 전면 고도화**를 더 깊게 들어가면 됨.
```

## docs/HF9-B2_TTS_SETUP.md
```text
# HF9-B2 TTS 세팅 (선택)

HF9-B2는 캠페인 대사에 **고급 TTS**를 붙일 수 있도록 `TTSManager`(클라이언트) + `tts-proxy`(서버 예시)를 포함합니다.

> 기본값은 **TTS OFF** 입니다. (요금/키/네트워크 이슈 방지)

---

## 1) 서버 프록시 실행 (OpenAI TTS 예시)

폴더: `server/tts-proxy-openai/`

1. Node.js 18+ 설치
2. 폴더로 이동 후 설치

```bash
cd server/tts-proxy-openai
npm install
```

3. 환경변수 설정 후 실행

```bash
# Windows PowerShell
$env:OPENAI_API_KEY="YOUR_KEY"
$env:OPENAI_TTS_MODEL="gpt-4o-mini-tts"
$env:OPENAI_TTS_VOICE="marin"
npm start
```

기본 포트: `8787`

헬스체크:
- `GET /health`

TTS 엔드포인트:
- `POST /tts`
- body: `{ "text": "...", "voice": "marin" }`

---

## 2) 클라이언트에서 TTS 켜기

게임 실행 후 개발자 콘솔에서 아래처럼 켜면 됩니다.

```js
// 로컬 테스트
window.ttsManager?.enable({
  endpoint: 'http://localhost:8787/tts',
  voice: 'marin'
});

// 끄기
window.ttsManager?.disable();
```

---

## 3) 캠페인 스크립트에서 사용 방식

HF9-B2는 컷신/무전 대사를 표시할 때,
- 텍스트 UI + 무전 SFX
- (옵션) TTS 음성

을 함께 재생할 수 있도록 연결돼 있습니다.

> 실제로 어떤 라인에 TTS를 붙일지는, 미션 스크립트에서 `tts: true` 같은 플래그를 넣거나,
> `CampaignRuntime`에서 특정 화자/채널만 TTS로 읽게 하는 방식으로 확장하면 됩니다.

---

## 주의
- GitHub Pages(정적 호스팅)에서는 서버 프록시를 실행할 수 없습니다. (별도 서버 필요)
- CORS는 개발 편의상 `*`로 열어뒀습니다. 배포 시에는 도메인 제한을 추천합니다.
```

## server/tts-proxy-openai/README.md
```text
# Strikegy TTS Proxy (OpenAI)

> 목적: GitHub Pages(정적)에서 **API Key를 숨기기 위해** 서버를 한 겹 두고, 클라에서는 `/tts`만 호출하도록 만들기.

## 1) 설치

```bash
cd server/tts-proxy-openai
npm i
```

## 2) 실행

```bash
# mac/linux
export OPENAI_API_KEY="YOUR_KEY"
export OPENAI_TTS_MODEL="gpt-4o-mini-tts"   # optional
export OPENAI_TTS_VOICE="marin"             # optional
npm start

# windows (powershell)
$env:OPENAI_API_KEY="YOUR_KEY"
$env:OPENAI_TTS_MODEL="gpt-4o-mini-tts"
$env:OPENAI_TTS_VOICE="marin"
npm start
```

기본 포트: `8787`

## 3) Strikegy 클라에서 연결

브라우저 콘솔에서 예시:

```js
window.ttsManager?.enable?.({
  endpoint: "http://localhost:8787/tts",
  apiKey: "",                 // 프록시 쓰면 비워둬도 됨
  defaultVoice: "marin",
});
```

이후 캠페인 대사에서 `tts: true`가 켜진 라인들은 TTS로 읽어줄 수 있음(기본은 꺼져있음).
```

---

# Legacy TXT Notes (merged)

## PATCH_NOTES_2-FP-VM-PROTO.txt
```text
Patch 2-FP-VM-PROTO (Procedural Viewmodels Upgrade)
- Base: Patch2-FP-hf2
- Goal: Make weapons/throwables look more distinct WITHOUT changing inventory/slots/rules.

Changes:
- src/fp/ViewModelSystem.js
  - Procedural weapon meshes upgraded per class (AR/SMG/LMG/SG/SR/PISTOL)
  - Throwables now have 4 silhouettes based on weaponId string: frag/flash/smoke/impact
  - No changes to slots, inventory structure, or weapon logic.
```

## PATCH_NOTES_2-FP.txt
```text
Patch 2-FP (First-Person ViewModel Core)
- Added ViewModelSystem: low-poly glove hands + procedural weapon placeholders
- Supports: primary/secondary guns (AR/SMG/LMG/SG/DMR/SR/PISTOL), grenade, class gadget, melee knife
- Animations: idle micro-movement, look sway, move bob, ADS lerp, reload pose, recoil kick on shot
- Viewmodel always renders on top (depthTest/depthWrite disabled) for FPS feel
Files:
- src/fp/ViewModelSystem.js (new)
- game.html (import + init + tick + recoil hook)
```

## PATCH_NOTES_3-CAMP.txt
```text
# Patch 3-CAMP (Campaign Framework v1)

목표: 캠페인 모드의 **별도 맵 네임스페이스 + 난이도 + 미션 로더**의 최소 골격을 만든다.
(본격 스토리/연출/컷신/대사/체크포인트/세이브는 다음 패치에서 확장)

## 변경 사항
- `campaign.html`
  - 새 캠페인/이어하기 버튼 정리
  - 난이도 선택(쉬움/보통/어려움) 추가
  - `localStorage: strikegy_campaign_v1` 세션 저장
  - 기본 미션: `c1_m1_insertion`

- `game.html`
  - `campaign=1` 쿼리 지원
  - 캠페인 미션 레지스트리(CAMPAIGN_MISSIONS) 추가
  - 캠페인 전용 맵 경로 강제: `maps/campaign/...`
  - 캠페인 난이도 반영
    - 플레이어가 주는 피해량 배수(playerDamage)
    - 플레이어가 받는 피해량 배수(enemyDamage)
  - 캠페인에서는 ModeSystem(Zone/Conquest/Frontline 룰) 비활성화
  - 캠페인 미션별 봇 수를 오버라이드

- `maps/campaign/ch1_m1_insertion.json`
  - 캠페인 전용 테스트 맵(기존 zone 맵 기반 복제)

## 사용법
- 로비 → Campaign 진입
- 난이도 선택 후 "새 캠페인 시작"
- 자동으로 `game.html?campaign=1` 로 이동
```
