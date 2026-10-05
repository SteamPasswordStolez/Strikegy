// Checks match data over UDP against a running game server, the way a browser
// does it: `node scripts/udpCheck.mjs [ws-url]` (default the local server;
// e.g. wss://game.strikegy.xyz/play for the real one through the Oracle relay).
// Opens a room with bots, starts it, asks for the data channel and counts the
// snapshots that come over it for a few seconds while sending inputs on it.
import WebSocket from 'ws';
import { RTCPeerConnection } from 'node-datachannel/polyfill';

const url = process.argv[2] ?? 'ws://localhost:8787/play';
const version = Number(process.argv[3] ?? 10);
const ws = new WebSocket(url);
const send = (m) => ws.send(JSON.stringify(m));
let pc = null;
let dc = null;
let udpSnaps = 0;
let wsSnaps = 0;
let opened = 0;
let seq = 0;
let pump = null;
let ack = 0;
const pending = [];
const t0 = Date.now();

ws.on('message', async (data, isBinary) => {
  if (isBinary) return void wsSnaps++;
  const m = JSON.parse(data.toString());
  if (m.t === 'welcome') {
    send({ t: 'create', settings: { name: 'udp check', map: 'lyon', mode: 'zone', size: 8, lineup: 'usersBots', difficulty: 'normal', input: 'all', botShare: false } });
    setTimeout(() => send({ t: 'start' }), 300);
  } else if (m.t === 'match') {
    send({ t: 'ready' });
    send({ t: 'rtc' });
  } else if (m.t === 'error') console.log('error', m.code, m.detail ?? '');
  else if (m.t === 'rtc') {
    if (m.sdp) {
      pc = new RTCPeerConnection({ iceServers: m.stun ? [{ urls: `stun:${m.stun}` }] : [] });
      pc.ondatachannel = (e) => {
        dc = e.channel;
        dc.binaryType = 'arraybuffer';
        dc.onopen = () => {
          opened = Date.now();
          console.log(`data channel open after ${opened - t0} ms`);
          // Standing-still inputs at 60 a second over the channel: the server acks them in its snapshots.
          pump = setInterval(() => {
            const f = new DataView(new ArrayBuffer(2 + 28));
            f.setUint8(0, 1);
            f.setUint8(1, 1);
            f.setUint32(2, ++seq);
            if (dc.readyState === 'open') dc.send(new Uint8Array(f.buffer));
          }, 1000 / 60);
        };
        dc.onmessage = (e) => {
          udpSnaps++;
          const v = new DataView(e.data);
          if (v.getUint8(5) === 1) ack = v.getUint32(6);
        };
      };
      pc.onicecandidate = (e) => e.candidate?.candidate && send({ t: 'rtc', cand: e.candidate.candidate, mid: e.candidate.sdpMid ?? '0' });
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
ws.on('open', () => send({ t: 'hello', v: version, name: 'udpcheck', uid: `udpcheck-${Date.now()}-0123456789`, device: 'desktop' }));

setTimeout(() => {
  console.log(opened ? `over ${((Date.now() - opened) / 1000).toFixed(1)} s: ${udpSnaps} snapshots by UDP, ${wsSnaps} by WebSocket since the start; ${seq} inputs sent by UDP, the server stepped up to ${ack}` : `no data channel (${wsSnaps} snapshots by WebSocket)`);
  clearInterval(pump);
  send({ t: 'leave' });
  pc?.close();
  ws.close();
  setTimeout(() => process.exit(0), 300);
}, Number(process.argv[4] ?? 20000));
