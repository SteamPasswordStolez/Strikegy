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
