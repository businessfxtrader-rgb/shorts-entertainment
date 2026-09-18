import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// SEO実験ログ(content/seo-experiments.json)を週次でレビューする(2026-09-18追加)。
// 「1回1改善・観察期間を必ず守る・実測でしか判定しない・断定しない」という規律のもと、
// 個々の動画ではなく「パイプラインの変更」を実験対象として扱う(個別動画の公開後リタイトルは
// 実測で効果ゼロと判明済みだが、ジャンルbrief・タイトルの型・背景素材の選び方などパイプライン
// そのものは、WEBページと同様に「変更→観察→判定」のループが機能する対象のため)。
// observing中の実験はobservationTargetを満たすまで絶対に判定しない(見切り発車で結論を出さない)。

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth: oauth2Client });

const experimentsPath = path.join(root, "content", "seo-experiments.json");
const experiments = JSON.parse(fs.readFileSync(experimentsPath, "utf-8"));
const usedTopics = JSON.parse(fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8"));

const now = new Date();

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function fetchAnalytics(videoId, publishedAt) {
  const startDate = publishedAt.slice(0, 10);
  const endDate = now.toISOString().slice(0, 10);
  const res = await ytAnalytics.reports.query({
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics: "views,averageViewPercentage",
    filters: `video==${videoId}`,
  });
  const row = res.data.rows?.[0];
  if (!row) return null;
  const ageDays = Math.max(0.5, (now - new Date(publishedAt)) / 86400000);
  return { views: row[0], avgViewPercentage: row[1], viewsPerDay: row[0] / ageDays };
}

function judge(afterMedianViewsPerDay, afterMedianAPV, baseline) {
  if (afterMedianViewsPerDay == null) return "サンプル不足のため判定不可";
  const viewsRatio = afterMedianViewsPerDay / baseline.medianViewsPerDay;
  const apvDiff = afterMedianAPV - baseline.medianAPV;
  if (viewsRatio >= 1.2 && apvDiff >= -5) {
    return `改善傾向あり(1日あたり再生数が導入前の${viewsRatio.toFixed(2)}倍、維持率差${apvDiff.toFixed(0)}pt)。ただし他の同時期の変更と要因を完全に切り分けられないため、これのみを唯一の原因と断定はしない`;
  }
  if (viewsRatio <= 0.8) {
    return `悪化傾向(1日あたり再生数が導入前の${viewsRatio.toFixed(2)}倍)。ただしサンプル数が少ない場合は誤差の可能性もある`;
  }
  return `明確な差なし(1日あたり再生数比${viewsRatio.toFixed(2)}倍、維持率差${apvDiff.toFixed(0)}pt)`;
}

let changed = false;

for (const exp of experiments) {
  if (exp.status !== "observing") continue;
  console.log(`\n--- ${exp.id} ---`);
  console.log(`仮説: ${exp.hypothesis}`);

  const target = exp.observationTarget;
  let candidates = [];

  if (target.type === "video-count") {
    candidates = usedTopics.filter((t) => {
      if (!t.videoId || !t.publishedAt) return false;
      if (t[target.flag] !== true) return false;
      const ageDays = (now - new Date(t.publishedAt)) / 86400000;
      return ageDays >= target.minAgeDays;
    });
    console.log(`条件: ${target.flag}=trueかつ${target.minAgeDays}日以上経過 → 現在${candidates.length}本(目標${target.minCount}本)`);
    if (candidates.length < target.minCount) {
      console.log("まだ観察対象を満たしていないため、判定を見送ります");
      continue;
    }
  } else if (target.type === "days-elapsed") {
    const daysSinceStart = (now - new Date(exp.startedAt)) / 86400000;
    console.log(`条件: 導入から${target.minDays}日経過 → 現在${daysSinceStart.toFixed(1)}日`);
    if (daysSinceStart < target.minDays) {
      console.log("まだ観察期間を満たしていないため、判定を見送ります");
      continue;
    }
    candidates = usedTopics.filter((t) => {
      if (!t.videoId || !t.publishedAt) return false;
      const publishedAfterStart = new Date(t.publishedAt) >= new Date(exp.startedAt);
      const ageDays = (now - new Date(t.publishedAt)) / 86400000;
      return publishedAfterStart && ageDays >= 3;
    });
    console.log(`導入後・3日以上経過した動画: ${candidates.length}本`);
  } else {
    console.log(`未対応のobservationTarget.type: ${target.type}`);
    continue;
  }

  if (candidates.length === 0) {
    console.log("対象動画が1本もないため、判定を見送ります");
    continue;
  }

  const results = [];
  for (const c of candidates) {
    try {
      const r = await fetchAnalytics(c.videoId, c.publishedAt);
      if (r) results.push(r);
    } catch (err) {
      console.log(`  Analytics取得失敗: ${c.videoId} (${err.message})`);
    }
  }

  const afterMedianViewsPerDay = median(results.map((r) => r.viewsPerDay));
  const afterMedianAPV = median(results.map((r) => r.avgViewPercentage));
  console.log(`実測: ${results.length}本、1日あたり再生数中央値=${afterMedianViewsPerDay?.toFixed(2)}、維持率中央値=${afterMedianAPV?.toFixed(0)}%`);

  const verdict = judge(afterMedianViewsPerDay, afterMedianAPV, exp.baseline);
  console.log(`判定: ${verdict}`);

  exp.status = "judged";
  exp.result = {
    sampleSize: results.length,
    afterMedianViewsPerDay,
    afterMedianAPV,
    verdict,
  };
  exp.judgedAt = now.toISOString();
  changed = true;
}

if (changed) {
  fs.writeFileSync(experimentsPath, JSON.stringify(experiments, null, 2));
  console.log("\nOK: content/seo-experiments.json を更新しました");
} else {
  console.log("\n判定可能な実験はありませんでした(観察継続中)");
}
