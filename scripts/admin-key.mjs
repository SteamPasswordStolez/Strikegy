/**
 * Sets the admin page's key (`npm run admin:key`, on the server, in its
 * folder; owner, 2026-10-27: the old random key had been copied to other
 * devices, and a random key can't be remembered). The owner types a
 * passphrase of their own (twice, not shown), or presses Enter for five
 * random words. Only a scrypt hash goes into `.strikegy-admin-key`, so the
 * file never holds the passphrase; the game server reads it on start
 * (`adminKeyMatches` in server/lobby.ts). Restart the server afterwards.
 *
 * The admin page allows 5 wrong keys an address and 30 from everyone per 10
 * minutes, so four or five words are far beyond guessing.
 *
 * Run it in your own terminal, never through a tool that records its output.
 */
import { randomBytes, randomInt, scryptSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const FILE = '.strikegy-admin-key';
const N = 1 << 15;
const MIN = 14;

// 256 short, distinct, easy words: five of them are 40 bits.
const WORDS = `
acorn actor agent alarm album amber angle ankle apple apron arena armor arrow atlas attic autumn
badge bagel baker bamboo banjo barrel basin beach beacon bear beetle bell berry bison blanket blossom
boat bonfire border bottle bracket branch bread breeze brick bridge bronze brook brush bubble bucket buffalo
cabin cactus camel camera candle canoe canyon captain carpet castle cedar cello chalk channel cherry chimney
cider circus citrus clover cobalt cocoa comet compass copper coral cotton cougar cradle crane crater cricket
crystal cupboard dagger daisy dancer delta desert diamond dinner dolphin donkey dragon drum eagle easel echo
elbow ember emerald engine falcon feather fence ferry fiddle flame flute forest fossil fountain fox galaxy
garden garlic geyser ginger glacier globe goblet gopher granite grape gravel guitar hammer harbor harp hazel
helmet heron hickory hollow honey horizon hornet iceberg igloo island ivory jacket jaguar jasmine jelly jungle
kayak kettle kitten koala ladder lagoon lantern lava lemon lily lizard lobster locket lotus magnet mango
maple marble meadow melon meteor mirror mitten monkey mosaic motor mountain muffin mustard nectar needle nickel
oasis ocean olive onion orbit orchid otter oyster paddle palace panda paper parrot peach pebble pelican
pencil pepper piano pickle pigeon pillow pine planet plum pocket pony puzzle quartz rabbit radar raven
ribbon river robin rocket saddle salmon sapphire satin scarf shadow shovel silver sketch sled spider spoon
squirrel stable statue storm summit sunset swan tablet teapot temple thunder tiger timber tomato tornado
trumpet tulip tunnel turtle valley velvet violin volcano walnut walrus wagon whale willow window winter yacht zebra
`.trim().split(/\s+/);

/** Piped input, read once. */
let piped = null;

/** Reads a line without showing it (stars instead). */
function hidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    if (!stdin.isTTY) {
      // Piped input (tests): the lines in turn.
      piped ??= new Promise((done) => {
        let buf = '';
        stdin.setEncoding('utf8');
        stdin.on('data', (d) => (buf += d));
        stdin.on('end', () => done(buf.split(/\r?\n/)));
      });
      void piped.then((lines) => {
        process.stdout.write('\n');
        resolve(lines.shift() ?? '');
      });
      return;
    }
    let text = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(text);
        }
        if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(1);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (text) {
            text = [...text].slice(0, -1).join('');
            process.stdout.write('\b \b');
          }
          continue;
        }
        text += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

if (WORDS.length !== 256 || new Set(WORDS).size !== 256) throw new Error(`word list: ${WORDS.length} / ${new Set(WORDS).size}`);

console.log('운영자 페이지 키 바꾸기');
console.log(`- 원하는 문구를 입력하세요 (${MIN}자 이상, 띄어쓰기 가능, 한글 가능). 화면에는 * 로만 보입니다.`);
console.log('- 그냥 Enter를 누르면 외우기 쉬운 영어 단어 다섯 개를 만들어 드립니다.');
let key = (await hidden('새 키: ')).normalize('NFC');
let made = false;
if (!key) {
  key = Array.from({ length: 5 }, () => WORDS[randomInt(WORDS.length)]).join(' ');
  made = true;
} else {
  if ([...key].length < MIN) {
    console.log(`${MIN}자보다 짧습니다. 바뀐 것은 없습니다.`);
    process.exit(1);
  }
  const again = (await hidden('한 번 더: ')).normalize('NFC');
  if (again !== key) {
    console.log('두 번 입력한 것이 다릅니다. 바뀐 것은 없습니다.');
    process.exit(1);
  }
}

const salt = randomBytes(16);
const hash = scryptSync(key, salt, 32, { N, r: 8, p: 1, maxmem: 256 * N * 8 });
writeFileSync(FILE, `scrypt$${N}$${salt.toString('base64url')}$${hash.toString('base64url')}\n`, { mode: 0o600 });
if (made) {
  console.log('\n새 키 (지금 한 번만 보여 드립니다, 띄어쓰기 그대로):\n');
  console.log(`    ${key}\n`);
}
console.log(`${FILE}에 해시만 저장했습니다. 서버를 재시작하면 새 키가 적용되고 예전 키는 더 이상 통하지 않습니다:`);
console.log('    sudo systemctl restart strikegy');
