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
const videoInfo = {};
// videos.list accepts up to 50 IDs per call
for (let i = 0; i < videoIds.length; i += 50) {
  const batch = videoIds.slice(i, i + 50);
  const res = await youtube.videos.list({ part: ["statistics", "status", "contentDetails"], id: batch });
  for (const item of res.data.items ?? []) {
    viewCounts[item.id] = Number(item.statistics.viewCount ?? 0);
    videoInfo[item.id] = {
      likes: Number(item.statistics.likeCount ?? 0),
      comments: Number(item.statistics.commentCount ?? 0),
      privacyStatus: item.status.privacyStatus,
      duration: item.contentDetails.duration,
    };
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
    metrics: "views,averageViewDuration,averageViewPercentage,engagedViews,shares,subscribersGained",
    dimensions: "video",
    filters: `video==${videoIds.join(",")}`,
    maxResults: 200,
  });
  for (const row of res.data.rows ?? []) {
    const [videoId, analyticsViews, avgViewDuration, avgViewPercentage, engagedViews, shares, subscribersGained] = row;
    retentionByVideo[videoId] = {
      averageViewDuration: avgViewDuration,
      averageViewPercentage: avgViewPercentage,
      analyticsViews,
      engagedViews,
      shares,
      subscribersGained,
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

// ---- 動画ごとの成績と、1万回再生の目標の達成状況(2026-09-28追加) ----
// PDCA(scripts/pdca-review.mjs)の判定材料。GitHub上に保存されるので、APIの認証なしで後から読める。
// engagedRate = エンゲージビュー÷再生回数。ショートの再生回数は冒頭で即スワイプされた分も数えるが、
// エンゲージビューは一定時間以上見られた分だけなので、「冒頭で指が止まったか」の目安になる
const videoStats = usedTopics
  .filter((t) => t.videoId && t.videoId in viewCounts)
  .map((t) => {
    const r = retentionByVideo[t.videoId] ?? {};
    const info = videoInfo[t.videoId] ?? {};
    const views = viewCounts[t.videoId];
    const engaged = r.engagedViews ?? null;
    return {
      videoId: t.videoId,
      title: t.title,
      publishedAt: t.publishedAt ?? null,
      category: t.category ?? null,
      format: t.format ?? null,
      voice: t.voice ?? null,
      pdcaVersion: t.pdcaVersion ?? 0,
      realPhotoInHook: t.realPhotoInHook ?? null,
      visualTheme: t.visualTheme ?? null,
      privacyStatus: info.privacyStatus ?? null,
      duration: info.duration ?? null,
      views,
      engagedViews: engaged,
      engagedRate: engaged != null && r.analyticsViews > 0 ? Math.round((engaged / r.analyticsViews) * 1000) / 1000 : null,
      averageViewPercentage: r.averageViewPercentage ?? null,
      averageViewDuration: r.averageViewDuration ?? null,
      likes: info.likes ?? null,
      comments: info.comments ?? null,
      shares: r.shares ?? null,
      subscribersGained: r.subscribersGained ?? null,
    };
  });
fs.writeFileSync(
  path.join(root, "content", "video-stats.json"),
  JSON.stringify({ updatedAt: new Date().toISOString(), videos: videoStats }, null, 2)
);

const GOAL_VIEWS = 10000;
const since = Date.now() - 30 * 24 * 3600 * 1000;
const recent = videoStats.filter(
  (v) => v.privacyStatus === "public" && v.publishedAt && new Date(v.publishedAt).getTime() >= since
);
const best = recent.sort((a, b) => b.views - a.views)[0] ?? null;
const goalPath = path.join(root, "content", "goal-status.json");
const prevGoal = fs.existsSync(goalPath) ? JSON.parse(fs.readFileSync(goalPath, "utf-8")) : {};
const achievedNow = Boolean(best && best.views >= GOAL_VIEWS);
const goal = {
  goal: `直近30日以内に投稿した動画で${GOAL_VIEWS.toLocaleString()}回再生`,
  achieved: achievedNow || Boolean(prevGoal.achieved),
  achievedAt: prevGoal.achievedAt ?? (achievedNow ? new Date().toISOString() : null),
  achievedBy: prevGoal.achievedBy ?? (achievedNow ? { videoId: best.videoId, title: best.title, views: best.views } : null),
  recentBest: best ? { videoId: best.videoId, title: best.title, views: best.views, publishedAt: best.publishedAt } : null,
  recentVideoCount: recent.length,
  checkedAt: new Date().toISOString(),
};
fs.writeFileSync(goalPath, JSON.stringify(goal, null, 2));
console.log(
  `目標(${goal.goal}): ${goal.achieved ? "達成" : "未達成"} / 直近30日の最高 ${best ? `${best.views}回「${best.title}」` : "なし"}`
);
