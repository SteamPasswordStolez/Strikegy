# Strikegy TTS Proxy (OpenAI)

> 목적: GitHub Pages(정적)에서 **API Key를 숨기기 위해** 서버를 한 겹 두고, 클라에서는 `/tts`만 호출하도록 만들기.

## 1) 설치

```bash
cd server/tts-proxy-openai
npm i
```

## 2) 실행

```bash
# mac/linux
export OPENAI_API_KEY="YOUR_KEY"
export OPENAI_TTS_MODEL="gpt-4o-mini-tts"   # optional
export OPENAI_TTS_VOICE="marin"             # optional
npm start

# windows (powershell)
$env:OPENAI_API_KEY="YOUR_KEY"
$env:OPENAI_TTS_MODEL="gpt-4o-mini-tts"
$env:OPENAI_TTS_VOICE="marin"
npm start
```

기본 포트: `8787`

## 3) Strikegy 클라에서 연결

브라우저 콘솔에서 예시:

```js
window.ttsManager?.enable?.({
  endpoint: "http://localhost:8787/tts",
  apiKey: "",                 // 프록시 쓰면 비워둬도 됨
  defaultVoice: "marin",
});
```

이후 캠페인 대사에서 `tts: true`가 켜진 라인들은 TTS로 읽어줄 수 있음(기본은 꺼져있음).
