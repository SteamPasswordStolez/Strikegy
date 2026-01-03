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
