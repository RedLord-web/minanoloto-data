import * as cheerio from 'cheerio';
import { fetchText } from '../lib/fetch.mjs';

// メインページ (最新 ~6 LOTO / ~16 NUMBERS) と
// 月別アーカイブ (当月 + 前月) を fetch する。
// アーカイブ URL 形式: /takarakuji/check/<cat>/<game>/index.html?year=YYYY&month=M
const MAIN_URLS = {
  loto6:    'https://www.mizuhobank.co.jp/retail/takarakuji/loto/loto6/index.html',
  loto7:    'https://www.mizuhobank.co.jp/retail/takarakuji/loto/loto7/index.html',
  numbers3: 'https://www.mizuhobank.co.jp/retail/takarakuji/numbers/numbers3/index.html',
  numbers4: 'https://www.mizuhobank.co.jp/retail/takarakuji/numbers/numbers4/index.html',
};
const CATEGORY = {
  loto6: 'loto', loto7: 'loto', numbers3: 'numbers', numbers4: 'numbers',
};

function archiveUrl(game, year, month) {
  const cat = CATEGORY[game];
  return `https://www.mizuhobank.co.jp/takarakuji/check/${cat}/${game}/index.html?year=${year}&month=${month}`;
}

function buildUrls(game) {
  const now = new Date();
  const cur = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 };
  const prevD = new Date(Date.UTC(cur.y, cur.m - 2, 1));
  const prev = { y: prevD.getUTCFullYear(), m: prevD.getUTCMonth() + 1 };
  return [
    MAIN_URLS[game],
    archiveUrl(game, cur.y, cur.m),
    archiveUrl(game, prev.y, prev.m),
  ];
}

// 各 URL を順番に取得 (どれかが 404 等で失敗しても他の結果を返す)
async function fetchHtmlPages(gameType) {
  const urls = buildUrls(gameType);
  const pages = [];
  for (const url of urls) {
    try {
      console.log(`  fetching ${url} (render=true)`);
      const html = await fetchText(url, { encoding: 'utf-8', render: true });
      console.log(`    ✓ got ${html.length} chars`);
      pages.push({ url, html });
    } catch (e) {
      console.log(`    ✗ ${e.message}`);
    }
  }
  if (pages.length === 0) throw new Error('all pages failed');
  return pages;
}


// "1,234" → 1234, "5口" → 5 等
function parseJpNum(s) {
  if (s == null) return null;
  const m = String(s).match(/[\d,]+/);
  return m ? parseInt(m[0].replace(/,/g, ''), 10) : null;
}

function parseDate(text) {
  const m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

// ─── LOTO 6 / LOTO 7 ────────────────────────────────────────────────────────
function parseLotoTable(text, isLoto7) {
  const pickCount = isLoto7 ? 7 : 6;

  const roundMatch = text.match(/第\s*(\d+)\s*回/);
  if (!roundMatch) return null;
  const round = parseInt(roundMatch[1], 10);

  const date = parseDate(text);
  if (!date) return null;

  // 本数字 ... ボーナス数字 の間にある数字を pickCount 個取り出す
  const mainMatch = text.match(/本数字\s+([\d\s]+?)\s*ボーナス数字/);
  if (!mainMatch) return null;
  const mainDigits = (mainMatch[1].match(/\d+/g) ?? []).map(Number);
  if (mainDigits.length < pickCount) return null;
  const numbers = mainDigits.slice(0, pickCount);

  // ボーナス数字 (NN) [(NN)] 1等 ... の間にある () 内の数字
  const bonusMatch = text.match(/ボーナス数字\s+(.+?)\s*1\s*等/);
  if (!bonusMatch) return null;
  const bonusDigits = (bonusMatch[1].match(/\d+/g) ?? []).map(Number);
  const bonus = isLoto7 ? bonusDigits.slice(0, 2) : (bonusDigits[0] ?? 0);

  // 賞金: 1等 X口 Y,Y,Y円 ... (LOTO 6 は 5 等まで, LOTO 7 は 6 等まで)
  const rankNames = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  const prizes = {};
  const maxRank = isLoto7 ? 6 : 5;
  for (let r = 1; r <= maxRank; r++) {
    const re = new RegExp(`${r}\\s*等[^口]*?([\\d,]+)\\s*口\\s+([\\d,]+)\\s*円`);
    const m = text.match(re);
    if (m) {
      prizes[rankNames[r - 1]] = {
        count: parseInt(m[1].replace(/,/g, ''), 10),
        amount: parseInt(m[2].replace(/,/g, ''), 10),
      };
    }
  }

  // キャリーオーバー X,XXX,XXX円
  const carryMatch = text.match(/キャリーオーバー\s+([\d,]+)\s*円/);
  const carryover = carryMatch ? parseInt(carryMatch[1].replace(/,/g, ''), 10) : 0;

  return { round, date, numbers, bonus, prizes, carryover };
}

async function scrapeLotoHtml(gameType) {
  const isLoto7 = gameType === 'loto7';
  const pages = await fetchHtmlPages(gameType);

  const seen = new Set();
  const results = [];
  for (const { url, html } of pages) {
    const $ = cheerio.load(html);
    const tables = $('table.section__table');
    let pageCount = 0;
    tables.each((_, t) => {
      const text = $(t).text().trim().replace(/\s+/g, ' ');
      const parsed = parseLotoTable(text, isLoto7);
      if (parsed && !seen.has(parsed.round)) {
        seen.add(parsed.round);
        results.push(parsed);
        pageCount++;
      }
    });
    const label = url.includes('check/') ? url.split('?')[1] : 'main';
    console.log(`    [${label}]: ${tables.length} tables → ${pageCount} new rounds`);
  }

  const sorted = [...seen].sort((a, b) => a - b);
  console.log(`  total extracted: ${results.length} rounds (${sorted[0]}~${sorted[sorted.length - 1]})`);
  return results;
}

// ─── NUMBERS 3 / NUMBERS 4 ──────────────────────────────────────────────────
const NUMBERS_PRIZE_LABELS_N3 = {
  straight:     'ストレート',
  box:          'ボックス',
  set_straight: 'セット（ストレート）',
  set_box:      'セット（ボックス）',
  mini:         'ミニ',
};
const NUMBERS_PRIZE_LABELS_N4 = {
  straight:     'ストレート',
  box:          'ボックス',
  set_straight: 'セット（ストレート）',
  set_box:      'セット（ボックス）',
};

function parseNumbersTable(text, digits) {
  const roundMatch = text.match(/第\s*(\d+)\s*回/);
  if (!roundMatch) return null;
  const round = parseInt(roundMatch[1], 10);

  const date = parseDate(text);
  if (!date) return null;

  // 抽せん数字 NNN [NNNN] ストレート
  const numMatch = text.match(/抽せん数字\s+(\d+)/);
  if (!numMatch) return null;
  const numStr = numMatch[1];
  if (numStr.length !== digits) return null;

  const labels = digits === 4 ? NUMBERS_PRIZE_LABELS_N4 : NUMBERS_PRIZE_LABELS_N3;
  const prizes = {};
  for (const [key, label] of Object.entries(labels)) {
    // 「セット（ストレート）」 内の全角括弧は正規表現的に普通の文字
    const re = new RegExp(`${label}\\s+([\\d,]+)\\s*口\\s+([\\d,]+)\\s*円`);
    const m = text.match(re);
    if (m) {
      prizes[key] = {
        count: parseInt(m[1].replace(/,/g, ''), 10),
        amount: parseInt(m[2].replace(/,/g, ''), 10),
      };
    }
  }

  return { round, date, numbers: numStr, prizes };
}

async function scrapeNumbersHtml(gameType) {
  const digits = gameType === 'numbers4' ? 4 : 3;
  const pages = await fetchHtmlPages(gameType);

  const seen = new Set();
  const results = [];
  for (const { url, html } of pages) {
    const $ = cheerio.load(html);
    const tables = $('table.section__table');
    let pageCount = 0;
    tables.each((_, t) => {
      const text = $(t).text().trim().replace(/\s+/g, ' ');
      const parsed = parseNumbersTable(text, digits);
      if (parsed && !seen.has(parsed.round)) {
        seen.add(parsed.round);
        results.push(parsed);
        pageCount++;
      }
    });
    const label = url.includes('check/') ? url.split('?')[1] : 'main';
    console.log(`    [${label}]: ${tables.length} tables → ${pageCount} new rounds`);
  }

  const sorted = [...seen].sort((a, b) => a - b);
  console.log(`  total extracted: ${results.length} rounds (${sorted[0]}~${sorted[sorted.length - 1]})`);
  return results;
}

export async function scrapeLoto(gameType) {
  return scrapeLotoHtml(gameType);
}

export async function scrapeNumbers(gameType) {
  return scrapeNumbersHtml(gameType);
}
