export function normalizeRemoteImageUrl(url: URL): URL {
  const normalized = new URL(url);
  if (/^p\d+-tt\.bytecdn\.cn$/i.test(normalized.hostname))
    normalized.hostname = normalized.hostname.replace(/-tt\.bytecdn\.cn$/i, '-novel.byteimg.com');
  return normalized;
}

export function remoteImageHeaders(url: URL, userAgent: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    Accept: 'image/*',
  };
  if (/(^|\.)doubanio\.com$/i.test(url.hostname)) headers.Referer = 'https://book.douban.com/';
  else if (/(^|\.)(byteimg\.com|bytecdn\.cn)$/i.test(url.hostname)) headers.Referer = 'https://fanqienovel.com/';
  else if (/(^|\.)(wtzw|qimao)\.com$/i.test(url.hostname)) headers.Referer = 'https://www.qimao.com/';
  else if (url.hostname === 'bkimg.cdn.bcebos.com' || /(^|\.)bdimg\.com$/i.test(url.hostname)) headers.Referer = 'https://wapbaike.baidu.com/';
  return headers;
}
