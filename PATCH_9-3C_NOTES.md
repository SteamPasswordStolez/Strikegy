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
