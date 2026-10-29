import { describe, expect, it } from 'vitest';
import { parseBaiduAuthor, parseQidianAuthor, parseDoubanBookAuthor, parseFanqieAuthor, authorImage, checkedAuthorPage } from './chinese-author-page';
const baidu = (occupation = '作家') =>
  `<meta name="description" content="作者简介"><meta property="og:image" content="https://bkimg.cdn.bcebos.com/pic/a.jpg"><script id="__NEXT_DATA__">${JSON.stringify(
    {
      props: {
        pageProps: {
          pageData: {
            lemmaId: 6447807,
            lemmaTitle: '天下霸唱',
            card: {
              content: [
                { key: 'occupation', data: [{ text: [{ tag: 'text', text: occupation }] }] },
                {
                  key: 'dateOfBirth',
                  data: [
                    {
                      text: [
                        { tag: 'text', text: '1978年' },
                        { tag: 'ref', text: '2025' },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  )}</script>`;
describe('Chinese author pages', () => {
  it('reads a genuine author biography and birth year without reference text', () => {
    expect(parseBaiduAuthor(baidu())).toMatchObject({
      provider: 'baiduBaike',
      name: '天下霸唱',
      birthYear: 1978,
      description: '作者简介',
      providerId: '天下霸唱/6447807',
    });
  });
  it('does not turn unrelated encyclopedia entries into authors', () => expect(parseBaiduAuthor(baidu('演员'))).toBeNull());
  it('rejects verification pages and malformed structures', () => {
    expect(() => checkedAuthorPage('<form id="sec"></form>')).toThrow('验证');
    expect(() => parseBaiduAuthor('<h1>作者</h1>')).toThrow('词条');
    expect(() => parseQidianAuthor('<h1>搜索</h1>', '42')).toThrow('主页');
  });
  it('reads Qidian biography and real portrait rather than placeholder SVG', () => {
    expect(
      parseQidianAuthor(
        '<div class="_authorName_hash"><h2>忘语</h2></div><p class="_authorDesc_hash">作家简介</p><script>{"avatar":"https://ccportrait.yuewen.com/a.jpg"}</script>',
        '4362771',
      ),
    ).toMatchObject({ name: '忘语', description: '作家简介', imageUrl: 'https://ccportrait.yuewen.com/a.jpg' });
  });
  it('does not substitute book summaries or ambiguous coauthor biographies', () => {
    const html =
      '<div id="info"><span><span class="pl">作者:</span><a>天下霸唱</a></span></div><div id="author-report"><div class="intro">作者传记</div></div><div id="link-report">图书内容</div>';
    expect(parseDoubanBookAuthor(html, '42', '天下霸唱')).toMatchObject({ name: '天下霸唱', description: '作者传记' });
    expect(parseDoubanBookAuthor(html, '42', '另一作者')).toBeNull();
    expect(parseDoubanBookAuthor(html.replace('<a>天下霸唱</a>', '<a>天下霸唱</a><a>其他人</a>'), '42')).toBeNull();
    expect(parseDoubanBookAuthor(html.replace('id="author-report"', 'id="other"'), '42')).toBeNull();
  });
  it('reads the explicit author biography heading without taking a nearby book summary', () => {
    const html =
      '<div id="info"><span><span class="pl">作者:</span><a>天下霸唱</a></span></div><h2><span>内容简介</span></h2><div class="intro">图书情节</div><h2><span>作者简介</span></h2><div><div class="intro">作家生平</div></div><h2>目录</h2><div class="intro">章节</div>';
    expect(parseDoubanBookAuthor(html, '42', '天下霸唱')?.description).toBe('作家生平');
  });

  it('does not persist obfuscated Fanqie biography characters as readable text', () => {
    const html = '<div><div><h1 class="title">作家</h1></div><div class="desc">简介</div></div>';
    expect(parseFanqieAuthor(html, '42')).toMatchObject({ name: '作家', description: '简介' });
    expect(parseFanqieAuthor(html.replace('简介', '\ue000文字'), '42').description).toBeUndefined();
  });
  it('rejects credentialed, insecure and forged image origins', () => {
    for (const url of [
      'http://ccportrait.yuewen.com/a',
      'https://u@ccportrait.yuewen.com/a',
      'https://yuewen.com.evil.test/a',
      'https://ccportrait.yuewen.com:8443/a',
    ])
      expect(authorImage(url, ['yuewen.com'])).toBeUndefined();
  });
});
