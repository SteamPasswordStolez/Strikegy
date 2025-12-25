# WSS 프록시 설정 (GitHub Pages에서 멀티 연결용)

GitHub Pages는 https로 서비스되기 때문에 브라우저가 `ws://`(평문 웹소켓)를 차단합니다.
따라서 `wss://`(TLS 웹소켓)로 접속할 수 있도록 서버 앞단에 프록시를 둡니다.

## 권장 구조
- 게임(클라): GitHub Pages (https)
- 멀티 서버: OCI 인스턴스 `localhost:3000` (ws)
- 프록시: 같은 OCI에서 443으로 TLS 종료 → 3000으로 리버스 프록시
- 클라 접속 URL: `wss://<도메인>/ws`

## 0) DNS 준비 (필수)
1. 도메인 하나 준비 (예: `ws.multong.xyz`)
2. A 레코드로 OCI 공용 IP(161.33.12.159) 지정
3. 443 포트(인바운드) 오픈 (OCI Security List/NSG + UFW)

## 1) Caddy로 가장 쉽게 (추천)
### 설치
Ubuntu에서:
```bash
sudo apt update
sudo apt install -y caddy
```

> 만약 apt에 caddy가 없거나 버전이 너무 낮으면, caddy 공식 저장소 방식으로 설치하세요.

### Caddyfile (예시)
`/etc/caddy/Caddyfile`:
```caddy
ws.multong.xyz {
  encode zstd gzip
  @ws path /ws
  reverse_proxy @ws 127.0.0.1:3000

  # 헬스체크(선택)
  respond /health 200
}
```

### 적용
```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl enable --now caddy
```

### 테스트
```bash
curl -I https://ws.multong.xyz/health
```
클라에서는 `wss://ws.multong.xyz/ws` 입력.

## 2) Nginx로도 가능 (대안)
```bash
sudo apt update
sudo apt install -y nginx
```

### (중요) TLS 인증서
Nginx는 LetsEncrypt(certbot)로 인증서 발급이 필요합니다.

### 서버 블록(개념)
- `/ws`로 들어온 요청을 3000으로 프록시
- `Upgrade` / `Connection` 헤더를 그대로 전달

> Nginx는 환경별 설정이 많아서, Caddy를 먼저 추천합니다.

## 3) multiplay.html에서 설정
- 멀티 페이지의 서버 URL 입력에 `wss://<도메인>/ws`를 넣고 연결
- 한번 입력하면 로컬스토리지에 저장되어 다음 접속부터 자동으로 채워집니다.
