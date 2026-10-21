// Checks match data over UDP against a running game server, the way a browser
// does it: `node scripts/udpCheck.mjs [ws-url] [version] [ms] [cut-ms] [heal-ms] [health-ms]`
// (default the local server; e.g. wss://game.strikegy.xyz/play for the real one
// through the Oracle relay). Opens a room with bots, starts it, asks for the
// data channel and counts the snapshots that come over it while sending inputs
// on it, with the browser's channel check (ServerLink / server/rtc.ts: each end
// tells the other whether it hears the channel, `{t:'rtc', rx}`, and sends
// down it only while the other end does). With `cut-ms` the channel goes dead
// silently at that moment (nothing taken from it or put on it, as when a home
// router drops its NAT entry) and comes back at `heal-ms`: the snapshots
// should move to the WebSocket and back.
import WebSocket from 'ws';
import { RTCPeerConnection } from 'node-datachannel/polyfill';

const url = process.argv[2] ?? 'ws://localhost:8787/play';
const version = Number(process.argv[3] ?? 15);
const length = Number(process.argv[4] ?? 20000);
const cutAt = Number(process.argv[5] ?? Infinity);
const healAt = Number(process.argv[6] ?? Infinity);
// Optional accelerated health reports exercise long connections (>80 reports)
// in a short run, including a subsequent loss that must still reach the relay.
const healthEvery = Math.max(125, Number(process.argv[7] ?? 0));
const RX = 600;
const PROBE = 250;
const ws = new WebSocket(url);
const send = (m) => ws.send(JSON.stringify(m));
let pc = null;
let dc = null;
let opened = 0;
let seq = 0;
let ack = 0;
let lastIn = -Infinity;
let heard = false;
let peerHears = false;
let lastProbe = -Infinity;
const pending = [];
const t0 = Date.now();
const dead = () => {
  const t = Date.now() - t0;
  return t >= cutAt && t < healAt;
};
/** Snapshots a second by each way, per second since the start. */
const log = [];
const tally = (way) => {
  const s = Math.floor((Date.now() - t0) / 1000);
  log[s] ??= { udp: 0, ws: 0, upUdp: 0, upWs: 0 };
  log[s][way]++;
};
let lastReport = -Infinity;
const report = () => {
  const now = dc?.readyState === 'open' && Date.now() - lastIn < RX;
  if (now === heard && Date.now() - lastReport < 1000) return;
  heard = now;
  lastReport = Date.now();
  send({ t: 'rtc', rx: now });
};

// Pump independently of UDP opening: the match must work over TCP throughout.
const pump = setInterval(() => {
  if (ws.readyState !== ws.OPEN || !playing) return;
  report();
  const f = new DataView(new ArrayBuffer(2 + 28));
  f.setUint8(0, 1);
  f.setUint8(1, 1);
  f.setUint32(2, ++seq);
  const bytes = new Uint8Array(f.buffer);
  const up = dc?.readyState === 'open' && !dead();
  if (up && peerHears && heard) {
    dc.send(bytes);
    tally('upUdp');
    return;
  }
  if (up && Date.now() - lastProbe >= PROBE) {
    lastProbe = Date.now();
    dc.send(bytes);
  }
  ws.send(bytes);
  tally('upWs');
}, 1000 / 60);
let playing = false;
const health = process.argv[7] ? setInterval(() => {
  if (playing && ws.readyState === ws.OPEN) send({ t: 'rtc', rx: heard });
}, healthEvery) : null;

ws.on('message', async (data, isBinary) => {
  if (isBinary) {
    tally('ws');
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (v.getUint8(5) === 1) ack = v.getUint32(6);
    return;
  }
  const m = JSON.parse(data.toString());
  if (m.t === 'welcome') {
    send({
      t: 'create',
      settings: {
        name: 'udp check',
        map: 'lyon',
        mode: 'zone',
        size: 8,
        lineup: 'usersBots',
        difficulty: 'normal',
        input: 'all',
        botShare: false,
      },
    });
    setTimeout(() => send({ t: 'start' }), 300);
  } else if (m.t === 'match') {
    send({ t: 'ready' });
    playing = true;
    send({ t: 'rtc' });
  } else if (m.t === 'error') console.log('error', m.code, m.detail ?? '');
  else if (m.t === 'rtc') {
    if (typeof m.rx === 'boolean') {
      peerHears = m.rx;
      console.log(
        `${((Date.now() - t0) / 1000).toFixed(1)} s: the server ${m.rx ? 'hears' : 'no longer hears'} the channel`,
      );
    } else if (m.sdp) {
      pc = new RTCPeerConnection({ iceServers: m.stun ? [{ urls: `stun:${m.stun}` }] : [] });
      pc.ondatachannel = (e) => {
        dc = e.channel;
        dc.binaryType = 'arraybuffer';
        dc.onopen = () => {
          opened = Date.now();
          console.log(`data channel open after ${opened - t0} ms`);
        };
        dc.onmessage = (e) => {
          if (dead()) return;
          lastIn = Date.now();
          report();
          tally('udp');
          const v = new DataView(e.data);
          if (v.getUint8(5) === 1) ack = v.getUint32(6);
        };
      };
      pc.onicecandidate = (e) =>
        e.candidate?.candidate &&
        send({ t: 'rtc', cand: e.candidate.candidate, mid: e.candidate.sdpMid ?? '0' });
      await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ t: 'rtc', sdp: answer.sdp, type: 'answer' });
      for (const c of pending.splice(0)) await pc.addIceCandidate(c);
    } else if (m.cand) {
      const c = { candidate: m.cand, sdpMid: m.mid ?? '0' };
      if (pc?.remoteDescription) await pc.addIceCandidate(c);
      else pending.push(c);
    }
  }
});
ws.on('open', () =>
  send({
    t: 'hello',
    v: version,
    name: 'udpcheck',
    uid: `udpcheck-${Date.now()}-0123456789`,
    device: 'desktop',
  }),
);

setTimeout(() => {
  clearInterval(pump);
  if (health !== null) clearInterval(health);
  console.log('second: snapshots in by UDP / WebSocket, inputs out by UDP / WebSocket');
  log.forEach(
    (s, i) =>
      s &&
      console.log(
        `${String(i).padStart(3)}: in ${s.udp} / ${s.ws}, out ${s.upUdp} / ${s.upWs}${i * 1000 >= cutAt && i * 1000 < healAt ? '  (channel dead)' : ''}`,
      ),
  );
  console.log(
    `${seq} inputs sent, the server stepped up to ${ack}${opened ? '' : ' (TCP only, no data channel)'}`,
  );
  send({ t: 'leave' });
  pc?.close();
  ws.close();
  setTimeout(() => process.exit(0), 300);
}, length);
