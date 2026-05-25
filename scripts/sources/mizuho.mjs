import * as cheerio from 'cheerio';
import { fetchText } from '../lib/fetch.mjs';

const HTML_URLS = {
  loto6:    'https://www.mizuhobank.co.jp/retail/takarakuji/loto/loto6/index.html',
  loto7:    'https://www.mizuhobank.co.jp/retail/takarakuji/loto/loto7/index.html',
  numbers3: 'https://www.mizuhobank.co.jp/retail/takarakuji/numbers/numbers3/index.html',
  numbers4: 'https://www.mizuhobank.co.jp/retail/takarakuji/numbers/numbers4/index.html',
};

// 令和年 → 西暦年
function reiwaToAd(reiwaYear) {
  return 2018 + reiwaYear;
}

function parseJapaneseDate(text) {
  if (!text) return '';
  let m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = text.match(/令和\s*(\d+)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) {
    const ad = reiwaToAd(parseInt(m[1], 10));
    return `${ad}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  return '';
}

async function fetchHtml(gameType) {
  const url = HTML_URLS[gameType];
  console.log(`  fetching ${url} (render=true)`);
  // Mizuho は JavaScript で結果を動的にロードするので render=true 必須
  const html = await fetchText(url, { encoding: 'utf-8', render: true });
  console.log(`  ✓ got ${html.length} chars`);
  return { url, html };
}

// テーブルの行を取り出すヘルパー
function tableRows($, tableEl) {
  const rows = [];
  $(tableEl).find('tr').each((_, tr) => {
    const cells = [];
    $(tr).find('th, td').each((_, c) => {
      cells.push($(c).text().trim().replace(/\s+/g, ' '));
    });
    if (cells.length > 0) rows.push(cells);
  });
  return rows;
}

// "01" "1" "1,2" 等から数字配列へ
function extractDigits(text) {
  return Array.from(text.matchAll(/\d+/g)).map((m) => parseInt(m[0], 10));
}

function dumpStructure($) {
  // ページタイトル
  const title = $('title').text().trim();
  console.log(`  <title>: ${title}`);

  // 数字を含む可能性のある要素を class 名でざっくり調査
  const candidates = $('table, ul, dl, div').filter((_, el) => {
    const cls = $(el).attr('class') || '';
    return /num|loto|kuji|result|win/i.test(cls);
  });
  console.log(`  candidate elements: ${candidates.length}`);
  candidates.slice(0, 6).each((i, el) => {
    const tag = el.tagName;
    const cls = $(el).attr('class') || '';
    const txt = $(el).text().trim().replace(/\s+/g, ' ').substring(0, 120);
    console.log(`    [${i}] <${tag} class="${cls}">: ${txt}`);
  });

  // テーブル全部
  console.log(`  all tables: ${$('table').length}`);
  $('table').each((i, t) => {
    if (i >= 4) return;
    const cls = $(t).attr('class') || '';
    const txt = $(t).text().trim().replace(/\s+/g, ' ').substring(0, 140);
    console.log(`    table[${i}] class="${cls}": ${txt}`);
  });
}

async function scrapeLotoHtml(gameType) {
  const isLoto7 = gameType === 'loto7';
  const pickCount = isLoto7 ? 7 : 6;

  const { html } = await fetchHtml(gameType);
  const $ = cheerio.load(html);

  // メインテーブル: 回別 | 抽せん日 | 本数字 | ボーナス数字 | 販売実績額 | キャリーオーバー
  const mainTable = $('table.js-lottery-temp-pc').first();
  if (mainTable.length === 0) {
    console.log('  ✗ no main table (js-lottery-temp-pc) found');
    dumpStructure($);
    return [];
  }

  const rows = tableRows($, mainTable);
  console.log(`  main table rows: ${rows.length}`);
  for (let i = 0; i < Math.min(4, rows.length); i++) {
    console.log(`    [${i}] (${rows[i].length}):`, JSON.stringify(rows[i]));
  }

  const results = [];
  // i=0 は通常ヘッダー
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length < 4) continue;

    const round = parseInt(String(cells[0]).replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(round)) continue;

    const draw_date = parseJapaneseDate(cells[1]);

    const mainDigits = extractDigits(cells[2]);
    if (mainDigits.length < pickCount) continue;
    const numbers = mainDigits.slice(0, pickCount);

    const bonusDigits = extractDigits(cells[3]);
    const bonus = isLoto7
      ? bonusDigits.slice(0, 2)
      : (Number.isFinite(bonusDigits[0]) ? bonusDigits[0] : 0);

    results.push({ round, draw_date, numbers, bonus });
  }

  console.log(`  valid rounds: ${results.length}`);
  return results;
}

async function scrapeNumbersHtml(gameType) {
  const digits = gameType === 'numbers4' ? 4 : 3;

  const { html } = await fetchHtml(gameType);
  const $ = cheerio.load(html);

  const mainTable = $('table.js-lottery-temp-pc').first();
  if (mainTable.length === 0) {
    console.log('  ✗ no main table (js-lottery-temp-pc) found');
    dumpStructure($);
    return [];
  }

  const rows = tableRows($, mainTable);
  console.log(`  main table rows: ${rows.length}`);
  for (let i = 0; i < Math.min(4, rows.length); i++) {
    console.log(`    [${i}] (${rows[i].length}):`, JSON.stringify(rows[i]));
  }

  const results = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length < 3) continue;

    const round = parseInt(String(cells[0]).replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(round)) continue;

    const draw_date = parseJapaneseDate(cells[1]);
    const numText = String(cells[2]).replace(/[^\d]/g, '');
    if (numText.length !== digits) continue;

    results.push({ round, draw_date, numbers: numText });
  }

  console.log(`  valid rounds: ${results.length}`);
  return results;
}

export async function scrapeLoto(gameType) {
  return scrapeLotoHtml(gameType);
}

export async function scrapeNumbers(gameType) {
  return scrapeNumbersHtml(gameType);
}
