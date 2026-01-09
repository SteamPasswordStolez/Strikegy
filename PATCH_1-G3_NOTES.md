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
