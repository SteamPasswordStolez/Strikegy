# Strikegy Campaign — Patch 3 Camp HF9-C-3a

## 핵심 변경
1) **오프라인 한국어→영어 변환(내장 매핑) 도입**
- `Strikegy_Campaign_Chapter2_HF9A_EN_dialogue.md` + 기존 `CampaignData.js`의 대사 순서를 기반으로, **한국어 원문 대사를 영어로 매핑하는 데이터**를 생성해 내장했습니다.
- 설정이 `en`일 때, 대사(`say`/`cutscene`/`step.lines`)가 한글이면 **내장 매핑으로 영어로 변환**하여 자막 + TTS가 함께 영어로 나옵니다.
- `en` 필드가 **빈 문자열**인 경우에도 대사가 스킵되지 않도록 처리했습니다.

2) **체크포인트 재시작/이어하기 시 목표 체크(체크리스트) 복원**
- 목표 완료 상태를 세션에 저장하는 v2 구조 추가:
  - `session.progress.missionStates[missionId].objectivesDone`
- 체크포인트로 재시작/이어하기해도 **이미 완료한 목표가 체크된 상태로 복원**됩니다.
- 추가로 `stepIndex` 기준으로 이전 스텝의 `objectiveKey` 완료를 자동 추론해 체크합니다.

## 변경 파일
- `src/campaign/CampaignRuntime.js`
- `src/campaign/CampaignTranslationKOEN.js` (신규)

## 다음(C-3b 예정)
- 캠페인 메뉴에서 **클리어한 챕터/미션 다시 플레이**
- MW식 **타임라인/히스토리(미리보기/잠금 표시 포함)**
- 무전/귓속말/로컬 음질 필터(가능한 범위) 강화
