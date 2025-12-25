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
