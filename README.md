# minanoloto-data

みんなのロト アプリ用の抽選結果データを保持する public repo。

## 配置

```
loto6.json
loto7.json
numbers3.json
numbers4.json
scripts/
  scrape.mjs                 # メインエントリ
  lib/{fetch,merge}.mjs
  sources/mizuho.mjs         # みずほ銀行 CSV パーサ
.github/workflows/update-data.yml
package.json
```

各 JSON は次の形式:

```json
{
  "total": 2096,
  "data": [
    { "round": 1, "draw_date": "2000-10-05", "numbers": [2, 8, 10, 13, 27, 30], "bonus": 39, "prizes": [...], "carryover": false },
    ...
  ]
}
```

## セットアップ

1. GitHub で `minanoloto-data` という名前の **public** repo を作成
2. このディレクトリの中身をすべて新しい repo にコピー
3. アプリ側 `assets/data/` にある `loto6.json` / `loto7.json` / `numbers3.json` / `numbers4.json` の 4 ファイルもコピー
4. `git init && git add . && git commit -m "Initial" && git push`
5. アプリ側 `.env` に下記を追加:

```
EXPO_PUBLIC_LOTO_DATA_BASE_URL=https://raw.githubusercontent.com/<USER>/minanoloto-data/main
```

## 動作

- GitHub Actions が毎日 23:00 JST (= 14:00 UTC) に `scrape.mjs` を起動
- みずほ銀行 CSV から最新回を取得 → 既存 JSON にマージ (重複は無視)
- 新規行があれば自動コミット & push
- アプリは起動時に `https://raw.githubusercontent.com/.../<game>.json` を fetch
  - 30 分 throttle、`INSERT OR IGNORE` で新規回のみ取り込み

## ローカルでテスト

```bash
npm install
npm run scrape:dry          # 取得テスト (ファイル更新なし)
npm run scrape:loto6        # LOTO 6 のみ反映
npm run scrape               # 全種反映
```

## みずほの URL が変わった場合

`scripts/sources/mizuho.mjs` の `CSV_URLS` を更新。複数 URL を配列に並べると順番に試行する。

## アクセス遮断 (403) の場合

GitHub Actions ランナーが Akamai に弾かれているとログから 403 が見える。
対策候補:

1. プロキシ経由で fetch (ScrapeOps, ScraperAPI 等の無料枠を `HTTPS_PROXY` で挟む)
2. 別の data source へ切替 (Yahoo / Rakuten など、`scripts/sources/` に新規ファイル追加)
3. 自前の日本 VPS で self-hosted runner

## 注意

- `prizes` (賞金情報) は CSV に含まれないため、新規回は `prizes: []` で追加される
  - アプリ側で空配列フォールバックあり
  - 賞金まで必要なら、HTML 解析ステップを追加するか、別ソース併用
