/**
 * Swearing and abuse in chat, names and room titles (owner, 2026-10-14).
 * Shared by the browser and the game server; imports nothing and uses
 * erasable TypeScript only (the server imports it with its `.ts` extension).
 *
 * Text is looked at word by word (whitespace splits words): digits, symbols
 * and punctuation inside a word are skipped ("씨1발", "f.u.c.k"), and runs of
 * one-letter words are read together ("시 발", "ㅅ ㅂ", "f u c k"), but two
 * real words are never glued ("다시 발사" is fine). Korean is read on the
 * Hangul letters, English on the latin letters with look-alike digits
 * (0 o, 1 i, 3 e, 4 a, 5 s, 7 t, @ a, $ s) read as letters. What matches is
 * masked with `*` (in chat) or refused (names, titles); a few innocent
 * words that hold a match ("시발점", "새끼손가락") are left alone.
 */

/** Korean patterns, on the Hangul letters of a word. */
const KO: readonly RegExp[] = [
  // 시발 and its spellings (시바, 씨팔, ㅅㅂ, 쒸벌...), 씹-.
  /[시쉬싀ㅅ][발빨팔벌뻘봘ㅂ]|[씨쒸씌ㅆ][발빨바빠팔벌뻘봘ㅂㅃ]/g,
  /씹[새쌔할년놈창질]|십[새할]|씨[부불][랄럴]|씨[이]?[바발]/g,
  // 병신, 지랄, 좆 / 존나, 개새끼, 미친놈...
  /[병빙븅븽ㅂ][신씬쉰ㅅ]/g,
  /[지즤ㅈ][랄럴ㄹ]/g,
  /좆|[좇좃졷][같까]|[조ㅈ][까같]|존나|졸라|ㅈㄴ|좆나/g,
  /[개ㄱ]?[새쌔섀ㅅ][끼키뀌ㄲ]|새꺄|쌔꺄|개색|개섀/g,
  /미친[놈년넘새것]|ㅁㅊ[놈년]?|또라이|돌아이/g,
  /[썅쌍걸]년|개년[아들]|[썅쌍]놈|썅|염병|옘병|엿먹|개같[은이네다]|개소리|호로[새자놈]|후레자식|호래자식|화냥/g,
  // Insults to someone's parents.
  /니[애에]미|느금|니[애에]비|니미럴|엠창|[애에][미비]|ㄴㄱㅁ|니엄마|느개비/g,
  // Slurs.
  /틀딱|짱깨|쪽바리|깜둥|한남충|김치녀|급식충|맘충|된장녀|장애새|애자/g,
  /섹스|딸딸이/g,
];

/** English patterns, on the latin letters of a word (look-alike digits read as letters). */
const EN: readonly RegExp[] = [
  /f+u+c+k+|f+u+k+|f+c+k+|f+u+q+|phuck|motherf/g,
  /sh+i+t+|bi+t+ch|biatch|whore|slut|bastard|asshole|pussy|niggers?|nigga|nigguh|retard|faggot/g,
  /^(cunts?|dicks?|dickhead|fags?|ass|kys|stfu|wtf|twat|wank(er)?)$/g,
];

/** Innocent words holding a match: left as they are. */
const SAFE: readonly string[] = ['시발점', '시발역', '새끼손', '새끼발', '새끼고양', '새끼강아', '새끼줄', '등신대', '에미넴', '에미레이트', '에미상', '에비앙', '에비스', 'scunthorpe'];

const HANGUL = /[가-힣ㄱ-ㆎ]/;
const LATIN = /[a-z]/;
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', $: 's', '7': 't' };

interface Skeleton {
  s: string;
  /** Index into the text's characters of each letter in `s`. */
  at: number[];
}

/** One word (or a run of one-letter words): its Hangul letters and its latin ones. */
function skeletons(chars: readonly string[], idx: readonly number[]): [Skeleton, Skeleton] {
  const ko: Skeleton = { s: '', at: [] };
  const en: Skeleton = { s: '', at: [] };
  const latin = idx.some((i) => LATIN.test(chars[i]!));
  for (const i of idx) {
    // One character may read as several letters ("㎏": k, g).
    for (const c of chars[i]!) {
      if (HANGUL.test(c)) {
        ko.s += c;
        ko.at.push(i);
      } else if (LATIN.test(c) || (latin && LEET[c])) {
        en.s += LATIN.test(c) ? c : LEET[c]!;
        en.at.push(i);
      }
    }
  }
  return [ko, en];
}

/** Letters a word has (Hangul and latin). */
const letters = (chars: readonly string[], idx: readonly number[]): number => idx.filter((i) => HANGUL.test(chars[i]!) || LATIN.test(chars[i]!)).length;

export interface FilterResult {
  text: string;
  /** Something was masked. */
  hit: boolean;
}

/**
 * Masks swearing and abuse in `text` with `*` (whole spans, symbols between
 * the letters too). `extra`: more words to mask (the server's own list).
 */
export function filterText(text: string, extra: readonly string[] = []): FilterResult {
  const out = [...text.normalize('NFC')];
  // Full-width and styled latin read as plain letters (NFKC), Hangul as it is (NFKC would turn ㅅ into a conjoining jamo).
  const chars = out.map((c) => (HANGUL.test(c) ? c : c.normalize('NFKC').toLowerCase()));
  // Words: indices between whitespace.
  const words: number[][] = [];
  let cur: number[] = [];
  chars.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (cur.length) words.push(cur);
      cur = [];
    } else cur.push(i);
  });
  if (cur.length) words.push(cur);
  // Each word, and each run of one-letter words read together.
  const units: number[][] = [...words];
  let run: number[][] = [];
  const flush = (): void => {
    if (run.length > 1) units.push(run.flat());
    run = [];
  };
  for (const w of words) {
    if (letters(chars, w) === 1) run.push(w);
    else flush();
  }
  flush();
  const extraKo = extra.map((w) => w.toLowerCase().replace(/\s+/g, '')).filter((w) => w.length > 0);
  let hit = false;
  const mask = (sk: Skeleton, from: number, len: number): void => {
    const a = sk.at[from]!;
    const b = sk.at[from + len - 1]!;
    for (let i = a; i <= b; i++) if (!/\s/.test(out[i]!)) out[i] = '*';
    hit = true;
  };
  for (const u of units) {
    const [ko, en] = skeletons(chars, u);
    for (const [sk, list] of [[ko, KO], [en, EN]] as const) {
      if (!sk.s) continue;
      // Innocent words: their letters are off limits.
      const safe = new Set<number>();
      for (const w of SAFE) {
        for (let k = sk.s.indexOf(w); k >= 0; k = sk.s.indexOf(w, k + 1)) for (let j = 0; j < w.length; j++) safe.add(k + j);
      }
      for (const re of list) {
        re.lastIndex = 0;
        for (let m = re.exec(sk.s); m; m = re.exec(sk.s)) {
          if (!m[0]) {
            re.lastIndex++;
            continue;
          }
          let inside = true;
          for (let j = 0; j < m[0].length; j++) if (!safe.has(m.index + j)) inside = false;
          if (!inside) mask(sk, m.index, m[0].length);
        }
      }
      for (const w of extraKo) for (let k = sk.s.indexOf(w); k >= 0; k = sk.s.indexOf(w, k + 1)) mask(sk, k, w.length);
    }
  }
  return { text: out.join(''), hit };
}

/** Whether `text` holds swearing or abuse (names, room titles: refused). */
export function profane(text: string, extra: readonly string[] = []): boolean {
  return filterText(text, extra).hit;
}
