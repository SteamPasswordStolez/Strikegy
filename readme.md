# Strikegy

브라우저 FPS. Vite + TypeScript + Three.js + Rapier. 전신 프로젝트(Strikegy p1)를 새 구조로 다시 작성하는 중입니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173  (?map=sandbox)
npm test           # Vitest 단위 테스트
npm run lint
npm run build      # tsc 검사 + dist/ 빌드 (scripts/clean.mjs로 dist 정리)
```

`main`에 push하면 GitHub Actions가 lint → test → build를 돌리고 GitHub Pages로 배포합니다(`.github/workflows/deploy.yml`).

## 조작 (샌드박스)

| 입력 | 동작 |
|---|---|
| WASD / Shift / Ctrl(C) / Space | 이동 / 달리기 / 앉기 / 점프 |
| 좌클릭 / 우클릭 / R | 사격 / 조준 / 재장전 |
| 1–9, Q, 마우스 휠 | 무기 전환 |
| G / T | 수류탄 투척 / 종류 변경(파편·섬광·연막) |
| F3 | FPS·좌표 표시 |

모바일: 왼쪽 드래그로 이동하고, 오른쪽 드래그로 시점을 돌립니다. 사격/조준/점프/장전/앉기는 버튼으로 합니다.

## 에셋

`public/assets/`에는 [Poly Haven](https://polyhaven.com)의 **CC0** 에셋을 최적화해서 넣었습니다(WebP 텍스처, meshopt로 압축한 GLB).
목록은 `assets.manifest.json`에 있습니다. 원본을 다시 받아서 재생성하려면:

```bash
npm run assets     # assets-src/에 다운로드(git 제외) → public/assets/로 최적화
```

텍스처를 불러오지 못하면 절차적으로 생성한 텍스처로, 모델을 불러오지 못하면 그 모델만 빼고 게임이 계속 동작합니다.

## 구조

```
src/
  core/      Game(오케스트레이션), FixedStepLoop(60Hz), EventBus, Settings
  input/     InputState(장치 무관 액션), KeyboardMouse, Touch
  physics/   PhysicsWorld(Rapier, 충돌 레이어, 레이캐스트)
  player/    Player(캐릭터 컨트롤러), movement(순수 이동 수학)
  weapons/   weaponData(밸런스), WeaponState(순수 발사/장전 로직), WeaponController, ViewModel
  combat/    Hitboxes(부위 판정), TargetDummy
  render/    Renderer, PostFX(후처리), visualProfiles(하늘/IBL/태양), surfaces·textures(절차적 PBR), Effects
  world/     mapTypes(맵 스키마 v2), validateMap, buildBlockout, backdrop(원경 지형·나무)
  audio/     AudioSystem(임시 합성 SFX)
  ui/        HUD, Overlay
  i18n/      ko.json / en.json
public/maps/ 맵 JSON
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
- [ ] G3 그래픽 3차: 캐릭터/총기 모델 확장, 데칼 확장, 동적 해상도
- [x] M2 전투: 반동 패턴·탄퍼짐, 표면별 탄착·탄피, 수류탄 3종, 피격/사망/리스폰, 킬피드, 3D 합성 사운드, 1인칭 애니메이션
- [ ] M2+ 실제 녹음 사운드(CC0) 교체
- [ ] M3 봇 AI: navmesh(recast), 인지, utility AI, 분대 전술
- [ ] M4 모드: Zone/Conquest/Frontline, 병과, 경제/상점, 로비
- [ ] M5 모바일/성능: 터치 HUD 다듬기, 자동 품질, Rapier WASM 분리 로딩(번들 축소)
- [ ] M6 캠페인 프레임워크 (새 스토리)
- [ ] M7 콘텐츠 / 폴리싱
