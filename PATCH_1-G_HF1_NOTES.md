# Patch 1-G HF1 (Hotfix)

## Fixes
- **Fix:** `applyVisualProfile()` 무한 재귀 호출로 인한 `RangeError: Maximum call stack size exceeded` 해결
  - 프로필 적용 로직을 실제로 구현(렌더러/안개/환경맵/기본 조명 2종 + 맵 포인트라이트)
  - 맵 리로드 시 라이트가 누적되지 않도록 scene.userData에 라이트 참조/정리 로직 추가

- **Fix:** `WARNING: Multiple instances of Three.js being imported` 해결
  - src 내부 모듈들의 Three.js import URL을 **단일 스펙(https://unpkg.com/three@0.160.0/build/three.module.js)** 로 통일

## Notes
- 이 핫픽스는 Patch 1-G의 그래픽 베이스라인 사양을 변경하지 않고, **오류/안정성**만 수정합니다.
