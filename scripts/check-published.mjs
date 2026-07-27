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

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

const res = await youtube.videos.list({
  part: ["status"],
  id: overdue.map((t) => t.videoId),
});
const statusById = new Map(res.data.items.map((v) => [v.id, v.status.privacyStatus]));

// YouTube API上に存在しない(削除された等)動画も「まだ公開されていない」扱いにする
const stillNotPublic = overdue.filter((t) => statusById.get(t.videoId) !== "public");

if (stillNotPublic.length === 0) {
  console.log("OK: 公開予定時刻を過ぎた動画はすべて正常に公開されています");
  process.exit(0);
}

console.error(`警告: 予定時刻を過ぎても公開されていない動画が${stillNotPublic.length}件あります`);

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(root, "service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const SHEET_NAME = meta.data.sheets[0].properties.title;

const urlColumn = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${SHEET_NAME}!I:I`,
});
const urlValues = urlColumn.data.values ?? [];

for (const t of stillNotPublic) {
  const rowIndex = urlValues.findIndex((row) => row[0]?.includes(t.videoId));
  if (rowIndex === -1) {
    console.error(`該当行が見つかりませんでした(videoId: ${t.videoId})`);
    continue;
  }
  const row = rowIndex + 1; // 1-indexed行番号
  const actualStatus = statusById.get(t.videoId) ?? "取得不可(削除された可能性)";
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
          `予約公開の予定時刻(${t.publishedAt})を${GRACE_MINUTES}分以上過ぎましたが、YouTube側で公開されていません(現在の状態: ${actualStatus})。YouTube Studioで内容を確認してください。videoId: ${t.videoId}`,
        ],
      ],
    },
  });
  console.log(`OK: ${row}行目を「エラー」に更新しました (videoId: ${t.videoId})`);
}
