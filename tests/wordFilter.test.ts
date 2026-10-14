import { describe, expect, it } from 'vitest';
import { filterText, profane } from '@/net/wordFilter';

describe('word filter', () => {
  it('masks swearing in its usual spellings and with letters split up', () => {
    for (const bad of ['씨발', '시발', 'ㅅㅂ', '씨1발', '시.발', '시 발', 'ㅅ ㅂ', '병신', 'ㅂㅅ', '지랄', '개새끼', '좆같네', '존나', '니애미', '느금마', 'fuck', 'f.u.c.k', 'f u c k', 'sh1t', 'b1tch', 'motherfucker', 'FUCK']) {
      expect(profane(bad), bad).toBe(true);
    }
    expect(filterText('야 씨1발 뭐함').text).toBe('야 *** 뭐함');
    expect(filterText('what the fuck man').text).toBe('what the **** man');
  });

  it('leaves ordinary talk alone', () => {
    for (const ok of ['다시 발사해', '시발점부터 다시', '새끼손가락 걸고', '마음에 새기다', '안녕하세요', 'B 거점 가자', '5개년 계획', '좋은 게임이었어요', 'class assassin', 'scunthorpe', 'hello there', '에미레이트 항공', '아니 미안해', '수고하셨습니다', '시벨리우스']) {
      expect(profane(ok), ok).toBe(false);
    }
  });

  it('takes extra words (the server list)', () => {
    expect(filterText('이건 바보야', ['바보']).text).toBe('이건 **야');
  });
});
