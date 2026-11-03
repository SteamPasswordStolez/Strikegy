// The winter-war Short's timeline, shared by winter.html (window.WINTER) and build.mjs.
// Times are the video's (the song starts at its 0.25 s) and sit on the song's measured hits, not on a beat grid:
// the intro's hits fall half a beat off it.
(() => {
  /** FUNK CONTRA (Slowed): 98.09 BPM, the bar's two big bass hits are in STRONG. */
  const BAR = 2.4468;
  const BEAT = BAR / 4;
  const END = 34.05;
  const STRONG = [0.048, 10.781, 11.401, 13.23, 13.85, 15.678, 16.298, 18.139, 18.74, 20.578, 21.183, 23.024, 23.637, 25.487, 26.095, 27.936, 28.537];
  /** Smaller hits: the fronts twitch on these too. */
  const SOFT = [2.448, 2.814, 3.712, 4.343, 4.96, 6.172, 6.807, 7.423, 8.031, 8.641, 9.231, 9.524, 9.881, 10.482, 12.329, 12.94, 14.744, 15.379, 17.226, 17.836, 19.644, 20.279, 22.123, 22.733, 24.239, 25.176, 27.023, 27.633, 30.414, 31.198, 31.815, 33.745];

  const SOVIET_LOSS = { label: '전사·실종', a: '25,904명', b: '126,875명+' };

  // kind: vs / photo (portraits), map (the whole screen), split (map above, clip below), black, end.
  const SCENES = [
    { to: 2.448, kind: 'vs', head: '1939년 겨울' },
    { to: 3.712, kind: 'map', head: '병력도 무기도 압도적', stat: { label: '전차', a: '32대', b: '2,514대+', y: 400 } },
    { to: 4.96, kind: 'map', head: '병력도 무기도 압도적', stat: { label: '항공기', a: '114대', b: '3,880대', y: 400 } },
    { to: 6.172, kind: 'split', clip: 'W01', at: 1.6, head: '소련 전차가 밀려온다' },
    { to: 6.807, kind: 'split', clip: 'W02', at: 0.6, head: '하늘에서도 밀려온다' },
    {
      to: 8.031,
      kind: 'map',
      date: '1939. 11. 30',
      head: '소련의 침공',
      arrows: [
        { i: 0, at: 0, dur: 0.35 },
        { i: 1, at: 0, dur: 0.35 },
        { i: 5, at: 0, dur: 0.35 },
        { i: 2, at: 0.616, dur: 0.35 },
        { i: 3, at: 0.616, dur: 0.35 },
        { i: 4, at: 0.616, dur: 0.35 },
      ],
    },
    { to: 8.641, kind: 'split', clip: 'W09', at: 0.3, head: '누가 봐도 끝난 싸움' },
    { to: 9.231, kind: 'split', clip: 'W10', at: 1.2, head: '누가 봐도 끝난 싸움' },
    { to: 9.881, kind: 'split', clip: 'W01', at: 2.3, head: '누가 봐도 끝난 싸움' },
    { to: 10.482, kind: 'map', head: '누가 봐도 끝난 싸움' },
    { to: 10.781, kind: 'black', head: '그런데' },

    // The drop: a cut on each bar's two hits.
    { to: 11.401, kind: 'split', clip: 'W03', at: 0.3, head: '핀란드가 버틴다' },
    { to: 13.23, kind: 'split', clip: 'W06', at: 0.45, head: '핀란드가 버틴다' },
    { to: 13.85, kind: 'split', clip: 'W04', at: 0.7, head: '만네르헤임 선이 막아낸다', line: true },
    { to: 15.678, kind: 'split', clip: 'W08', at: 0.3, head: '만네르헤임 선이 막아낸다', line: true },
    { to: 17.226, kind: 'photo', photo: 'hayha', focus: [0.47, 0.34], zoom: [1, 1.5], name: '시모 해위해', sub: '하얀 사신', head: '눈 속의 저격수' },
    { to: 18.139, kind: 'split', clip: 'W07', at: 0.55, head: '소련 전차가 불탄다' },
    {
      to: 20.578,
      kind: 'map',
      head: '수오무살미 대승',
      pulse: [28.91, 64.89],
      card: { photo: 'siilasvuo', focus: [0.5, 0.42], name: '실라스부오 대령' },
      labels: [{ text: '1940. 1. 8', at2: [745, 1360], size: 76, color: '#ffd86b', at: 0.2 }],
    },
    { to: 21.183, kind: 'split', clip: 'W09', at: 1.0, head: '소련의 피해', stat: SOVIET_LOSS },
    { to: 23.024, kind: 'split', clip: 'W03', at: 0.8, head: '소련의 피해', stat: SOVIET_LOSS },
    { to: 24.239, kind: 'photo', photo: 'timoshenko', focus: [0.46, 0.34], zoom: [1, 1.22], name: '티모셴코', sub: '1940년 2월 대공세', head: '소련이 지휘관을 바꾸다' },
    { to: 25.487, kind: 'split', clip: 'W10', at: 0.8, head: '포격이 열흘간 이어진다' },
    {
      to: 27.936,
      kind: 'map',
      head: '방어선 돌파',
      line: true,
      labels: [{ text: '만네르헤임 선', lon: 29.5, lat: 60.32, size: 50, color: '#8fc0ff', at: 0.1 }],
    },
    { to: 29.133, kind: 'map', date: '1940. 3. 13', head: '영토 9%를 잃다', ceded: 27.936 },
    { to: 30.381, kind: 'split', clip: 'W12', at: 0.4, date: '1940. 3. 13', head: '그래도 독립은 지켰다', ceded: 27.936 },
    { to: END, kind: 'end', clip: 'W11', at: 0.2, ceded: 27.936 },
  ];
  let from = 0;
  for (const s of SCENES) {
    s.from = from;
    from = s.to;
  }

  // Day of the war at the video's time: 30 Nov = 1, 6 Dec = 7, 8 Jan = 40, 1 Feb = 64, 11 Feb = 74, 13 Mar = 105.
  const DAYS = [
    [8.031, 2],
    [10.781, 7],
    [15.678, 18],
    [18.139, 30],
    [20.578, 40],
    [23.024, 64],
    [25.487, 74],
    [27.936, 104],
    [28.537, 105],
    [END, 105],
  ];

  // The front, sector by sector: at each song hit a sector goes to a stage (winter.html has the stages' lines).
  const FRONT = {
    isthmus: [[6.807, 0.5], [7.423, 1], [25.487, 1.6], [26.095, 2], [27.023, 2.5], [27.633, 3]],
    ladoga: [[6.807, 0.4], [7.423, 0.8], [8.031, 1], [10.781, 1.5], [11.401, 2]],
    kuhmo: [[7.423, 0.5], [8.641, 1], [27.936, 0]],
    suomussalmi: [[7.423, 0.4], [8.031, 0.8], [8.641, 1], [18.139, 0.7], [18.74, 0.45], [19.644, 0.25], [20.279, 0]],
    salla: [[7.423, 0.4], [8.641, 0.8], [9.524, 1], [13.23, 1.5], [13.85, 2]],
    petsamo: [[6.807, 0.5], [8.031, 1], [27.936, 0.5], [28.537, 0]],
  };

  // The map's camera, one continuous move over every map scene: at each hit it jumps to [lon, lat, pixels a degree of
  // latitude, tilt in degrees] (the sized-down map of the split scenes takes it at 0.55).
  const CAM = [
    [0, 38, 60, 44, -4],
    [2.448, 36, 61, 52, -4],
    [2.814, 33, 61.5, 66, 3],
    [3.712, 30, 62.5, 84, -2.5],
    [4.343, 28.5, 63.5, 92, 2],
    [4.96, 27.8, 64.8, 96, 0],
    [6.172, 30, 61.5, 130, -2],
    [6.807, 30, 60.6, 210, -3.5],
    [7.423, 31.5, 62.2, 190, 3.5],
    [8.031, 29.8, 65, 170, -3],
    [8.641, 29.6, 67, 160, 3],
    [9.231, 30.5, 69, 180, -3],
    [9.524, 27.8, 64.9, 100, 0],
    [9.881, 27.8, 64.9, 122, 2],
    [10.482, 27.8, 64.9, 150, -2],
    [10.781, 30, 60.7, 260, -3.5],
    [11.401, 31.6, 62.1, 220, 3.5],
    [12.329, 29.5, 64.6, 170, -2.5],
    [12.94, 28, 64.9, 110, 0],
    [13.23, 29.6, 60.7, 300, -3.5],
    [13.85, 29.4, 60.7, 420, 3],
    [14.744, 29.4, 67, 180, -3],
    [15.379, 27.8, 64.9, 110, 0],
    [17.226, 29, 65, 170, 3],
    [18.139, 28.6, 65.2, 140, -3],
    [18.74, 28.9, 65, 220, 3],
    [19.644, 28.9, 65, 300, -3],
    [20.279, 29.2, 64.95, 400, 3],
    [20.578, 27.8, 64.9, 110, 0],
    [21.183, 30, 61.5, 170, -3],
    [22.123, 28.5, 64, 120, 3],
    [22.733, 27.8, 64.9, 105, 0],
    [24.239, 29.5, 60.9, 240, -3],
    [25.487, 29.4, 60.9, 320, -3.5],
    [26.095, 29.5, 60.85, 430, 3.5],
    [27.023, 29.2, 60.85, 520, -3],
    [27.633, 29, 60.8, 640, 3.5],
    [27.936, 28, 64.9, 110, 0],
    [28.537, 28, 64.9, 118, 1.5],
    [29.133, 28, 64.9, 118, 0],
  ];

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.WINTER = { BAR, BEAT, LENGTH: END, SCENES, DAYS, FRONT, CAM, STRONG, SOFT, SONG_START: 0.25 };
})();
