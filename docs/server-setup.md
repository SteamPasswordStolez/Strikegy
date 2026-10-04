# 게임 서버 설치 (오너 노트북, Ubuntu Server)

멀티플레이 게임 서버를 오너의 리눅스 노트북에 설치하는 순서입니다. 게임 파일(사이트)은 GitHub Pages가 내보내고, 노트북은 방 목록과 경기만 맡습니다.

노트북 사용자 이름은 `steampasswordstolen`, 저장소 위치는 `~/strikegy`로 적었습니다. 다르면 아래 명령과 `server/strikegy.service`를 고쳐 주세요.

## 1. Node 22와 git

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node --version   # v22 이상
```

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

## 7. 업데이트

```bash
cd ~/strikegy
git pull
npm ci
npm run nav
sudo systemctl restart strikegy
```
