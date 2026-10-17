/**
 * Design-system sample page (/design/, dev only; not in the build inputs).
 * Shows the tokens and parts of src/ui/ds.css, the icon set, the menu sounds,
 * and two screens laid out with them, for the owner to approve before the
 * real screens are rebuilt (docs/design/ui-audit.md).
 */
import '@/ui/ds.css';
import './page.css';
import { icon, ICON_NAMES, type IconName } from '@/ui/icons';
import { uiSound, setUiVolume, type UiSound } from '@/audio/uiSounds';

const FILM = `${import.meta.env.BASE_URL}menu/battle.mp4`;
const MAPS = ['철문 주둔지', '아르덴 숲', '리옹 초원 전선', '빌바오 공방전', '페르시아 침공'];

const page = document.getElementById('page')!;

page.innerHTML = `
<header class="pg-head">
  <div>
    <div class="ds-label">Strikegy · 견본</div>
    <h1 class="ds-title">디자인 시스템</h1>
    <p class="ds-dim">모든 화면이 이 글꼴, 크기, 색, 부품만 쓰게 됩니다. 마우스를 올리고 눌러 보세요. 소리도 납니다.</p>
  </div>
  <div class="pg-controls">
    <span class="ds-label">테마</span>
    <div class="ds-seg" data-group="theme">
      <button class="sel" data-theme="bfv">BFV</button><button data-theme="2042">2042 (지금)</button>
    </div>
    <span class="ds-label">소리</span>
    <button class="ds-toggle on" data-sound-toggle aria-label="소리"></button>
  </div>
</header>
<p class="pg-note ds-faint">글꼴은 아직 내려받지 않아 비슷한 시스템 글꼴(한글: 맑은 고딕, 숫자·영문: Bahnschrift)로 보입니다. 승인하시면 Pretendard와 Barlow Condensed로 바뀝니다. 소리도 지금은 코드로 합성한 임시 소리입니다.</p>

<section>
  <h2>예시 1 · 메인 메뉴</h2>
  <p class="ds-dim">한 화면에 시선이 갈 곳은 하나: '플레이'가 가장 크고, 설정은 구석의 아이콘입니다. 설명 글은 없습니다. 오른쪽 아래는 지난번 설정으로 바로 들어가는 카드입니다.</p>
  <div class="mock"><div class="mock-screen ds">
    <video class="mock-bg" src="${FILM}" muted autoplay loop playsinline></video>
    <div class="mock-shade-left"></div>
    <div class="mm">
      <div>
        <div class="mm-mark">STRIKEGY</div>
        <div class="mm-sub ds-label">개발 중 빌드</div>
      </div>
      <div class="mm-top-right">
        <div class="mm-profile">${icon('user')}<span><b>Tester</b> <span class="mm-tag">#U6FCB</span></span><span class="ds-ping good"><i></i><i></i><i></i></span></div>
        <button class="ds-btn mm-icon-btn" title="설정">${icon('settings')}</button>
      </div>
      <ul class="ds-menu mm-menu" data-group="menu">
        <li class="ds-menu-item hero sel">플레이</li>
        <li class="ds-menu-item">멀티플레이</li>
        <li class="ds-menu-item">사격장</li>
        <li class="ds-menu-item small">튜토리얼</li>
        <li class="ds-menu-item small">크레딧</li>
      </ul>
      <div class="mm-feature">
        <div class="ds-card" data-shot="2" data-snd="start">
          <div class="mm-feature-top"><span class="ds-badge accent">이어서 하기</span><span class="ds-kbd">F</span></div>
          <div>
            <div class="ds-card-name">철문 주둔지</div>
            <div class="ds-dim">거점전 · 12 vs 12 · 봇 보통</div>
          </div>
        </div>
      </div>
      <div class="mm-foot">
        <span class="ds-hint"><span class="ds-kbd">↑</span><span class="ds-kbd">↓</span>선택</span>
        <span class="ds-hint"><span class="ds-kbd">ENTER</span>확인</span>
        <span class="ds-hint"><span class="ds-kbd">ESC</span>뒤로</span>
      </div>
    </div>
  </div></div>
</section>

<section>
  <h2>예시 2 · 게임 설정</h2>
  <p class="ds-dim">지금 화면은 글이 213단어였습니다. 모드는 이름만, 맵은 그림으로, 설정은 세 줄로 줄였습니다. 규칙은 '규칙 보기'를 누를 때만 펼칩니다. 맵 그림은 지금 메뉴 영상에서 잘라 온 임시 그림이고, 다음 단계에서 맵마다 장면을 찍어 넣습니다.</p>
  <div class="mock"><div class="mock-screen ds">
    <video class="mock-bg" src="${FILM}" muted autoplay loop playsinline></video>
    <div class="mock-shade-full"></div>
    <div class="su">
      <div class="su-head">
        <button class="ds-btn ghost" data-snd="back">${icon('back')} 뒤로 <span class="ds-kbd">ESC</span></button>
        <div class="ds-title" style="font-size:var(--fs-xl)">게임 설정</div>
      </div>
      <div class="ds-tabs su-tabs" data-group="tabs">
        <div class="ds-tab sel">거점</div><div class="ds-tab">공격·수비</div><div class="ds-tab">팀 데스매치</div><div class="ds-tab">개인전</div><div class="ds-tab">연습</div>
      </div>
      <div class="su-modes" data-group="modes">
        <div class="ds-row sel"><span class="ds-row-main">거점전</span><span class="ds-row-side">점수 경쟁</span></div>
        <div class="ds-row"><span class="ds-row-main">전선</span><span class="ds-row-side">섹터 밀고 당기기</span></div>
        <div class="ds-row"><span class="ds-row-main">하드포인트</span><span class="ds-row-side">움직이는 거점</span></div>
        <div class="ds-row off"><span class="ds-row-main">돌파</span><span class="ds-row-side">이 맵에는 없음</span></div>
      </div>
      <div class="su-map">
        <div class="ds-card big sel" data-shot="1">
          <div>
            <div class="ds-label">맵</div>
            <div class="su-map-name">철문 주둔지</div>
            <div class="su-facts">
              <div><span class="ds-label">거점</span><span class="ds-num">5</span></div>
              <div><span class="ds-label">크기</span><span class="ds-num">329 × 210 m</span></div>
              <div><span class="ds-label">권장</span><span class="ds-num">12 vs 12</span></div>
            </div>
          </div>
        </div>
        <div class="su-strip" data-group="maps">
          ${MAPS.map((m, i) => `<div class="ds-card${i === 0 ? ' sel' : ''}" data-shot="${i}"><div class="ds-card-name">${m}</div></div>`).join('')}
        </div>
      </div>
      <div class="su-side">
        <div>
          <div class="ds-label">거점전</div>
          <div class="su-mode-title">거점을 쥐고 점수를 쌓는다</div>
          <button class="ds-btn ghost" style="padding-left:0">${icon('info')} 규칙 보기</button>
        </div>
        <div>
          <div class="su-set"><span>팀당 인원</span>
            <div class="ds-stepper"><button>${icon('back')}</button><output class="ds-num">12 vs 12</output><button>${icon('next')}</button></div></div>
          <div class="su-set"><span>팀</span>
            <div class="ds-seg" data-group="side"><button class="sel">무작위</button><button>블루</button><button>레드</button></div></div>
          <div class="su-set"><span>봇 난이도</span>
            <div class="ds-seg" data-group="diff"><button>쉬움</button><button class="sel">보통</button><button>어려움</button></div></div>
        </div>
        <button class="ds-btn primary" data-snd="start">게임 시작 <span class="ds-kbd" style="border-color:currentColor;color:inherit">ENTER</span></button>
      </div>
      <div class="su-foot">
        <span class="ds-hint"><span class="ds-kbd">Q</span><span class="ds-kbd">E</span>모드 종류</span>
        <span class="ds-hint"><span class="ds-kbd">↑</span><span class="ds-kbd">↓</span>모드</span>
        <span class="ds-hint"><span class="ds-kbd">←</span><span class="ds-kbd">→</span>맵</span>
      </div>
    </div>
  </div></div>
</section>

<section>
  <h2>원칙</h2>
  <ol class="rules">
    <li><span><b>한 화면에 초점 하나.</b><span class="ds-dim">가장 중요한 것 하나만 크게, 나머지는 조용하게.</span></span></li>
    <li><span><b>설명은 펼칠 때만.</b><span class="ds-dim">줄마다 붙던 설명 글을 없애고, 필요한 곳에만 '규칙 보기'·도움말 아이콘.</span></span></li>
    <li><span><b>글 대신 그림.</b><span class="ds-dim">맵은 장면, 총은 3D 모델, 병과는 병사 모습.</span></span></li>
    <li><span><b>정해진 값만.</b><span class="ds-dim">글자 7단계, 간격 8단계, 모서리 2종, 색은 역할 이름으로. 그때그때 고른 숫자 금지.</span></span></li>
    <li><span><b>모든 입력에 반응.</b><span class="ds-dim">올리면 바뀌고, 누르면 소리. 0.12~0.32초 안에.</span></span></li>
    <li><span><b>기호와 이모지 금지.</b><span class="ds-dim">아이콘은 이 페이지의 한 세트만. 키캡 안에는 키 이름만.</span></span></li>
    <li><span><b>화면 크기에 따라 커진다.</b><span class="ds-dim">1080p에서 기준 16px, 720p~4K까지 같은 비율.</span></span></li>
  </ol>
</section>

<section>
  <h2>글꼴과 크기 · 7단계</h2>
  <p class="ds-dim">한글은 Pretendard(지금은 맑은 고딕으로 대신), 숫자·영문 제목은 Barlow Condensed(지금은 Bahnschrift). 숫자는 폭이 같은 숫자를 써서 점수와 탄약이 흔들리지 않습니다.</p>
  <div class="box">
    ${(
      [
        ['hero · 72', 'fs-hero', '승리', 'display'],
        ['2xl · 44', 'fs-2xl', '게임 설정', ''],
        ['xl · 28', 'fs-xl', '철문 주둔지 · 12 vs 12', ''],
        ['lg · 20', 'fs-lg', '거점전 · 버튼 · 줄 제목', ''],
        ['md · 16', 'fs-md', '본문. 거점을 쥐고 있으면 5초마다 점수가 쌓입니다.', ''],
        ['sm · 14', 'fs-sm', '보조 글. 방장 · 대기 중 · 1 / 24명', ''],
        ['xs · 12', 'fs-xs', 'LABEL · 라벨 · ENTER', 'label'],
      ] as const
    )
      .map(
        ([name, v, text, kind]) =>
          `<div class="type-row"><span class="ds-label">${name}px</span><span class="${kind === 'label' ? 'ds-label' : ''}" style="font-size:var(--${v});${kind === 'display' ? 'font-family:var(--font-display);font-weight:700' : 'font-weight:' + (v === 'fs-md' || v === 'fs-sm' ? 400 : 700)};line-height:1.15">${text}</span></div>`,
      )
      .join('')}
    <div class="type-row"><span class="ds-label">숫자</span><span class="ds-num" style="font-size:var(--fs-2xl)">30 <span class="ds-faint">/ 120</span> &nbsp; 1,250 &nbsp; 02:45</span></div>
  </div>
</section>

<section>
  <h2>색 · 역할 이름으로</h2>
  <p class="ds-dim">지금 CSS의 색 206종을 이 정도로 줄입니다. 테마를 바꾸면 같은 이름에 다른 값이 들어갑니다.</p>
  <div class="swatches" id="swatches"></div>
</section>

<section>
  <h2>간격 8단계 · 움직임 3단계</h2>
  <div class="grid two">
    <div class="box"><span class="ds-label">간격 (1080p 기준 px)</span>
      <div class="spaces">${[1, 2, 3, 4, 5, 6, 7, 8]
        .map((n) => `<div><i style="width:var(--s${n});height:var(--s${n})"></i><span>s${n}<br>${[4, 8, 12, 16, 24, 32, 48, 64][n - 1]}</span></div>`)
        .join('')}</div>
    </div>
    <div class="box"><span class="ds-label">움직임</span>
      <div class="stack">
        <div class="ds-row"><span class="ds-row-main">빠름 0.12초</span><span class="ds-row-side">올렸을 때 색</span></div>
        <div class="ds-row"><span class="ds-row-main">보통 0.2초</span><span class="ds-row-side">선택 막대, 밑줄</span></div>
        <div class="ds-row"><span class="ds-row-main">느림 0.32초</span><span class="ds-row-side">진행 막대, 화면 전환</span></div>
      </div>
    </div>
  </div>
</section>

<section>
  <h2>부품</h2>
  <div class="grid two">
    <div class="box"><span class="ds-label">버튼</span>
      <div class="wrap">
        <button class="ds-btn primary" data-snd="start">배치</button>
        <button class="ds-btn">방 만들기</button>
        <button class="ds-btn">${icon('refresh')} 새로고침</button>
        <button class="ds-btn ghost" data-snd="back">${icon('back')} 뒤로</button>
        <button class="ds-btn" disabled>잠김</button>
      </div>
    </div>
    <div class="box"><span class="ds-label">탭</span>
      <div class="ds-tabs" data-group="tabs2"><div class="ds-tab sel">조작</div><div class="ds-tab">키 설정</div><div class="ds-tab">화면</div><div class="ds-tab">소리</div></div>
    </div>
    <div class="box"><span class="ds-label">목록 (모드, 방, 설정)</span>
      <div data-group="rows">
        <div class="ds-row sel">${icon('lock')}<span class="ds-row-main">요로의 방</span><span class="ds-row-side">빌바오 · 돌파</span><span class="ds-num">8/24</span><span class="ds-ping good"><i></i><i></i><i></i></span></div>
        <div class="ds-row"><span style="width:1.25em"></span><span class="ds-row-main">12 vs 12 봇전</span><span class="ds-row-side">철문 · 거점전</span><span class="ds-num">3/24</span><span class="ds-ping mid"><i></i><i></i><i></i></span></div>
        <div class="ds-row"><span style="width:1.25em"></span><span class="ds-row-main">아르덴 연습</span><span class="ds-row-side">아르덴 · 전선</span><span class="ds-num">1/32</span><span class="ds-ping"><i></i><i></i><i></i></span></div>
      </div>
    </div>
    <div class="box"><span class="ds-label">선택</span>
      <div class="stack">
        <div class="ds-seg" data-group="seg2"><button class="sel">무작위</button><button>블루</button><button>레드</button></div>
        <div class="ds-stepper"><button>${icon('back')}</button><output class="ds-num">16 vs 16</output><button>${icon('next')}</button></div>
        <div class="wrap"><button class="ds-toggle on" data-toggle></button><span>FPS 표시</span></div>
        <div class="wrap" style="flex-wrap:nowrap"><span style="white-space:nowrap">마우스 감도</span><input type="range" class="ds-slider" min="0" max="100" value="50"><span class="ds-num" data-out>1.00</span></div>
        <input class="ds-input" placeholder="방 이름, 맵, 방장 검색">
      </div>
    </div>
    <div class="box"><span class="ds-label">무기 능력치</span>
      <div class="stack">
        ${(
          [
            ['피해', 0.62, 31],
            ['연사', 0.78, 780],
            ['사거리', 0.55, 55],
            ['조작', 0.7, 70],
          ] as const
        )
          .map(([k, p, v]) => `<div class="ds-stat"><span class="ds-dim">${k}</span><div class="ds-stat-bar" style="--p:${p * 100}%"></div><span class="ds-num">${v}</span></div>`)
          .join('')}
      </div>
    </div>
    <div class="box"><span class="ds-label">작은 것들</span>
      <div class="stack">
        <div class="wrap"><span class="ds-badge accent">방장</span><span class="ds-badge ally">블루</span><span class="ds-badge enemy">레드</span><span class="ds-badge">대기 중</span><span class="ds-badge line">채팅 금지</span></div>
        <div class="wrap"><span class="ds-hint"><span class="ds-kbd">E</span>부활</span><span class="ds-hint"><span class="ds-kbd">SPACE</span>배치</span><span class="ds-hint"><span class="ds-kbd">Z</span>점수판 (누르고 있기)</span></div>
        <div class="ds-progress" style="--p:.62"></div>
        <div><span class="ds-toast">${icon('info')} 들어갈 수 있는 방이 없어 새 방을 만들었습니다.</span></div>
        <div><span class="ds-toast danger">${icon('close')} 비밀번호가 틀렸습니다.</span></div>
      </div>
    </div>
    <div class="box"><span class="ds-label">대화 상자</span>
      <div class="ds-dialog">
        <h3>방을 나갈까요?</h3>
        <p>진행 중인 경기에서 나가면 이번 판 기록은 남지 않습니다.</p>
        <div class="ds-actions"><button class="ds-btn ghost" data-snd="back">취소</button><button class="ds-btn">나가기</button></div>
      </div>
    </div>
    <div class="box"><span class="ds-label">맵 카드</span>
      <div class="grid" style="grid-template-columns:1fr 1fr" data-group="cards">
        <div class="ds-card sel" data-shot="3"><div class="ds-card-name">빌바오 공방전</div><div class="ds-dim">돌파 · 12 vs 12</div></div>
        <div class="ds-card" data-shot="4"><div class="ds-card-name">페르시아 침공</div><div class="ds-dim">전선 · 4 vs 4</div></div>
      </div>
    </div>
  </div>
</section>

<section>
  <h2>아이콘 · 한 세트</h2>
  <p class="ds-dim">24px 격자, 선 두께 하나, 각진 끝. 지금 쓰는 이모지(💬 🔒 🖥 📱)와 기호(◆ ▣ ⌂ ❚ ▲ ◎ ✚)를 모두 이것으로 바꿉니다.</p>
  <div class="icons">${ICON_NAMES.map((n: IconName) => `<div>${icon(n)}<span>${n}</span></div>`).join('')}</div>
</section>

<section>
  <h2>소리</h2>
  <p class="ds-dim">메뉴의 모든 입력에 짧은 소리가 붙습니다. 지금은 임시로 합성한 소리이고, 승인하시면 녹음된 CC0 소리로 바꿉니다.</p>
  <div class="wrap">${(
    [
      ['hover', '올리기'],
      ['move', '목록 이동'],
      ['select', '선택'],
      ['back', '뒤로'],
      ['open', '화면 열기'],
      ['error', '오류'],
      ['start', '게임 시작'],
    ] as const
  )
    .map(([k, label]) => `<button class="ds-btn" data-play="${k}">${icon('volume')} ${label}</button>`)
    .join('')}</div>
</section>

<section>
  <h2>받아야 할 것 · 승인 필요</h2>
  <p class="ds-dim">아직 아무것도 내려받지 않았습니다. 용량은 서버에 확인한 값입니다.</p>
  <div class="box" style="overflow-x:auto">
    <table class="dl">
      <thead><tr><th>무엇</th><th>쓰임</th><th>출처</th><th>라이선스</th><th>게임에 들어가는 용량</th></tr></thead>
      <tbody>
        <tr><td><b>Pretendard Std</b> (가변 굵기, woff2)</td><td>모든 한글·본문</td><td><a href="https://github.com/orioncactus/pretendard" target="_blank" rel="noreferrer">github.com/orioncactus/pretendard</a> v1.3.9</td><td>SIL OFL 1.1</td><td class="num">292 KB</td></tr>
        <tr><td><b>Barlow Condensed</b> 500 · 600 · 700 (라틴, woff2)</td><td>숫자, 영문 제목, 키 이름</td><td><a href="https://fonts.google.com/specimen/Barlow+Condensed" target="_blank" rel="noreferrer">Google Fonts</a> (Jeremy Tribby)</td><td>SIL OFL 1.1</td><td class="num">66 KB<br><span class="ds-faint">21 + 22 + 22</span></td></tr>
        <tr><td><b>Kenney Interface Sounds</b> (100개)</td><td>메뉴 효과음 6~8개를 골라 씀</td><td><a href="https://kenney.nl/assets/interface-sounds" target="_blank" rel="noreferrer">kenney.nl</a></td><td>CC0</td><td class="num">받는 파일 835 KB<br><span class="ds-faint">골라 넣으면 약 50 KB</span></td></tr>
        <tr><td><b>Kenney UI Audio</b> (50개)</td><td>위와 같음 (고를 폭을 넓히려고)</td><td><a href="https://kenney.nl/assets/ui-audio" target="_blank" rel="noreferrer">kenney.nl</a></td><td>CC0</td><td class="num">받는 파일 412 KB<br><span class="ds-faint">골라 넣으면 포함</span></td></tr>
      </tbody>
    </table>
    <p class="ds-faint" style="margin:var(--s3) 0 0;font-size:var(--fs-sm)">Pretendard Std는 자주 쓰는 한글 2,350자만 들어 있습니다. 드문 글자가 들어간 이름은 그 글자만 시스템 글꼴로 나옵니다.</p>
  </div>
</section>
`;

// ---------- Colour swatches (read back from the live tokens) ----------
const SWATCHES: [string, string][] = [
  ['--bg', '바탕'],
  ['--surface-1', '패널'],
  ['--surface-2', '올렸을 때 · 입력'],
  ['--surface-3', '눌렀을 때 · 막대 바탕'],
  ['--ink', '글자'],
  ['--ink-2', '보조 글자'],
  ['--ink-3', '흐린 글자'],
  ['--line', '선'],
  ['--sel-bg', '고른 것'],
  ['--accent', '행동 하나 (시작·배치)'],
  ['--ally', '아군'],
  ['--enemy', '적군'],
  ['--squad', '분대'],
  ['--warn', '알림'],
  ['--danger', '위험·오류'],
];
function paintSwatches(): void {
  const css = getComputedStyle(document.body);
  document.getElementById('swatches')!.innerHTML = SWATCHES.map(
    ([v, label]) => `<div class="swatch"><i style="background:var(${v})"></i><div><b>${label}</b><span class="ds-faint">${v} · ${css.getPropertyValue(v).trim()}</span></div></div>`,
  ).join('');
}
paintSwatches();

// ---------- Stand-in map pictures: frames cut from the menu film ----------
async function cutFrames(): Promise<void> {
  const v = document.createElement('video');
  v.src = FILM;
  v.muted = true;
  v.crossOrigin = 'anonymous';
  await new Promise<void>((r) => v.addEventListener('loadeddata', () => r(), { once: true }));
  const times = [3.5, 9, 15.5, 22, 29];
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const g = c.getContext('2d')!;
  const shots: string[] = [];
  for (const t of times) {
    v.currentTime = Math.min(t, Math.max(0, v.duration - 0.5));
    await new Promise<void>((r) => v.addEventListener('seeked', () => r(), { once: true }));
    g.drawImage(v, 0, 0, c.width, c.height);
    shots.push(c.toDataURL('image/jpeg', 0.8));
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-shot]')) {
    const s = shots[Number(el.dataset.shot) % shots.length];
    if (s) el.style.backgroundImage = `url(${s})`;
  }
}
void cutFrames();

// The films play only while their mock is on screen.
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const v = e.target as HTMLVideoElement;
    if (e.isIntersecting) void v.play().catch(() => undefined);
    else v.pause();
  }
});
for (const v of document.querySelectorAll('video')) {
  v.autoplay = false;
  seen.observe(v);
}

// ---------- Full-screen view of a mock (Esc or a click on the picture's edge leaves) ----------
for (const m of document.querySelectorAll<HTMLElement>('.mock')) {
  const b = document.createElement('button');
  b.className = 'ds-btn ghost mock-full-btn';
  b.dataset.snd = 'open';
  b.innerHTML = `${icon('desktop')} 전체 화면으로 보기`;
  b.addEventListener('click', () => m.classList.add('full'));
  m.prepend(b);
}
document.addEventListener('keydown', (e) => {
  const full = document.querySelector('.mock.full');
  if (e.key === 'Escape' && full) {
    full.classList.remove('full');
    play('back');
  }
});

// ---------- Behaviour: picking in groups, sounds ----------
let soundOn = true;
setUiVolume(0.8);
const play = (k: UiSound): void => {
  if (soundOn) uiSound(k);
};

const PICKABLE = '.ds-menu-item, .ds-tab, .ds-seg button, .ds-row, .ds-card';
const HOVERABLE = `${PICKABLE}, .ds-btn, .ds-stepper button, .ds-toggle`;

let hovered: Element | null = null;
document.addEventListener('pointerover', (e) => {
  const el = (e.target as Element).closest(HOVERABLE);
  if (el && el !== hovered && !el.classList.contains('off')) play('hover');
  hovered = el;
});

document.addEventListener('click', (e) => {
  const target = e.target as Element;
  const t = target.closest<HTMLElement>('[data-theme]');
  if (t) {
    document.body.dataset.dsTheme = t.dataset.theme;
    paintSwatches();
  }
  const sToggle = target.closest('[data-sound-toggle]');
  if (sToggle) {
    soundOn = !soundOn;
    sToggle.classList.toggle('on', soundOn);
    if (soundOn) play('select');
    return;
  }
  const p = target.closest<HTMLElement>('[data-play]');
  if (p) {
    play(p.dataset.play as UiSound);
    return;
  }
  const tg = target.closest('[data-toggle]');
  if (tg) tg.classList.toggle('on');

  const pick = target.closest(PICKABLE);
  const group = pick?.closest('[data-group]');
  if (pick && group) {
    for (const s of group.querySelectorAll(PICKABLE)) if (s.closest('[data-group]') === group) s.classList.remove('sel');
    pick.classList.add('sel');
  }
  const snd = target.closest<HTMLElement>('[data-snd]')?.dataset.snd as UiSound | undefined;
  if (snd) play(snd);
  else if (target.closest('.ds-stepper button')) play('move');
  else if (target.closest(HOVERABLE)) play('select');
});

// Main menu mock: arrow keys move the pick like the real menu will.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const items = [...document.querySelectorAll('[data-group="menu"] .ds-menu-item')];
  const i = items.findIndex((x) => x.classList.contains('sel'));
  const n = Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
  if (n === i) return;
  e.preventDefault();
  items.forEach((x, k) => x.classList.toggle('sel', k === n));
  play('move');
});

for (const r of document.querySelectorAll<HTMLInputElement>('.ds-slider')) {
  const out = r.parentElement?.querySelector('[data-out]');
  const sync = (): void => {
    r.style.setProperty('--p', `${r.value}%`);
    if (out) out.textContent = (0.2 + (Number(r.value) / 100) * 1.6).toFixed(2);
  };
  r.addEventListener('input', sync);
  sync();
}
