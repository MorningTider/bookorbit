import { describe, expect, it } from 'vitest';
import { remoteImageHeaders } from './remote-image-headers';
describe('source-specific image requests', () => {
  it.each([
    ['https://img1.doubanio.com/cover.jpg', 'https://book.douban.com/'],
    ['https://p1-novel.byteimg.com/cover.jpg', 'https://fanqienovel.com/'],
    ['https://cdn.wtzw.com/bookimg/cover.jpg', 'https://www.qimao.com/'],
    ['https://bkimg.cdn.bcebos.com/pic/cover.jpg', 'https://wapbaike.baidu.com/'],
  ])('uses the publisher origin for %s', (url, referer) => {
    expect(remoteImageHeaders(new URL(url), 'BookOrbit')).toMatchObject({ Referer: referer, Accept: 'image/*' });
  });
  it('does not send publisher headers to an unrelated or lookalike hostname', () => {
    expect(remoteImageHeaders(new URL('https://cdn.wtzw.com.example.org/image'), 'BookOrbit')).not.toHaveProperty('Referer');
  });
});
