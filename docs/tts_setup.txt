# HF9-B2 TTS 세팅 (선택)

HF9-B2는 캠페인 대사에 **고급 TTS**를 붙일 수 있도록 `TTSManager`(클라이언트) + `tts-proxy`(서버 예시)를 포함합니다.

> 기본값은 **TTS OFF** 입니다. (요금/키/네트워크 이슈 방지)

---

## 1) 서버 프록시 실행 (OpenAI TTS 예시)

폴더: `server/tts-proxy-openai/`

1. Node.js 18+ 설치
2. 폴더로 이동 후 설치

```bash
cd server/tts-proxy-openai
npm install
```

3. 환경변수 설정 후 실행

```bash
# Windows PowerShell
$env:OPENAI_API_KEY="YOUR_KEY"
$env:OPENAI_TTS_MODEL="gpt-4o-mini-tts"
$env:OPENAI_TTS_VOICE="marin"
npm start
```

기본 포트: `8787`

헬스체크:
- `GET /health`

TTS 엔드포인트:
- `POST /tts`
- body: `{ "text": "...", "voice": "marin" }`

---

## 2) 클라이언트에서 TTS 켜기

게임 실행 후 개발자 콘솔에서 아래처럼 켜면 됩니다.

```js
// 로컬 테스트
window.ttsManager?.enable({
  endpoint: 'http://localhost:8787/tts',
  voice: 'marin'
});

// 끄기
window.ttsManager?.disable();
```

---

## 3) 캠페인 스크립트에서 사용 방식

HF9-B2는 컷신/무전 대사를 표시할 때,
- 텍스트 UI + 무전 SFX
- (옵션) TTS 음성

을 함께 재생할 수 있도록 연결돼 있습니다.

> 실제로 어떤 라인에 TTS를 붙일지는, 미션 스크립트에서 `tts: true` 같은 플래그를 넣거나,
> `CampaignRuntime`에서 특정 화자/채널만 TTS로 읽게 하는 방식으로 확장하면 됩니다.

---

## 주의
- GitHub Pages(정적 호스팅)에서는 서버 프록시를 실행할 수 없습니다. (별도 서버 필요)
- CORS는 개발 편의상 `*`로 열어뒀습니다. 배포 시에는 도메인 제한을 추천합니다.
