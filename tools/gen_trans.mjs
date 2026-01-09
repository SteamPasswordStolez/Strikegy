import fs from 'fs';
import { CampaignDB } from '../src/campaign/CampaignData.js';

const mdPath = '/mnt/data/Strikegy_Campaign_Chapter2_HF9A_EN_dialogue.md';
const md = fs.readFileSync(mdPath, 'utf8');

function mapTagToBracket(tag){
  const t = String(tag||'').toLowerCase();
  if(t.includes('무전') || t === 'radio') return '[radio]';
  if(t.includes('속삭') || t === 'whisper') return '[whisper]';
  if(t.includes('잡음') || t.includes('static') || t === 'noise') return '[noise]';
  if(t.includes('hq') || t.includes('본부') || t.includes('analysis')) return '[hq]';
  if(t.includes('오버워치') || t.includes('overwatch')) return '[overwatch]';
  if(t.includes('인터콤') || t.includes('intercom') || t.includes('내부')) return '[intercom]';
  return ''; // unknown
}

function extractDialogueLinesFromMd(block){
  const out = [];
  const lines = block.split(/\r?\n/);
  for(const line of lines){
    // dialogue-ish lines: bullet or numbered + contains **NAME** and ':'
    if(!/\*\*[^*]+\*\*/.test(line)) continue;
    const m = line.match(/^\s*(?:-|\d+\.)\s+.*?\*\*[^*]+\*\*.*?:\s*(.+?)\s*$/);
    if(!m) continue;

    let text = String(m[1]||'').trim();
    // capture comms tag like *[무전]* before ':'
    const tagM = line.match(/\*\[([^\]]+)\]\*/);
    if(tagM){
      const br = mapTagToBracket(tagM[1]);
      if(br) text = (br + ' ' + text).trim();
    }
    if(text) out.push(text);
  }
  return out;
}

function parseMdByMission(mdText){
  const missions = {};
  const re = /^###\s+.*?\(`([^`]+)`\)\s*$/gm;
  const idx = [];
  let m;
  while((m = re.exec(mdText))){
    idx.push({ missionId: m[1], start: m.index });
  }
  for(let i=0;i<idx.length;i++){
    const cur = idx[i];
    const next = idx[i+1];
    const end = next ? next.start : mdText.length;
    const block = mdText.slice(cur.start, end);
    missions[cur.missionId] = extractDialogueLinesFromMd(block);
  }
  return missions;
}

function extractKoreanLinesFromCampaign(mission){
  const out = [];
  const steps = Array.isArray(mission?.script) ? mission.script : [];
  for(const step of steps){
    if(step?.type === 'cutscene' && Array.isArray(step?.lines)){
      for(const ln of step.lines){
        if(ln && typeof ln.text === 'string') out.push(ln.text);
      }
    }
    if(step?.type === 'say' && typeof step?.text === 'string'){
      out.push(step.text);
    }
    if(Array.isArray(step?.lines)){
      for(const ln of step.lines){
        if(ln && typeof ln.text === 'string') out.push(ln.text);
      }
    }
  }
  return out;
}

function stripLeadingBracketTag(s){
  const mm = String(s||'').trim().match(/^\[[^\]]+\]\s*(.*)$/);
  return (mm ? mm[1] : String(s||'')).trim();
}

function normalizeKey(s){
  return stripLeadingBracketTag(s)
    .replace(/\s+/g,' ')
    .replace(/[“”]/g,'"')
    .replace(/[‘’]/g,"'")
    .trim();
}

const mdByMission = parseMdByMission(md);

const missionStates = {}; // missionId -> { koKey: en }
const globalMap = {}; // koKey -> en

for(const [mid, m] of Object.entries(CampaignDB?.missions || {})){
  const enLines = mdByMission[mid];
  if(!enLines || !enLines.length) continue;
  const koLines = extractKoreanLinesFromCampaign(m);
  if(!koLines.length) continue;

  const n = Math.min(koLines.length, enLines.length);
  const dict = {};
  for(let i=0;i<n;i++){
    const ko = String(koLines[i]||'').trim();
    const en = String(enLines[i]||'').trim();
    if(!ko || !en) continue;
    const key = normalizeKey(ko);
    if(!key) continue;
    if(!dict[key]) dict[key] = en;
    if(!globalMap[key]) globalMap[key] = en;
  }
  missionStates[mid] = dict;
}

const fallbackPairs = [
  ['웨이포인트', 'waypoint'],
  ['확인.', 'Copy.'],
  ['확인', 'Copy'],
  ['좋아.', 'Good.'],
  ['좋아', 'Good'],
  ['계속 간다.', 'Keep moving.'],
  ['계속 간다', 'Keep moving'],
  ['조심.', 'Stay sharp.'],
  ['조심', 'Stay sharp'],
];

function dumpObj(obj, indent='  '){
  return JSON.stringify(obj, null, 2).replace(/^/gm, indent).trimStart();
}

const outPath = new URL('../src/campaign/CampaignTranslationKOEN.js', import.meta.url).pathname;

const js = `// src/campaign/CampaignTranslationKOEN.js\n// Auto-generated from Strikegy_Campaign_Chapter2_HF9A_EN_dialogue.md + CampaignData.js\n// 목적: 영어 자막/TTS를 위해 한국어 대사를 (best-effort) 오프라인 매핑으로 변환\n\nexport const KO_EN_BY_MISSION = ${JSON.stringify(missionStates, null, 2)};\n\nexport const KO_EN_GLOBAL = ${JSON.stringify(globalMap, null, 2)};\n\nfunction stripLeadingBracketTag(s){\n  const m = String(s||'').trim().match(/^\\[[^\\]]+\\]\\s*(.*)$/);\n  return (m ? m[1] : String(s||'')).trim();\n}\n\nfunction normalizeKey(s){\n  return stripLeadingBracketTag(s)\n    .replace(/\\s+/g,' ')\n    .replace(/[“”]/g,'\\"')\n    .replace(/[‘’]/g,"'")\n    .trim();\n}\n\nfunction hasHangul(s){\n  return /[가-힣]/.test(String(s||''));\n}\n\n// very small fallback for unmapped short lines\nfunction phraseFallback(ko){\n  let out = String(ko||'');\n${fallbackPairs.map(([a,b])=>`  out = out.split(${JSON.stringify(a)}).join(${JSON.stringify(b)});`).join('\n')}\n  return out;\n}\n\nexport function translateKOtoEN(raw, missionId=''){\n  const full = String(raw||'').trim();\n  if(!full) return full;\n\n  // Preserve leading [채널] 태그는 그대로 두고 본문만 변환\n  let tag = '';\n  let body = full;\n  const m = full.match(/^(\\[[^\\]]+\\])\\s*(.*)$/);\n  if(m){\n    tag = m[1];\n    body = (m[2]||'').trim();\n  }\n\n  // 이미 영문이면 그대로\n  if(!hasHangul(body)) return full;\n\n  const key = normalizeKey(body);\n  const mid = String(missionId||'');\n\n  let en = (KO_EN_BY_MISSION?.[mid]?.[key]) || (KO_EN_GLOBAL?.[key]) || '';\n  if(!en){\n    // try mapping using full key as well\n    const k2 = normalizeKey(full);\n    en = (KO_EN_BY_MISSION?.[mid]?.[k2]) || (KO_EN_GLOBAL?.[k2]) || '';\n  }\n  if(!en){\n    en = phraseFallback(body);\n    // if nothing changed, bail\n    if(en === body) return full;\n  }\n\n  // If mapping already includes a bracket tag, prefer it; else preserve original tag\n  const hasTag = /^\\[[^\\]]+\\]/.test(en);\n  if(tag && !hasTag) return (tag + ' ' + en).trim();\n  return en;\n}\n`;

fs.writeFileSync(outPath, js, 'utf8');
console.log('Wrote', outPath, 'missions:', Object.keys(missionStates).length, 'global:', Object.keys(globalMap).length);
