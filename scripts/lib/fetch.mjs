import iconv from 'iconv-lite';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const COMMON_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Referer': 'https://www.mizuhobank.co.jp/',
};

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

// SCRAPER_API_KEY が設定されている場合は ScraperAPI 経由でリクエストを送る
// (Akamai が直接アクセスをブロックするため)
// render: true で JavaScript 実行 (5 credits/req) — Mizuho は動的レンダリング必須
function wrapUrl(url, { render = false } = {}) {
  if (!SCRAPER_API_KEY) return url;
  const params = new URLSearchParams({
    api_key: SCRAPER_API_KEY,
    url,
    country_code: 'jp',
  });
  if (render) params.set('render', 'true');
  return `https://api.scraperapi.com/?${params}`;
}

export async function fetchText(url, { encoding = 'utf-8', render = false } = {}) {
  const target = wrapUrl(url, { render });
  // render 経由は内部でヘッドレスブラウザを起動するので timeout を伸ばす
  const res = await fetch(target, {
    headers: COMMON_HEADERS,
    redirect: 'follow',
    signal: render ? AbortSignal.timeout(90_000) : AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (encoding === 'utf-8') return buf.toString('utf-8');
  return iconv.decode(buf, encoding);
}
