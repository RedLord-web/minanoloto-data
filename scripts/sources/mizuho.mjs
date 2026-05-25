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
  console.log(`  fetching ${url}`);
  // ScraperAPI は基本 UTF-8 にデコードして返す
  const html = await fetchText(url, { encoding: 'utf-8' });
  console.log(`  ✓ got ${html.length} chars`);
  return { url, html };
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
  const { html } = await fetchHtml(gameType);
  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  const roundMatch = bodyText.match(/第\s*([\d,]+)\s*回/);
  const dateMatch = bodyText.match(/(令和\s*\d+|\d{4})\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/);

  const round = roundMatch ? parseInt(roundMatch[1].replace(/,/g, ''), 10) : null;
  const draw_date = dateMatch ? parseJapaneseDate(dateMatch[0]) : '';
  console.log(`  round: ${round}, date: ${draw_date}`);

  dumpStructure($);

  // ─── ここから先は HTML 構造を確認後に実装 ───
  // 今回は構造ダンプのみで終了
  return [];
}

async function scrapeNumbersHtml(gameType) {
  const { html } = await fetchHtml(gameType);
  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  const roundMatch = bodyText.match(/第\s*([\d,]+)\s*回/);
  const dateMatch = bodyText.match(/(令和\s*\d+|\d{4})\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/);

  const round = roundMatch ? parseInt(roundMatch[1].replace(/,/g, ''), 10) : null;
  const draw_date = dateMatch ? parseJapaneseDate(dateMatch[0]) : '';
  console.log(`  round: ${round}, date: ${draw_date}`);

  dumpStructure($);

  return [];
}

export async function scrapeLoto(gameType) {
  return scrapeLotoHtml(gameType);
}

export async function scrapeNumbers(gameType) {
  return scrapeNumbersHtml(gameType);
}
