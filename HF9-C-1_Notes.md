# Patch 3 Campaign HF9-C-1

## 목표
- Chapter 1 미션 목표가 바뀐 것에 맞춰 **캠페인 맵 JSON을 실제 목표 지점/상호작용 지점 중심으로 재배치**.
- 각 맵에 `campaign.triggers`를 추가/정비해서 웨이포인트/인터랙션이 **임의 좌표가 아니라 맵에 실제로 존재하는 지점**을 가리키도록 함.
- 목표 지점에 최소한의 **시각적 세트피스(deco/cover/wall)**를 배치해서 “해킹/서버룸/트럭/옥상/참호 태그/헬기 LZ” 등 분위기 체감 강화.

## 변경된 파일
- `maps/campaign/ch1_m1_insertion.json`
- `maps/campaign/ch1_m2_blacksite.json`
- `maps/campaign/ch1_m3_convoy.json`
- `maps/campaign/ch1_m4_bridge.json`
- `maps/campaign/ch1_m5_city.json`
- `maps/campaign/ch1_m6_trench.json`
- `maps/campaign/ch1_m7_ridge.json`
- `maps/campaign/ch1_m8_counter.json`
- `maps/campaign/ch1_m9_lab.json`
- `maps/campaign/ch1_m10_exodus.json`

## 핵심 요약
- **CH1 전 미션**: o1~o5 트리거(필요한 것만) + rally/exfil을 맵에 실존 좌표로 반영.
- **세트피스 추가(간단 버전)**
  - M1: 중계기(안테나/콘솔) + 펜스/장비 커버
  - M2: 출입문/키패드 + 서버랙/터미널
  - M3: 트럭(커버) + 케이스 표시
  - M4: 교량 잔해/엄폐물 + 고정 화점 커버
  - M5: 옥상 플랫폼(간이 계단) + 카메라 허브 콘솔
  - M6: 태그 회수 지점 표시 + 참호 엄폐 보강
  - M7: 중계장치/폭약 포인트 표시 + 엄폐 보강
  - M8: 전환기(스위치) 표시 + 터널 탈출 마커
  - M9: 정문 게이트 + 전원 차단(브레이커) + VIP/봉쇄 포인트 표시
  - M10: 헬기 LZ 패드 + 엄폐 + 탑승 구역 마커
