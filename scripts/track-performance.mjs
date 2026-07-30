import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const usedTopics = JSON.parse(
  fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8")
);
const videoIds = usedTopics.filter((t) => t.videoId).map((t) => t.videoId);

if (videoIds.length === 0) {
  console.log("追跡対象の動画がありません");
  process.exit(0);
}

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });
const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth: oauth2Client });

const viewCounts = {};
// videos.list accepts up to 50 IDs per call
for (let i = 0; i < videoIds.length; i += 50) {
  const batch = videoIds.slice(i, i + 50);
  const res = await youtube.videos.list({ part: ["statistics"], id: batch });
  for (const item of res.data.items ?? []) {
    viewCounts[item.id] = Number(item.statistics.viewCount ?? 0);
  }
}

// 視聴維持率(averageViewPercentage)を取得する。
// 注意: YouTube Analytics APIは「dimensions=video」単体だと"not supported"エラーになるため、
// 必ず「filters=video==id1,id2,...」と組み合わせて呼び出す必要がある(実際に検証済み)。
// また、impressions/クリック率はこのAPIでは一般クリエイター向けに提供されていない
// (YouTube Studio画面上でのみ確認可能)ため、代わりに視聴維持率を主指標として使う。
const retentionByVideo = {};
try {
  const res = await ytAnalytics.reports.query({
    ids: "channel==MINE",
    startDate: "2020-01-01",
    endDate: new Date().toISOString().slice(0, 10),
    metrics: "views,averageViewDuration,averageViewPercentage",
    dimensions: "video",
    filters: `video==${videoIds.join(",")}`,
    maxResults: 200,
  });
  for (const row of res.data.rows ?? []) {
    const [videoId, , avgViewDuration, avgViewPercentage] = row;
    retentionByVideo[videoId] = {
      averageViewDuration: avgViewDuration,
      averageViewPercentage: avgViewPercentage,
    };
  }
} catch (err) {
  console.error(`警告: 視聴維持率の取得に失敗しました(再生数の集計は継続します): ${err.message}`);
}

// カテゴリ・フォーマットごとに集計(再生数 + 視聴維持率)
const categoryStats = {};
for (const entry of usedTopics) {
  if (!entry.videoId || !(entry.videoId in viewCounts)) continue;
  const key = entry.category ?? "雑学";
  const views = viewCounts[entry.videoId];
  const retention = retentionByVideo[entry.videoId];
  if (!categoryStats[key]) {
    categoryStats[key] = {
      totalViews: 0,
      videoCount: 0,
      format: entry.format ?? "ranking",
      retentionSum: 0,
      retentionCount: 0,
    };
  }
  const s = categoryStats[key];
  s.totalViews += views;
  s.videoCount += 1;
  if (retention?.averageViewPercentage != null) {
    s.retentionSum += retention.averageViewPercentage;
    s.retentionCount += 1;
  }
}

for (const key of Object.keys(categoryStats)) {
  const s = categoryStats[key];
  s.avgViews = Math.round(s.totalViews / s.videoCount);
  s.avgRetentionPercentage =
    s.retentionCount > 0 ? Math.round((s.retentionSum / s.retentionCount) * 10) / 10 : null;
  delete s.retentionSum;
  delete s.retentionCount;
}

fs.writeFileSync(
  path.join(root, "content", "category-stats.json"),
  JSON.stringify(categoryStats, null, 2)
);

// 台本生成プロンプトが直接参照する、チャンネル全体の直近視聴維持率(全動画の単純平均)
const retentionValues = Object.values(retentionByVideo)
  .map((r) => r.averageViewPercentage)
  .filter((v) => v != null);
const overallRetention =
  retentionValues.length > 0
    ? Math.round((retentionValues.reduce((a, b) => a + b, 0) / retentionValues.length) * 10) / 10
    : null;
fs.writeFileSync(
  path.join(root, "content", "retention-summary.json"),
  JSON.stringify({ overallRetentionPercentage: overallRetention, updatedAt: new Date().toISOString() }, null, 2)
);

console.log("カテゴリ別の平均再生数・視聴維持率:");
for (const [name, s] of Object.entries(categoryStats).sort((a, b) => b[1].avgViews - a[1].avgViews)) {
  console.log(
    `  ${name}: 平均${s.avgViews}回再生 (${s.videoCount}本) / 視聴維持率${s.avgRetentionPercentage ?? "データなし"}%`
  );
}
console.log(`チャンネル全体の平均視聴維持率: ${overallRetention ?? "データなし"}%`);
console.log("OK: content/category-stats.json, content/retention-summary.json に保存しました");
