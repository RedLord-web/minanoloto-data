import { fetchText } from '../lib/fetch.mjs';

// Mizuho の CSV エンドポイント (試行順)
// CSV は Shift_JIS でエンコードされている
const CSV_URLS = {
  loto6: [
    'https://www.mizuhobank.co.jp/retail/takarakuji/loto/loto6/csv/loto6.csv',
    'https://www.mizuhobank.co.jp/retail/takarakuji/check/loto/loto6/csv/loto6.csv',
  ],
  loto7: [
    'https://www.mizuhobank.co.jp/retail/takarakuji/loto/loto7/csv/loto7.csv',
    'https://www.mizuhobank.co.jp/retail/takarakuji/check/loto/loto7/csv/loto7.csv',
  ],
  numbers3: [
    'https://www.mizuhobank.co.jp/retail/takarakuji/numbers/numbers3/csv/numbers3.csv',
    'https://www.mizuhobank.co.jp/retail/takarakuji/check/numbers/numbers3/csv/numbers3.csv',
  ],
  numbers4: [
    'https://www.mizuhobank.co.jp/retail/takarakuji/numbers/numbers4/csv/numbers4.csv',
    'https://www.mizuhobank.co.jp/retail/takarakuji/check/numbers/numbers4/csv/numbers4.csv',
  ],
};

async function tryFetchCsv(urls) {
  let lastErr;
  for (const url of urls) {
    try {
      console.log(`  trying ${url}`);
      const text = await fetchText(url, { encoding: 'Shift_JIS' });
      console.log(`  ✓ got ${text.length} chars`);
      return { url, text };
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('All CSV URLs failed');
}

// "2025/12/18" or "2025年12月18日" or "20251218" → ISO "2025-12-18"
function normalizeDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  let m;
  if ((m = s.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/))) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return s;
}

// CSV 1 行を { round, draw_date, numbers, bonus } に
function parseLotoRow(cols, isLoto7) {
  const round = parseInt(String(cols[0]).replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(round)) return null;
  const draw_date = normalizeDate(cols[1]);

  const pickCount = isLoto7 ? 7 : 6;
  const numbers = [];
  for (let i = 0; i < pickCount; i++) {
    const n = parseInt(String(cols[2 + i]).replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(n)) return null;
    numbers.push(n);
  }

  let bonus;
  if (isLoto7) {
    // LOTO 7: 2つのボーナス数字
    const b1 = parseInt(String(cols[2 + pickCount]).replace(/[^\d]/g, ''), 10);
    const b2 = parseInt(String(cols[3 + pickCount]).replace(/[^\d]/g, ''), 10);
    bonus = [b1, b2].filter(Number.isFinite);
  } else {
    const b = parseInt(String(cols[2 + pickCount]).replace(/[^\d]/g, ''), 10);
    bonus = Number.isFinite(b) ? b : 0;
  }

  return { round, draw_date, numbers, bonus };
}

function parseNumbersRow(cols, digits) {
  const round = parseInt(String(cols[0]).replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(round)) return null;
  const draw_date = normalizeDate(cols[1]);

  const raw = String(cols[2] ?? '').trim().replace(/[^\d]/g, '');
  if (raw.length !== digits) return null;
  return { round, draw_date, numbers: raw };
}

function parseCsv(text) {
  const rows = [];
  // 改行とカンマだけの素朴な CSV パーサで十分 (Mizuho の CSV は引用符なし)
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(',').map((c) => c.trim());
    rows.push(cols);
  }
  return rows;
}

// LOTO 6 / LOTO 7 を取得
export async function scrapeLoto(gameType) {
  const isLoto7 = gameType === 'loto7';
  const { url, text } = await tryFetchCsv(CSV_URLS[gameType]);
  const rows = parseCsv(text);
  console.log(`  parsed ${rows.length} CSV rows from ${url}`);

  // デバッグ: 実際の CSV 構造を確認
  console.log('  first 300 chars (raw):', JSON.stringify(text.substring(0, 300)));
  console.log('  sample rows:');
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    console.log(`    [${i}] (${rows[i].length} cols):`, JSON.stringify(rows[i]));
  }

  const results = [];
  for (const cols of rows) {
    const r = parseLotoRow(cols, isLoto7);
    if (r) results.push(r);
  }
  console.log(`  valid rounds: ${results.length}`);
  return results;
}

// NUMBERS 3 / NUMBERS 4 を取得
export async function scrapeNumbers(gameType) {
  const digits = gameType === 'numbers4' ? 4 : 3;
  const { url, text } = await tryFetchCsv(CSV_URLS[gameType]);
  const rows = parseCsv(text);
  console.log(`  parsed ${rows.length} CSV rows from ${url}`);

  const results = [];
  for (const cols of rows) {
    const r = parseNumbersRow(cols, digits);
    if (r) results.push(r);
  }
  console.log(`  valid rounds: ${results.length}`);
  return results;
}
