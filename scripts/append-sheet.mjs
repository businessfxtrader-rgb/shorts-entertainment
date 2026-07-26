import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const SPREADSHEET_ID = "1oyuIHE27xiOGppc3QOdP7fA0pNczDI14MTb5wnDQq4c";

const latestScript = JSON.parse(
  fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8")
);
const usedTopics = JSON.parse(
  fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8")
);
const latestEntry = usedTopics[usedTopics.length - 1];

if (!latestEntry || !latestEntry.videoId) {
  console.error("動画URLが見つかりません(used-topics.jsonにvideoIdがありません)");
  process.exit(1);
}

const description = fs.readFileSync(path.join(root, "description.txt"), "utf-8");
const { hashtags } = JSON.parse(
  fs.readFileSync(path.join(root, "content", "current-hashtags.json"), "utf-8")
);

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(root, "service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// タブ名は変更される可能性があるため、毎回スプレッドシートの1番目のタブ名を取得する。
const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const SHEET_NAME = meta.data.sheets[0].properties.title;

// タイトル列(E列)を見て、実際にデータが入っている最後の行を探す。
// A列(管理No.)は事前に大量の連番が入っているため、この検出には使わない。
const titleColumn = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${SHEET_NAME}!E:E`,
});
const titleValues = titleColumn.data.values ?? [];
let lastRow = 1;
for (let i = 0; i < titleValues.length; i++) {
  if (titleValues[i]?.[0]?.trim()) {
    lastRow = i + 1;
  }
}
const targetRow = lastRow + 1;

// YouTubeが実際に返した公開時刻を使う(なければ現在時刻にフォールバック)
const publishedAtSource = latestEntry.publishedAt ? new Date(latestEntry.publishedAt) : new Date();
const jst = new Date(publishedAtSource.getTime() + 9 * 60 * 60 * 1000);
const dateStr = `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${String(
  jst.getUTCHours()
).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`;

const genreLabel = latestScript.format === "simulation" ? "シミュレーション" : "雑学";

const row = [
  "ショート",
  genreLabel,
  dateStr,
  latestScript.title,
  description,
  hashtags,
  `https://youtube.com/shorts/${latestEntry.videoId}`,
  latestScript.seoNotes ?? `タイトル・タグに固有名詞を含め、タグは${(latestScript.tags ?? []).length}個設定`,
];

// B列から書き込み、A列(管理No.)には一切触れない。
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: `${SHEET_NAME}!B${targetRow}:I${targetRow}`,
  valueInputOption: "USER_ENTERED",
  requestBody: { values: [row] },
});

console.log(`OK: ${targetRow}行目にスプレッドシートを追加しました`);
