import type { PublicChapterRule } from '@bookorbit/types';
export const publicRule: PublicChapterRule = {
  key: 'sample',
  label: '公开测试来源',
  origin: 'https://books.example.org',
  bookPath: '/book/{id}/',
  catalogPath: '/book/{id}/toc/',
  titleSelector: 'h1',
  authorSelector: '.author',
  chapterLinkSelector: 'a.chapter',
  chapterPublicSelector: '.free',
  chapterRestrictedSelector: '.vip',
  chapterHeadingSelector: 'h1',
  publicPageSelector: '.public-content',
  restrictedPageSelector: '.login,.paywall',
  contentSelector: 'main',
};
