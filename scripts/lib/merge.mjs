// 既存配列に新規 round のみ追加 (round 重複は無視)
// 戻り値: 新規に追加した件数
export function mergeRounds(existing, incoming) {
  const existingRounds = new Set(existing.map((r) => r.round));
  let added = 0;
  for (const r of incoming) {
    if (!Number.isFinite(r.round)) continue;
    if (existingRounds.has(r.round)) continue;
    existing.push(r);
    existingRounds.add(r.round);
    added++;
  }
  if (added > 0) {
    existing.sort((a, b) => a.round - b.round);
  }
  return added;
}
