[Strikegy Patch 4.0 Pre2] UI 리소스 안내

이 폴더는 로비/캠페인 셸(메뉴)에서 쓰는 배경/효과음을 넣기 위한 슬롯입니다.

1) 배경 이미지
- 로비 배경:   assets/ui/bg/lobby.webp
- 캠페인 배경: assets/ui/bg/campaign.webp

* 확장자는 webp를 권장하지만 png/jpg로 쓰고 싶으면
  shell.css에서 --sg-bg-image / --sg-campaign-image 값을 바꾸면 됩니다.

2) UI 효과음(선택)
- assets/ui/sfx/ui_hover.mp3
- assets/ui/sfx/ui_click.mp3
- assets/ui/sfx/ui_back.mp3 (없어도 동작)

3) BGM
- Lobby.mp3, Briefing.mp3, Sneaking.mp3, Engaging.mp3 는
  프로젝트 루트(또는 기존 경로)에 사용자가 직접 넣는 방식으로 유지했습니다.
  (브라우저 정책 때문에 자동재생이 막히면 첫 클릭/키입력에서 재시도합니다.)
