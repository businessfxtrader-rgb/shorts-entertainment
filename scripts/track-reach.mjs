import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// scripts/track-reach.mjs 初回セットアップ時に手動で作成したジョブ。
// YouTube Reporting API(youtubereporting.googleapis.com)は通常のAnalytics APIと違い、
// 一般クリエイター向けにもインプレッション数・クリック率(CTR)を含むバルクレポートを
// 1〜2日遅れでCSV形式で生成する。ジョブ自体はGoogle Cloud Console側でAPIを有効化した後、
// 一度だけ手動でreporting.jobs.create({reportTypeId: "channel_reach_basic_a1"})を実行して
// 作成済み。以降はこのスクリプトが定期的に新しいレポートがないか確認し、あれば取り込む。
const JOB_ID = "a355514e-3f90-446c-8b7a-48f6b97b81bc";

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const reporting = google.youtubereporting({ version: "v1", auth: oauth2Client });

const statePath = path.join(root, "content", "reach-tracking-state.json");
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, "utf-8"))
  : { processedReportIds: [] };
const processed = new Set(state.processedReportIds);

let reportsRes;
try {
  reportsRes = await reporting.jobs.reports.list({ jobId: JOB_ID });
} catch (err) {
  console.error(`レポート一覧の取得に失敗しました: ${err.message}`);
  process.exit(0); // ジョブがまだ存在しない/権限エラー等でも致命的にしない
}

const reports = reportsRes.data.reports ?? [];
const newReports = reports.filter((r) => !processed.has(r.id));

if (newReports.length === 0) {
  console.log("新しいレポートはありません(YouTube側の生成には1〜2日ほどかかります)");
  process.exit(0);
}

console.log(`新しいレポート: ${newReports.length}件`);

const statsPath = path.join(root, "content", "reach-stats.json");
const existingStats = fs.existsSync(statsPath) ? JSON.parse(fs.readFileSync(statsPath, "utf-8")) : {};

for (const report of newReports) {
  console.log(`ダウンロード中: ${report.id} (${report.startTime} 〜 ${report.endTime})`);
  const res = await fetch(report.downloadUrl, {
    headers: { Authorization: `Bearer ${oauth2Client.credentials.access_token}` },
  });
  if (!res.ok) {
    console.error(`ダウンロード失敗 (${report.id}): HTTP ${res.status}`);
    continue;
  }
  const csv = await res.text();
  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    console.log(`空のレポートでした: ${report.id}`);
    processed.add(report.id);
    continue;
  }

  const headers = lines[0].split(",");
  console.log(`列: ${headers.join(", ")}`);

  // video_id列と、impressions/click-through関連の列を探す(YouTube側の正式な列名が
  // 確認できていないため、名前に部分一致するもので柔軟に対応する)
  const videoIdIdx = headers.findIndex((h) => /video_?id/i.test(h));
  const impressionsIdx = headers.findIndex((h) => /impression/i.test(h));
  const ctrIdx = headers.findIndex((h) => /click.?through/i.test(h));

  if (videoIdIdx === -1 || (impressionsIdx === -1 && ctrIdx === -1)) {
    console.log(
      `想定した列が見つかりませんでした。生の内容を content/reach-raw-${report.id}.csv に保存します`
    );
    fs.writeFileSync(path.join(root, "content", `reach-raw-${report.id}.csv`), csv);
  } else {
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      const videoId = cols[videoIdIdx];
      if (!videoId) continue;
      if (!existingStats[videoId]) existingStats[videoId] = {};
      if (impressionsIdx !== -1) {
        existingStats[videoId].impressions =
          (existingStats[videoId].impressions ?? 0) + (Number(cols[impressionsIdx]) || 0);
      }
      if (ctrIdx !== -1) {
        existingStats[videoId].lastCtr = Number(cols[ctrIdx]) || existingStats[videoId].lastCtr;
      }
    }
    fs.writeFileSync(statsPath, JSON.stringify(existingStats, null, 2));
    console.log(`OK: content/reach-stats.json を更新しました`);
  }

  processed.add(report.id);
}

fs.writeFileSync(statePath, JSON.stringify({ processedReportIds: [...processed] }, null, 2));
console.log("完了しました。");
