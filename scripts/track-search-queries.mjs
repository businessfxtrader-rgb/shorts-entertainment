import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// YouTube Analytics APIのinsightTrafficSourceDetail(YT_SEARCH絞り込み)で、
// 実際にこのチャンネルへの流入を生んだ検索語を取得する(2026-09-18追加)。
// WEBサイトSEOのGoogle Search Consoleに近い、実測ベースのキーワードデータ。
// これまでのresearch-trends.mjs等は「今伸びていそうなキーワードの傾向」をWeb検索で
// 推測していたが、こちらは「実際にこのチャンネルへの検索流入を生んだ言葉」そのものなので、
// より確度が高い一次データとして扱える。

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth: oauth2Client });

const endDate = new Date().toISOString().slice(0, 10);
const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const res = await ytAnalytics.reports.query({
  ids: "channel==MINE",
  startDate,
  endDate,
  metrics: "views",
  dimensions: "insightTrafficSourceDetail",
  filters: "insightTrafficSourceType==YT_SEARCH",
  sort: "-views",
  maxResults: 25, // 50を指定すると"FIELD_UNKNOWN_VALUE"で500エラーになることを確認済み(APIの制約)
});

const queries = (res.data.rows ?? []).map(([query, views]) => ({ query, views }));

const output = {
  periodStart: startDate,
  periodEnd: endDate,
  queries,
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(root, "content", "search-queries.json"), JSON.stringify(output, null, 2));
console.log(`OK: 直近30日の実検索流入語${queries.length}件を content/search-queries.json に保存しました`);
queries.slice(0, 10).forEach((q) => console.log(`  ${q.views}回 <- "${q.query}"`));
