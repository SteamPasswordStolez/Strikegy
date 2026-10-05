# 게임 서버 설치 (오너 노트북, Ubuntu Server)

멀티플레이 게임 서버를 오너의 리눅스 노트북에 설치하는 순서입니다. 게임 파일(사이트)은 GitHub Pages가 내보내고, 노트북은 방 목록과 경기만 맡습니다.

노트북 사용자 이름은 `steampasswordstolen`, 저장소 위치는 `~/strikegy`로 적었습니다. 다르면 아래 명령과 `server/strikegy.service`를 고쳐 주세요.

## 1. Node 22와 git

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node --version   # v20.19 이상이면 됨 (Vite 8 기준)
```

이미 Node 20.19 이상이 깔려 있고 다른 서비스(pm2 등)가 그 Node를 쓰면 올리지 마세요. 시스템 Node를 바꾸면 그 서비스들의 네이티브 모듈이 재시작할 때 깨질 수 있습니다. 오너 노트북은 2026-10-04 기준 Node 20.20.2로 설치·실행 중입니다.

## 2. 저장소 받기와 준비

```bash
git clone -b v2 https://github.com/SteamPasswordStolez/Strikegy.git ~/strikegy
cd ~/strikegy
npm ci
npm run nav      # navmesh 미리 굽기 (노트북에서 1~2분)
```

## 3. 한 번 돌려 보기

```bash
npm run server
# 다른 창에서
curl localhost:8787/health   # {"ok":true,...} 가 나오면 정상
```

`Ctrl+C`로 끕니다.

## 4. 성능 재기 (결과를 Claude에게 알려 주세요)

```bash
npm run server:bench -- iron_gate 32
npm run server:bench -- iron_gate 64
```

`step: avg ... ms`가 방 하나의 한 스텝(1/60초)에 드는 시간입니다. 이 숫자로 방 하나의 인원 상한을 정합니다.

## 5. 항상 켜 두기 (systemd)

```bash
sudo cp ~/strikegy/server/strikegy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now strikegy
systemctl status strikegy        # active (running)
journalctl -u strikegy -f        # 로그 보기
```

## 6. 밖에서 들어오게 하기

게임 페이지가 https라서 서버 주소도 반드시 `wss://`(인증서 있음)여야 합니다. `ws://집IP:8787`은 브라우저가 막습니다.

### 시험용: Cloudflare 빠른 터널 (도메인 없이)

```bash
curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel --url http://localhost:8787
```

`https://xxxx.trycloudflare.com` 주소가 나옵니다. **`wss://xxxx.trycloudflare.com/play`를 Claude에게 알려 주세요.** 터널을 다시 켤 때마다 주소가 바뀌니 시험용입니다.

### 오래 쓸 때: 도메인 + Cloudflare 터널

도메인을 Cloudflare에 연결한 뒤:

```bash
cloudflared tunnel login
cloudflared tunnel create strikegy
cloudflared tunnel route dns strikegy play.<도메인>
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: strikegy
credentials-file: /home/steampasswordstolen/.cloudflared/<터널 ID>.json
ingress:
  - hostname: play.<도메인>
    service: http://localhost:8787
  - service: http_status:404
```

```bash
sudo cloudflared service install
```

주소는 `wss://play.<도메인>/play`입니다. 공유기 포트는 열지 않아도 되고, 집 IP도 드러나지 않습니다.

터널 토큰과 인증 파일(`~/.cloudflared/*.json`)은 노트북에만 두고, 채팅에 붙여넣지 마세요.

### 지금 설정 (2026-10-04)

`strikegy.xyz`는 Cloudflare에 있고, `play` CNAME이 노트북에 이미 있던 터널(`d6dacf46…cfargotunnel.com`, howtoboard.com과 같은 터널)을 가리킵니다. 노트북 `/etc/cloudflared/config.yml` ingress에 `play.strikegy.xyz → http://localhost:8787`이 들어 있습니다(바꾸기 전 파일: `config.yml.bak-strikegy-20261004`). 게임은 `public/servers.json`에서 `wss://play.strikegy.xyz/play`를 읽습니다. 이 노트북의 `cert.pem`은 howtoboard.com용이라 `cloudflared tunnel route dns`로는 strikegy.xyz 레코드를 만들지 말고 대시보드에서 넣으세요.

### 지금 설정: 오사카 중계 (2026-10-04)

Cloudflare 무료 플랜은 한국 접속을 LAX(로스앤젤레스)로 보내 왕복이 450 ms(가끔 수 초)였습니다. 그래서 게임 서버는 오라클 클라우드 오사카의 무료 E2.1.Micro(`129.225.175.80`, `ssh ubuntu@...`)를 거칩니다(왕복 약 80 ms). 집 IP는 드러나지 않습니다.

- DNS: `game.strikegy.xyz` A → 129.225.175.80, **DNS only**(회색 구름)
- 중계 서버: Caddy(`/etc/caddy/Caddyfile`: `game.strikegy.xyz { reverse_proxy 127.0.0.1:18787 }`, 인증서 자동), iptables에 80/443 허용(`netfilter-persistent save`), 오라클 보안 목록 80/443
- 노트북 → 중계: `server/strikegy-relay.service`(SSH 역방향 터널, 키 `~/.ssh/strikegy_relay`). 중계 서버의 `tunnel` 계정은 `127.0.0.1:18787` 전달만 허용(`/home/tunnel/.ssh/authorized_keys`의 `restrict,port-forwarding,permitlisten=...`)
- 게임은 `public/servers.json`의 첫 주소 `wss://game.strikegy.xyz/play`, 안 되면 예전 터널 주소로
- UDP(2026-10-05): 경기 데이터는 WebRTC 데이터 채널로도 오갑니다. 노트북 서버는 오라클의 TURN(coturn, `/etc/turnserver.conf`, 3478/udp, 중계 포트 50000-50199/udp)에만 로그인해 그 중계 주소만 알리므로 집 IP는 드러나지 않습니다. 브라우저는 같은 곳의 STUN으로 자기 주소를 찾습니다. TURN 계정 비밀번호는 오라클 `/etc/strikegy-turn.pass`와 노트북 `~/.strikegy-turn.json`(권한 600)에만 있습니다(git·채팅에 넣지 않음). 이 파일이 없으면 UDP 없이 WebSocket만 씁니다. 오라클 iptables에 3478, 50000:50199/udp 허용(`netfilter-persistent save`), 오라클 보안 목록에도 같은 UDP 포트가 열려 있어야 합니다. 확인: `node scripts/udpCheck.mjs wss://game.strikegy.xyz/play`

## 7. 업데이트

```bash
cd ~/strikegy
git pull
npm ci
npm run nav
sudo systemctl restart strikegy
```
