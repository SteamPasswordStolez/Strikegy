# Strikegy — Patch 4.0 Pre2 체크포인트

이 체크포인트는 **Patch 4.0 Pre2(로비/캠페인 셸 리마스터 단계)** 기준으로 정리된 프로젝트 상태입니다.

## UI 배경 이미지(선택)
아래 경로에 배경 이미지를 넣으면 로비/캠페인 메뉴에 적용됩니다.

- 로비: `assets/ui/bg/lobby.webp`
- 캠페인: `assets/ui/bg/campaign.webp`

## BGM 파일 넣는 위치
아래 경로에 mp3 파일을 넣으면 됩니다.

- `assets/audio/bgm/Lobby.mp3`
- `assets/audio/bgm/Briefing.mp3`
- `assets/audio/bgm/Sneaking.mp3`
- `assets/audio/bgm/Engaging.mp3`

> 브라우저 자동재생 정책으로 인해 BGM이 차단될 수 있습니다.
> 이 경우 첫 클릭/키입력에서 자동으로 재시도합니다.

## 문서 정리 규칙
MD 문서는 루트에 아래 2개만 유지합니다.

- `readme.md` (이 파일)
- `patchhistory.md` (기존에 흩어진 노트 통합본)

기존 `PATCH_*_NOTES.md`, `HF*_Notes.md` 등은 모두 제거하고 `patchhistory.md`로 통합했습니다.

## 실행
- 로컬 서버(Live Server 등)로 `index.html`을 실행하는 방식으로 사용합니다.

