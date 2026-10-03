# Strikegy

브라우저 FPS. Vite + TypeScript + Three.js + Rapier. 전신 프로젝트(Strikegy p1)를 새 구조로 다시 작성하는 중입니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173  주소에 맵이 없으면 로비 (맵·모드·인원·난이도·설정)
                   # 바로 시작: ?map=sandbox&bots=4v5&difficulty=normal, ?bots=0 = 사격장
                   # 모드: ?map=iron_gate&bots=12v12 (&mode=zone|frontline|conquest, 없으면 맵 기본값;
                   #   &tickets=300 = 티켓 직접 지정, &mode=skirmish = 거점 없이 교전만)
                   # 맵: iron_gate, ardennes(겨울 숲), lyon(초원 10v10), bilbao(시가지, 정복전용), persia(사막 1v1~2v2)
npm run maps       # scripts/maps/*.mjs로 생성형 맵 JSON 다시 만들기
npm test           # Vitest 단위 테스트
npm run lint
npm run build      # tsc 검사 + dist/ 빌드 (scripts/clean.mjs로 dist 정리)
```

`main`에 push하면 GitHub Actions가 lint → test → build를 돌리고 GitHub Pages로 배포합니다(`.github/workflows/deploy.yml`).

## 조작

| 입력 | 동작 |
|---|---|
| WASD / Shift / Ctrl(C) / Space | 이동 / 달리기 / 앉기 / 점프 |
| 좌클릭 / 우클릭 / R | 사격 / 조준 / 재장전 |
| 1·2·3, 마우스 휠 | 무기 전환 (주무기 1·2, 권총). 정찰은 스코프 조준 중 휠로 배율 1.5배 전환 |
| G | 투척물 (배치 화면에서 고른 한 종류) |
| Q | 구급통 (체력을 가득 채움; 의무는 무한·15초 쿨타임) |
| E (길게) / E | 쓰러진 아군 부활 / (의무) 구급통 없는 아군에게 구급통 주기 |
| E / E (길게) | 거점 보급소에서 탄약·구급통 받기 (아군 거점, 5회) / (지원) 탄약 보급소·(의무) 의무대 채우기 |
| T | 건설 모드 켜기/끄기: 망치를 들고 빈 건설 자리를 조준한 뒤 좌클릭을 누르고 있으면 짓습니다 |
| E (탈것 옆) / 1–4 / WASD·Space / C | 탈것 타기·내리기 / 자리 바꾸기 / 운전·브레이크 / 1인칭·3인칭 (사수석은 시점으로 조준, 좌클릭 사격) |
| 전투기: 마우스 / W·S / 좌·우클릭 / E | 기수가 시점 방향으로 돎 / 추력 / 기관포(폭탄)·보조무기(미사일, 로켓) / 지상으로 탈출 |
| B | 전장 지원 메뉴(분대장): 1–5로 고르고 좌클릭으로 조준한 곳에 요청 (분대 RP 사용) |
| 4 | 병과 장비 꺼내기/넣기, 좌클릭으로 사용: 돌격 판처파우스트, 의무 소총 연막탄, 정찰 리스폰 신호기·대인지뢰 (탄약 보급소에서 다시 채움) |
| Space (길게, 쓰러졌을 때) | 포기하고 배치 화면으로 |
| X (누르고 있기, 스코프 조준 중) | 숨 참기: 5초 동안 흔들림이 거의 없어지고, 더 참으면 눈앞이 점점 어두워짐 |
| V / ~ | 근접 공격(개머리판) / 총기 점검 |
| Z (누르고 있기) | 점수판 |
| F3 / F4 | 성능 패널 / 그래픽 품질 전환 |

봇전에서는 배치 화면 오른쪽에서 병과(돌격·의무·지원·정찰)와 주무기 2개·권총·투척물을 고르고, 다음 배치부터 적용됩니다(병과별로 저장). 사격장(`?bots=0`)과 `?sandbox`는 모든 총을 들고 시작합니다(1–9). 체력이 0이 되면 쓰러지고, 15초 안에 아군이 살려 주면 티켓이 줄지 않습니다.

모바일: 왼쪽 드래그로 이동하고, 오른쪽 드래그로 시점을 돌립니다. 사격/조준/점프/장전/앉기/근접/투척/구급통은 버튼으로 하고, 쓰러진 아군 옆에서는 가운데에 나타나는 부활 버튼을 길게 누릅니다(보급소에서도 같은 버튼이 나타납니다). 건설 자리 근처에서는 구급통 버튼 옆에 건설 버튼이 나타나고, 건설 모드에서는 사격 버튼을 누르고 있으면 짓습니다.
 오른쪽 위 탄약 표시를 탭하면 총기를 점검하고, 위쪽 가운데 거점 표시를 탭하면 점수판이 열리고 닫힙니다. 일시정지 화면의 '버튼 배치 바꾸기'에서 버튼을 끌어 옮기고 크기를 바꿀 수 있습니다(기기에 저장).

## 에셋

`public/assets/`에는 [Poly Haven](https://polyhaven.com)의 **CC0** 에셋을 최적화해서 넣었습니다(WebP 텍스처, meshopt로 압축한 GLB).
목록은 `assets.manifest.json`에 있습니다. 원본을 다시 받아서 재생성하려면:

```bash
npm run assets     # assets-src/에 다운로드(git 제외) → public/assets/로 최적화
```

사운드는 `sounds.manifest.json`에 적힌 CC0 소스를 쓰며 `npm run sounds`(7-Zip, ffmpeg 필요)로 다시 만듭니다.

| 사운드 | 출처 (CC0) |
|---|---|
| 총성 | [The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library) — Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney |
| 발소리·탄착음 | [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) |
| 폭발음 | [Basic Sound Effects](https://opengameart.org/content/basic-sound-effects) (OpenGameArt) |

그래픽 품질: 자동(내장 GPU는 Medium) · 게임 중 **F4**로 Low/Medium/High 전환 · 프레임이 떨어지면 해상도를 자동으로 낮춥니다.

텍스처를 불러오지 못하면 절차적으로 생성한 텍스처로, 모델을 불러오지 못하면 그 모델만 빼고 게임이 계속 동작합니다.

## 구조

```
src/
  core/      Game(오케스트레이션), FixedStepLoop(60Hz), EventBus, Settings
  input/     InputState(장치 무관 액션), KeyboardMouse, Touch
  physics/   PhysicsWorld(Rapier, 충돌 레이어, 레이캐스트)
  player/    Player(캐릭터 컨트롤러), movement(순수 이동 수학)
  weapons/   weaponData(밸런스), WeaponState(순수 발사/장전 로직), WeaponController, ViewModel
  combat/    Hitboxes(부위 판정), CharacterHitboxes(플레이어·봇 공용), TargetDummy
  ai/        NavWorld(recast navmesh), Bot(인지·판단·이동·사격), brain(utility AI), aim·difficulty, BotManager(분대·엄폐·사격 판정), SoldierModel(절차적 스킨 메시)
  render/    Renderer, PostFX(후처리), visualProfiles(하늘/IBL/태양), surfaces·textures(절차적 PBR), Effects
  world/     mapTypes(맵 스키마 v2), validateMap, buildBlockout, terrain(지형·다각형 경계), buildings(진입 가능한 건물 생성), backdrop(원경 지형·나무)
  modes/     zoneRules(점령 순수 로직), matchRules(Zone 점수·Frontline·Conquest 규칙), ZoneMode(모드 선택·스폰·봇 목표), zoneVisuals(거점 표시)
  audio/     AudioSystem(임시 합성 SFX)
  ui/        HUD, Overlay
  i18n/      ko.json / en.json
public/maps/ 맵 JSON (sandbox 외에는 scripts/maps/*.mjs가 생성)
tests/       단위 테스트
```

원칙:
- 시뮬레이션은 고정 스텝으로 돌리고, 렌더에서만 보간합니다.
- 시스템 간 통신은 EventBus로 합니다.
- 게임 로직은 DOM이나 Three.js에 의존하지 않게 작성해서 테스트할 수 있게 합니다.
- 전역 `window`에 핫패치를 붙이지 않습니다. dev 빌드에서만 `window.__strikegy` 디버그 핸들을 둡니다.

## 로드맵

- [x] M0 셋업
- [x] M1 FPS 코어 샌드박스
- [x] G1 그래픽 1차: 물리 기반 하늘/구름 + IBL, 절차적 PBR 텍스처, GTAO/Bloom/SMAA/색보정, 추적 그림자, 원경 지형, 1인칭 팔
- [x] G2 그래픽 2차 (1단계): 스캔 텍스처 5종 + 소품 모델 7종 + 저격총 1인칭 모델 (Poly Haven CC0)
- [x] G3 그래픽 3차: 총기 정밀 모델링(프로파일 압출·선반 가공 부품, 레드닷/홀로/스코프/아이언), 실사 권총(Poly Haven), 절차적 침엽수 숲 + 원거리 임포스터, 숲 바닥 소품
- [x] G4: 봇 캐릭터 모델 (절차적 스킨 메시, 1인칭 총기 재사용)
- [x] M2 전투: 반동 패턴·탄퍼짐, 표면별 탄착·탄피, 수류탄 3종, 피격/사망/리스폰, 킬피드, 3D 합성 사운드, 1인칭 애니메이션
- [x] M2+ 실제 녹음 사운드(CC0) 교체 + 성능 최적화(동적 해상도, 인스턴싱, 반해상도 AO)
- [x] M3 봇 AI: navmesh(recast), 시야·소리 인지, utility AI(교전/엄폐/재장전/추격/조사/진격), 분대 목표·측면 우회, 난이도 3단계
- [ ] M4 모드: Zone/Conquest/Frontline, 병과, 경제/상점, 로비
- [ ] M5 모바일/성능: 터치 HUD 다듬기, 자동 품질, Rapier WASM 분리 로딩(번들 축소)
- [ ] M6 캠페인 프레임워크 (새 스토리)
- [ ] M7 콘텐츠 / 폴리싱
