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
