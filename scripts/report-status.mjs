import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// 使い方: node report-status.mjs <ステータス:エラー|保留> <詳細メッセージ>
const status = process.argv[2] === "保留" ? "保留" : "エラー";
const message = process.argv[3] || "詳細不明";

const SPREADSHEET_ID = "1oyuIHE27xiOGppc3QOdP7fA0pNczDI14MTb5wnDQq4c";

// 失敗した段階までに latest-script.json が作られていれば、分かる範囲の情報を使う
let title = "(生成失敗)";
let genreLabel = "-";
try {
  const latestScript = JSON.parse(
    fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8")
  );
  title = latestScript.title ?? title;
  genreLabel = latestScript.format === "simulation" ? "シミュレーション" : "雑学";
} catch {
  // 台本生成前に失敗した場合は情報なしのまま
}

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(root, "service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const SHEET_NAME = meta.data.sheets[0].properties.title;

const titleColumn = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${SHEET_NAME}!F:F`,
});
const titleValues = titleColumn.data.values ?? [];
let lastRow = 1;
for (let i = 0; i < titleValues.length; i++) {
  if (titleValues[i]?.[0]?.trim()) {
    lastRow = i + 1;
  }
}
const targetRow = lastRow + 1;

const now = new Date();
const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const dateStr = `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${String(
  jst.getUTCHours()
).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`;

const row = [
  "ショート",
  status,
  genreLabel,
  dateStr,
  title,
  "", // 概要欄
  "", // 検索キーワード
  "", // 動画URL
  "", // SEO対策
  message.slice(0, 500),
];

await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: `${SHEET_NAME}!B${targetRow}:K${targetRow}`,
  valueInputOption: "USER_ENTERED",
  requestBody: { values: [row] },
});

console.log(`OK: ${targetRow}行目に「${status}」を記録しました`);
