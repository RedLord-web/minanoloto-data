// 楽天×宝くじの月別バックナンバーページから当せん結果を取得する
// (みずほ銀行が Akamai でブロック後、こちらに切替)
//
// URL 形式:
//   https://takarakuji.rakuten.co.jp/backnumber/<game>/        ← 当月
//   https://takarakuji.rakuten.co.jp/backnumber/<game>/YYYYMM/ ← 月別
//
// ScraperAPI 不要 (直接アクセス可能)。
import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return await res.text();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 現在月と前月 (例えば月初の取りこぼし防止) の URL を返す
function buildUrls(game) {
  const now = new Date();
  // JST 基準で month を計算 (UTC + 9h)
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + 1;
  const prevD = new Date(Date.UTC(y, m - 2, 1));
  const py = prevD.getUTCFullYear();
  const pm = prevD.getUTCMonth() + 1;

  return [
    `https://takarakuji.rakuten.co.jp/backnumber/${game}/`,
    `https://takarakuji.rakuten.co.jp/backnumber/${game}/${y}${pad2(m)}/`,
    `https://takarakuji.rakuten.co.jp/backnumber/${game}/${py}${pad2(pm)}/`,
  ];
}

async function fetchPages(game) {
  const urls = buildUrls(game);
  const pages = [];
  for (const url of urls) {
    try {
      console.log(`  fetching ${url}`);
      const html = await fetchHtml(url);
      console.log(`    ✓ got ${html.length} chars`);
      pages.push({ url, html });
    } catch (e) {
      console.log(`    ✗ ${e.message}`);
    }
  }
  if (pages.length === 0) throw new Error('all pages failed');
  return pages;
}

function parseDate(text) {
  // "2026/06/22" 形式
  const m = text.match(/(\d{4})\s*[\/年]\s*(\d{1,2})\s*[\/月]\s*(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function parseAmount(s) {
  if (!s) return null;
  const m = String(s).replace(/\s/g, '').match(/[\d,]+/);
  return m ? parseInt(m[0].replace(/,/g, ''), 10) : null;
}

function parseCount(s) {
  return parseAmount(s);
}

// ─── LOTO 6 / 7 ─────────────────────────────────────────────────────────────
const LOTO_RANK_ORDER_6 = ['1st', '2nd', '3rd', '4th', '5th'];
const LOTO_RANK_ORDER_7 = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

function parseLotoTable($, table, isLoto7) {
  const rows = $(table).find('tr');
  let round = null;
  let date = '';
  let numbers = [];
  let bonus = isLoto7 ? [] : 0;
  let bonusArr = [];
  const prizes = {};
  let carryover = 0;

  rows.each((_, tr) => {
    const th = $(tr).find('th').first().text().trim();
    const tdText = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    const joined = tdText.join(' ').replace(/\s+/g, ' ').trim();

    if (th === '回号') {
      const m = $(tr).find('th').eq(1).text().match(/第\s*(\d+)\s*回/);
      if (m) round = parseInt(m[1], 10);
    } else if (th === '抽せん日') {
      date = parseDate(joined);
    } else if (th === '本数字') {
      // 各 td 内の span に数字
      numbers = $(tr).find('td span.loto-font-large')
        .map((_, el) => parseInt($(el).text().trim(), 10))
        .get()
        .filter((n) => !Number.isNaN(n));
    } else if (th === 'ボーナス数字') {
      bonusArr = $(tr).find('td span')
        .map((_, el) => {
          const t = $(el).text().replace(/[()（）]/g, '').trim();
          const n = parseInt(t, 10);
          return Number.isNaN(n) ? null : n;
        })
        .get()
        .filter((n) => n !== null);
    } else if (/^\d+等$/.test(th)) {
      const rank = parseInt(th, 10);
      // 該当なし or "N口" + "Y,Y,Y円"
      const countMatch = joined.match(/([\d,]+)\s*口/);
      const amountMatch = joined.match(/([\d,]+)\s*円/);
      const rankKey = isLoto7 ? LOTO_RANK_ORDER_7[rank - 1] : LOTO_RANK_ORDER_6[rank - 1];
      if (!rankKey) return;
      if (countMatch && amountMatch) {
        prizes[rankKey] = {
          count: parseCount(countMatch[1]),
          amount: parseAmount(amountMatch[1]),
        };
      } else {
        // 該当なし
        prizes[rankKey] = { count: 0, amount: 0 };
      }
    } else if (th === 'キャリーオーバー') {
      const m = joined.match(/([\d,]+)\s*円/);
      if (m) carryover = parseAmount(m[1]);
    }
  });

  if (round === null) return null;
  if (!date) return null;
  const pickCount = isLoto7 ? 7 : 6;
  if (numbers.length !== pickCount) return null;
  bonus = isLoto7 ? bonusArr.slice(0, 2) : (bonusArr[0] ?? 0);

  return { round, date, numbers, bonus, prizes, carryover };
}

async function scrapeLotoImpl(gameType) {
  const isLoto7 = gameType === 'loto7';
  const pages = await fetchPages(gameType);

  const seen = new Set();
  const results = [];
  for (const { url, html } of pages) {
    const $ = cheerio.load(html);
    const tables = $('table.tblNumberGuid');
    let pageCount = 0;
    tables.each((_, t) => {
      const parsed = parseLotoTable($, t, isLoto7);
      if (parsed && !seen.has(parsed.round)) {
        seen.add(parsed.round);
        results.push(parsed);
        pageCount++;
      }
    });
    console.log(`    [${url}]: ${tables.length} tables → ${pageCount} new rounds`);
  }

  const sorted = [...seen].sort((a, b) => a - b);
  if (sorted.length > 0) {
    console.log(`  total extracted: ${results.length} rounds (${sorted[0]}~${sorted[sorted.length - 1]})`);
  } else {
    console.log(`  total extracted: 0 rounds`);
  }
  return results;
}

// ─── NUMBERS 3 / 4 ──────────────────────────────────────────────────────────
const NUMBERS_PRIZE_LABELS_N3 = {
  straight: 'ストレート',
  box: 'ボックス',
  set_straight: 'セット（ストレート）',
  set_box: 'セット（ボックス）',
  mini: 'ミニ',
};
const NUMBERS_PRIZE_LABELS_N4 = {
  straight: 'ストレート',
  box: 'ボックス',
  set_straight: 'セット（ストレート）',
  set_box: 'セット（ボックス）',
};

function parseNumbersTable($, table, digits) {
  const rows = $(table).find('tr');
  let round = null;
  let date = '';
  let numStr = '';
  const prizes = {};
  const labels = digits === 4 ? NUMBERS_PRIZE_LABELS_N4 : NUMBERS_PRIZE_LABELS_N3;
  const labelToKey = Object.fromEntries(Object.entries(labels).map(([k, v]) => [v, k]));

  rows.each((_, tr) => {
    const th = $(tr).find('th').first().text().trim();
    const tdText = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    const joined = tdText.join(' ').replace(/\s+/g, ' ').trim();

    if (th === '回号') {
      const m = $(tr).find('th').eq(1).text().match(/第\s*(\d+)\s*回/);
      if (m) round = parseInt(m[1], 10);
    } else if (th === '抽せん日') {
      date = parseDate(joined);
    } else if (th === '当せん番号') {
      // td 안의 텍스트가 곧 숫자
      const m = joined.match(/\d+/);
      if (m) numStr = m[0];
    } else if (labelToKey[th]) {
      const countMatch = joined.match(/([\d,]+)\s*口/);
      const amountMatch = joined.match(/([\d,]+)\s*円/);
      if (countMatch && amountMatch) {
        prizes[labelToKey[th]] = {
          count: parseCount(countMatch[1]),
          amount: parseAmount(amountMatch[1]),
        };
      } else {
        prizes[labelToKey[th]] = { count: 0, amount: 0 };
      }
    }
  });

  if (round === null) return null;
  if (!date) return null;
  if (!numStr || numStr.length !== digits) return null;

  return { round, date, numbers: numStr, prizes };
}

async function scrapeNumbersImpl(gameType) {
  const digits = gameType === 'numbers4' ? 4 : 3;
  const pages = await fetchPages(gameType);

  const seen = new Set();
  const results = [];
  for (const { url, html } of pages) {
    const $ = cheerio.load(html);
    const tables = $('table.tblNumberGuid');
    let pageCount = 0;
    tables.each((_, t) => {
      const parsed = parseNumbersTable($, t, digits);
      if (parsed && !seen.has(parsed.round)) {
        seen.add(parsed.round);
        results.push(parsed);
        pageCount++;
      }
    });
    console.log(`    [${url}]: ${tables.length} tables → ${pageCount} new rounds`);
  }

  const sorted = [...seen].sort((a, b) => a - b);
  if (sorted.length > 0) {
    console.log(`  total extracted: ${results.length} rounds (${sorted[0]}~${sorted[sorted.length - 1]})`);
  } else {
    console.log(`  total extracted: 0 rounds`);
  }
  return results;
}

export async function scrapeLoto(gameType) {
  return scrapeLotoImpl(gameType);
}

export async function scrapeNumbers(gameType) {
  return scrapeNumbersImpl(gameType);
}
