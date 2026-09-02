import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const SPREADSHEET_ID = "1oyuIHE27xiOGppc3QOdP7fA0pNczDI14MTb5wnDQq4c";
const GRACE_MINUTES = 30; // YouTube側の処理猶予(予定時刻ちょうどでは間に合わないことがあるため)

const usedTopics = JSON.parse(
  fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8")
);
const now = new Date();

// 予約公開の予定時刻(publishedAt)を、猶予時間を含めても過ぎている動画
const overdue = usedTopics.filter((t) => {
  if (!t.publishedAt || !t.videoId) return false;
  const scheduled = new Date(t.publishedAt);
  return now.getTime() > scheduled.getTime() + GRACE_MINUTES * 60 * 1000;
});

if (overdue.length === 0) {
  console.log("OK: 公開予定時刻を過ぎた動画はありません");
  process.exit(0);
}

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(root, "service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// 「1番目のタブ」で判定すると、他のタブが追加されて順番が変わった際に誤ったタブへ
// 書き込んでしまうため、タブ名を直接指定する。
const SHEET_NAME = "ほっと一息チャンネル";

const [statusColumn, urlColumn] = await Promise.all([
  sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!C:C` }),
  sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!I:I` }),
]);
const statusValues = statusColumn.data.values ?? [];
const urlValues = urlColumn.data.values ?? [];

function findRow(videoId) {
  const rowIndex = urlValues.findIndex((row) => row[0]?.includes(videoId));
  return rowIndex === -1 ? null : rowIndex + 1; // 1-indexed行番号
}

// まだシート上で「予約済み」のままの行だけを対象にする(既に「投稿完了」「エラー」に
// 確定済みの行を毎回チェックし直すのは無駄なAPI消費になるため)
const candidates = overdue.filter((t) => {
  const row = findRow(t.videoId);
  if (!row) return false;
  return statusValues[row - 1]?.[0] === "予約済み";
});

if (candidates.length === 0) {
  console.log("OK: 確認が必要な動画(予約済みのまま止まっているもの)はありません");
  process.exit(0);
}

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

// videos.listは1回あたり最大50件まで(auto-retry-seo.mjsで同じ制限に実際に引っかかったため、
// ここも念のため分割しておく。Watchdogが長期間止まると「予約済み」の滞留が50件を超えうる)
const statusById = new Map();
const candidateIds = candidates.map((t) => t.videoId);
for (let i = 0; i < candidateIds.length; i += 50) {
  const chunk = candidateIds.slice(i, i + 50);
  const res = await youtube.videos.list({ part: ["status"], id: chunk });
  res.data.items.forEach((v) => statusById.set(v.id, v.status.privacyStatus));
}

let publishedCount = 0;
let errorCount = 0;

for (const t of candidates) {
  const row = findRow(t.videoId);
  const actualStatus = statusById.get(t.videoId);

  if (actualStatus === "public") {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!C${row}:C${row}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["投稿完了"]] },
    });
    console.log(`OK: ${row}行目を「投稿完了」に更新しました (videoId: ${t.videoId})`);
    publishedCount++;
    continue;
  }

  // まだpublicになっていない(YouTube API上に存在しない=削除された可能性も含む)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!C${row}:C${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["エラー"]] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!K${row}:K${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          `予約公開の予定時刻(${t.publishedAt})を${GRACE_MINUTES}分以上過ぎましたが、YouTube側で公開されていません(現在の状態: ${actualStatus ?? "取得不可(削除された可能性)"})。YouTube Studioで内容を確認してください。videoId: ${t.videoId}`,
        ],
      ],
    },
  });
  console.log(`警告: ${row}行目を「エラー」に更新しました (videoId: ${t.videoId})`);
  errorCount++;
}

console.log(`完了: 投稿完了${publishedCount}件、エラー${errorCount}件`);
if (errorCount > 0) process.exit(1);
