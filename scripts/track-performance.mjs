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

const viewCounts = {};
// videos.list accepts up to 50 IDs per call
for (let i = 0; i < videoIds.length; i += 50) {
  const batch = videoIds.slice(i, i + 50);
  const res = await youtube.videos.list({ part: ["statistics"], id: batch });
  for (const item of res.data.items ?? []) {
    viewCounts[item.id] = Number(item.statistics.viewCount ?? 0);
  }
}

// カテゴリ・フォーマットごとに集計
const categoryStats = {};
for (const entry of usedTopics) {
  if (!entry.videoId || !(entry.videoId in viewCounts)) continue;
  const key = entry.category ?? "雑学";
  const views = viewCounts[entry.videoId];
  if (!categoryStats[key]) {
    categoryStats[key] = { totalViews: 0, videoCount: 0, format: entry.format ?? "ranking" };
  }
  categoryStats[key].totalViews += views;
  categoryStats[key].videoCount += 1;
}

for (const key of Object.keys(categoryStats)) {
  const s = categoryStats[key];
  s.avgViews = Math.round(s.totalViews / s.videoCount);
}

fs.writeFileSync(
  path.join(root, "content", "category-stats.json"),
  JSON.stringify(categoryStats, null, 2)
);

console.log("カテゴリ別の平均再生数:");
for (const [name, s] of Object.entries(categoryStats).sort((a, b) => b[1].avgViews - a[1].avgViews)) {
  console.log(`  ${name}: 平均${s.avgViews}回再生 (${s.videoCount}本)`);
}
console.log("OK: content/category-stats.json に保存しました");
