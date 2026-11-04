// The Korean-military Short's timeline, shared by rok.html (window.ROK) and build.mjs. Times are the song's own:
// 멸공의 횃불 from 국방일보's video, from its start to the end of the first verse, cuts on its measured hits.
// Its subject follows the song (owner): the South against communism, the war, then the North's attacks since.
(() => {
  const END = 62.81;
  const BEAT = 0.4885;
  // The big hits: a white flash, the picture punches in.
  const STRONG = [0.26, 1.24, 2.21, 3.17, 3.64, 4.64, 5.13, 7.06, 9, 10.94, 11.94, 12.92, 13.88, 15.78, 18.77, 22.72, 23.18, 24.69, 26.64, 28.6, 30.54, 31.48, 32.44, 33.4, 35.01, 35.17, 35.33, 37.24, 39.23, 41.18, 42.15, 44.08, 46.03, 46.95, 47.96, 48.94, 50.43, 52.41, 54.88, 56.85, 58.35, 61.31, 61.81];
  // Every beat of the march through the war: the front twitches on these.
  const BEATS = [];
  for (let t = 13.88; t < 35.33; t += BEAT) BEATS.push(+t.toFixed(3));

  const TANKS = { label: '1950년 6월, 전차', a: '국군 0대', b: '북한군 242대' };
  const SENT = { label: '베트남 파병 연인원', a: '', b: '325,517명' };
  const CHEONAN = { label: '천안함', a: '', b: '장병 46명 전사' };
  const HOME = [126.8, 37.5];

  const SCENES = [
    { to: 2.21, kind: 'title' },
    { to: 4.64, kind: 'map', date: '1945.08.15', line: '광복' },
    { to: 7.06, kind: 'map', date: '1945.09', line: '38선으로 갈린 땅' },
    { to: 9, kind: 'clip', clip: 'W12', at: 0.4, date: '1946.01.15', line: '국방경비대 창설' },
    {
      to: 10.94,
      kind: 'map',
      date: '1948.08.15',
      line: '대한민국 국군 창설',
      card: { photo: 'rhee', focus: [0.48, 0.34], zoom: [1, 1.12], x: 815, y: 1180, w: 380, h: 470, name: '이승만 초대 대통령', rot: 0.05 },
    },
    { to: 11.94, kind: 'map', date: '1948.09.09', line: '북한 정권 수립' },
    { to: 12.92, kind: 'map', date: '1950.06', line: '전쟁 직전', stat: TANKS },
    { to: 13.88, kind: 'clip', clip: 'W01', at: 1.5, date: '1950.06', line: '전쟁 직전', stat: TANKS },
    {
      to: 15.78,
      kind: 'map',
      date: '1950.06.25',
      line: '북한군 전면 남침',
      arrows: [
        { from: [126.4, 38.5], to: [126.9, 37.7], color: 'red', at: 0, dur: 0.4 },
        { from: [127.4, 38.6], to: [127.3, 37.7], color: 'red', at: 0.25, dur: 0.4 },
        { from: [128.4, 38.7], to: [128.5, 37.8], color: 'red', at: 0.5, dur: 0.4 },
      ],
    },
    { to: 18.77, kind: 'map', date: '1950.06.28', line: '서울 함락', burn: [[126.98, 37.56]] },
    { to: 23.18, kind: 'map', date: '1950.08', line: '낙동강 방어선' },
    {
      to: 24.69,
      kind: 'map',
      date: '1950.09.15',
      line: '인천상륙작전',
      arrows: [{ from: [124.9, 36.8], to: [126.55, 37.45], color: 'blue', at: 0, dur: 0.35 }],
      burn: [[126.62, 37.47]],
      card: { photo: 'macarthur', focus: [0.5, 0.42], zoom: [2.1, 2.3], x: 700, y: 1205, w: 610, h: 420, name: '맥아더 유엔군 사령관', rot: -0.035 },
    },
    { to: 25.66, kind: 'map', date: '1950.09.28', line: '서울 수복' },
    { to: 26.64, kind: 'map', date: '1950.10.01', line: '국군 38선 돌파', arrows: [{ from: [128.4, 37.7], to: [128.2, 38.8], color: 'blue', at: 0, dur: 0.3 }] },
    { to: 27.61, kind: 'map', date: '1950.10.19', line: '평양 점령', burn: [[125.75, 39.02]] },
    { to: 28.6, kind: 'map', date: '1950.10.26', line: '압록강 도달' },
    {
      to: 30.54,
      kind: 'map',
      date: '1950.11',
      line: '중공군의 대공세',
      arrows: [
        { from: [124.8, 41.4], to: [125.6, 39.9], color: 'red', at: 0, dur: 0.4 },
        { from: [126.6, 41.9], to: [126.8, 40.1], color: 'red', at: 0.25, dur: 0.4 },
        { from: [128.2, 42.2], to: [127.9, 40.3], color: 'red', at: 0.5, dur: 0.4 },
      ],
    },
    { to: 31.48, kind: 'map', date: '1951.01.04', line: '1·4 후퇴', burn: [[126.98, 37.56]] },
    { to: 32.44, kind: 'clip', clip: 'W03', at: 0.8, date: '1951~1953', line: '고지전' },
    { to: 33.4, kind: 'clip', clip: 'W10', at: 1.3, date: '1951~1953', line: '고지전' },
    { to: 35.33, kind: 'map', date: '1953.07.27', line: '정전협정' },

    { to: 37.24, kind: 'map', date: '1964.09', line: '베트남 파병', arrows: [{ from: [128.9, 35.1], to: [106.7, 10.9], color: 'blue', at: 0, dur: 0.8, wide: true }] },
    { to: 39.23, kind: 'map', date: '1964~1973', line: '베트남 전쟁', stat: SENT },
    { to: 41.18, kind: 'map', date: '1968.01.21', line: '북한 무장공비 청와대 기습', burn: [[126.98, 37.58]] },
    { to: 42.15, kind: 'clip', clip: 'W08', at: 0.3, date: '1968.01', line: '무장공비 소탕' },
    { to: 44.08, kind: 'map', date: '1976.08.18', line: '판문점 도끼 만행', marks: [[126.68, 37.96, '판문점']] },
    { to: 46.03, kind: 'map', date: '1983.10.09', line: '아웅산 테러', arrows: [{ from: HOME, to: [96.3, 17], color: 'red', at: 0, dur: 0.6, wide: true }], marks: [[96.15, 16.8, '랑군']] },
    { to: 46.95, kind: 'map', date: '1996.09.18', line: '강릉 잠수함 침투', marks: [[128.9, 37.75, '강릉']] },
    { to: 47.96, kind: 'clip', clip: 'W03', at: 1.2, date: '1996.09', line: '무장공비 소탕' },
    { to: 48.94, kind: 'map', date: '1999.06.15', line: '제1연평해전', marks: [[125.7, 37.66, '연평도']] },
    { to: 50.43, kind: 'map', date: '2002.06.29', line: '제2연평해전', burn: [[125.45, 37.72]], marks: [[125.7, 37.66, '연평도']] },
    { to: 52.41, kind: 'map', date: '2010.03.26', line: '천안함 피격', stat: CHEONAN, marks: [[124.7, 37.92, '백령도']] },
    { to: 54.88, kind: 'map', date: '2010.11.23', line: '연평도 포격', burn: [[125.7, 37.66]] },
    { to: 56.85, kind: 'clip', clip: 'W06', at: 0.45, date: '오늘', line: '휴전선을 지키는 국군' },
    { to: 58.35, kind: 'map', date: '오늘', line: '전쟁은 아직 끝나지 않았다' },
    { to: END, kind: 'end', clip: 'W11', at: 0, slow: 1.1 },
  ];
  let from = 0;
  for (const s of SCENES) {
    s.from = from;
    from = s.to;
  }

  // Where the front stands (rok.html has the lines), at each hit. Before 4.64 s there is no line.
  const FRONT = [
    [4.64, 'parallel'],
    [13.88, 'parallel'],
    [15.78, 'seoulFalls'],
    [18.77, 'perimeter'],
    [24.69, 'seoulBack'],
    [25.66, 'over38'],
    [26.64, 'pyongyang'],
    [27.61, 'yalu'],
    [28.6, 'pyongyang'],
    [29.57, 'over38'],
    [30.54, 'january'],
    [31.48, 'seoulBack'],
    [33.4, 'armistice'],
  ];

  // The map's camera: at each hit it jumps to [lon, lat, pixels a degree of latitude, tilt in degrees].
  const WHOLE = [127.6, 38.2, 140];
  const CAM = [
    [0, 127.6, 38, 90, 0],
    [0.26, 127.6, 38.2, 128, -2],
    [1.24, 127.6, 38.2, 138, 1.5],
    [2.21, ...WHOLE, 0],
    [4.64, 127.4, 38, 250, -2.5],
    [9, 127.8, 36.4, 240, 2],
    [10.94, 127.2, 40, 240, -2],
    [11.94, ...WHOLE, 0],
    [13.88, 127.1, 37.9, 340, -3],
    [15.78, 127, 37.5, 480, 3],
    [18.77, 128.2, 36, 360, -3],
    [20.25, 128.4, 35.9, 440, 2],
    [22.23, 128.6, 35.7, 520, -2],
    [23.18, 126.2, 37.3, 420, -4],
    [24.69, 127, 37.6, 460, 3],
    [25.66, 128, 38.2, 360, -3],
    [26.64, 126.2, 39.1, 320, 3],
    [27.61, 126.4, 40.7, 300, -3],
    [28.6, 126.5, 41, 220, -3],
    [29.57, 127, 39.5, 250, 2],
    [30.54, 127.2, 37, 300, -3],
    [33.4, 127.4, 38.2, 260, 2.5],
    [34.37, 127.4, 38.2, 330, -2],
    [35.33, 118, 25, 48, 0],
    [36.28, 107, 14, 100, -2],
    [37.24, 107, 14, 120, 2],
    [39.23, 127, 37.6, 460, -3],
    [40.18, 127, 37.6, 620, 2],
    [42.15, 126.75, 37.95, 620, -3],
    [43.1, 126.75, 37.95, 800, 2],
    [44.08, 110, 27, 42, 0],
    [45.04, 99, 19, 76, -2],
    [46.03, 128.7, 37.75, 440, 3],
    [47.96, 125.7, 37.7, 620, -3],
    [48.94, 125.7, 37.7, 780, 3],
    [50.43, 124.9, 37.85, 620, -3],
    [52.41, 125.8, 37.7, 700, 3],
    [53.4, 125.8, 37.7, 900, -2],
    [56.85, 127.6, 37, 150, 0],
    [57.6, 127.6, 37, 190, 1.5],
  ];

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.ROK = { END, BEAT, STRONG, BEATS, SCENES, FRONT, CAM };
})();
