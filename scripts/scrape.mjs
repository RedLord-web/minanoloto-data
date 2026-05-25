import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeLoto, scrapeNumbers } from './sources/mizuho.mjs';
import { mergeRounds } from './lib/merge.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = !!process.env.DRY_RUN;

const GAMES = {
  loto6:    { kind: 'loto',    scrape: () => scrapeLoto('loto6') },
  loto7:    { kind: 'loto',    scrape: () => scrapeLoto('loto7') },
  numbers3: { kind: 'numbers', scrape: () => scrapeNumbers('numbers3') },
  numbers4: { kind: 'numbers', scrape: () => scrapeNumbers('numbers4') },
};

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { total: 0, data: [] };
    throw e;
  }
}

async function processGame(gameType) {
  const cfg = GAMES[gameType];
  if (!cfg) throw new Error(`Unknown game: ${gameType}`);

  console.log(`\n=== [${gameType}] ===`);
  const incoming = await cfg.scrape();

  const filePath = path.join(ROOT, `${gameType}.json`);
  const existing = await readJson(filePath);
  console.log(`  existing: ${existing.data.length} rounds`);

  const added = mergeRounds(existing.data, incoming);
  console.log(`  new rounds: ${added}`);

  if (added > 0) {
    existing.total = existing.data.length;
    if (DRY) {
      console.log(`  [DRY_RUN] would write ${filePath}`);
      const tail = existing.data.slice(-3);
      console.log('  last 3:', JSON.stringify(tail, null, 2));
    } else {
      await fs.writeFile(filePath, JSON.stringify(existing, null, 2) + '\n');
      console.log(`  ✓ wrote ${filePath}`);
    }
  }

  return added;
}

async function main() {
  const target = process.argv[2];
  const games = target ? [target] : Object.keys(GAMES);

  let totalAdded = 0;
  for (const g of games) {
    try {
      totalAdded += await processGame(g);
    } catch (e) {
      console.error(`[${g}] FAILED: ${e.message}`);
    }
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Total new rounds: ${totalAdded}`);

  // CI 上で「変更あり/なし」を判定できるよう環境出力
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `added=${totalAdded}\n`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
