import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

// 管理シートの自動お片付け(2026-10-13追加、watchdog.ymlの最後に実行)。
// 監視が記録した「エラー」行のうち、原因がすでに解消しているものを削除し、日付順に並べ直す。
// 人が見に行かなくても、シートに残るエラー行は「今まさに対応が必要なもの」だけになるようにするため。
// (ユーザーのルール: シートを編集したら、エラー行の整理→投稿日時の昇順に並べ替え→No.列の確認)
//
// 削除するのは、次の「解消が機械的に確認できる」エラー行だけ。それ以外のエラー行は残す:
//   - (トークン失効警告)    … この実行のトークン確認が成功している(環境変数 TOKEN_OK=1)
//   - (バッファ残量警告)    … いまの予約済み本数が警告ライン以上ある
//   - 予約枠(…)の動画作成に失敗 … その枠に動画が入った、または枠の時刻を過ぎていてバッファが回復している
// No.列は =ROW()-1 の式なので、行の削除・並べ替えで自動的に正しい番号になる(確認のみ行う)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const SPREADSHEET_ID = "1oyuIHE27xiOGppc3QOdP7fA0pNczDI14MTb5wnDQq4c";
// タブの順番ではなく名前で指定する(他チャンネルのタブと同じスプレッドシートのため)
const SHEET_NAME = "ほっと一息チャンネル";
const STOCK_SLOTS = 6; // pipeline.mjsと同じ(3日分×1日2本)
const WARN_THRESHOLD = Math.ceil(STOCK_SLOTS / 2);

const usedTopics = JSON.parse(fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8"));
const now = Date.now();
const queued = usedTopics.filter((t) => t.publishedAt && new Date(t.publishedAt).getTime() > now).length;
const bufferOk = queued >= WARN_THRESHOLD;
const tokenOk = process.env.TOKEN_OK === "1";
const filledSlots = new Set(usedTopics.map((t) => t.publishedAt).filter(Boolean));

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(root, "service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: "sheets(properties(sheetId,title))" });
const sheetId = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME)?.properties.sheetId;
if (sheetId == null) {
  console.error(`タブ「${SHEET_NAME}」が見つかりません`);
  process.exit(1);
}

const read = async () =>
  (
    await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:K`,
      valueRenderOption: "UNFORMATTED_VALUE",
    })
  ).data.values ?? [];

let rows = await read();

const resolvedReason = (r) => {
  if (r[2] !== "エラー") return null;
  const title = String(r[5] ?? "");
  const note = String(r[10] ?? "");
  if (title === "(トークン失効警告)") return tokenOk ? "トークン確認が成功" : null;
  if (title === "(バッファ残量警告)") return bufferOk ? `予約済み${queued}本で回復` : null;
  const slot = note.match(/予約枠\(([^)]+)\)の動画作成に失敗/)?.[1];
  if (slot) {
    if (filledSlots.has(slot)) return "その枠に動画が入った";
    if (new Date(slot).getTime() < now && bufferOk) return "枠の時刻を過ぎ、バッファは回復済み";
  }
  return null;
};

const toDelete = [];
rows.forEach((r, i) => {
  if (i === 0) return; // 見出し
  const reason = resolvedReason(r);
  if (reason) toDelete.push({ index: i, reason, title: r[5], note: String(r[10] ?? "").slice(0, 40) });
});

if (toDelete.length > 0) {
  // 下の行から消す(上から消すと後ろの行番号がずれるため)
  const requests = [...toDelete]
    .sort((a, b) => b.index - a.index)
    .map((d) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: d.index, endIndex: d.index + 1 } } }));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
  for (const d of toDelete) console.log(`削除: ${d.index + 1}行目 ${d.title}(${d.reason}) ${d.note}`);
  rows = await read();
} else {
  console.log("解消済みのエラー行はありません");
}

// 投稿日時(E列)の昇順に並べ替える(エラー行は発生時刻で末尾に追加されるため順番が崩れる)
const lastFilled = rows.reduce((last, r, i) => (String(r[5] ?? "").trim() ? i + 1 : last), 1);
const dates = rows.slice(1, lastFilled).map((r) => r[4]);
const outOfOrder = dates.some((d, i) => i > 0 && typeof d === "number" && typeof dates[i - 1] === "number" && d < dates[i - 1]);
if (outOfOrder) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          sortRange: {
            range: { sheetId, startRowIndex: 1, endRowIndex: lastFilled },
            sortSpecs: [{ dimensionIndex: 4, sortOrder: "ASCENDING" }],
          },
        },
      ],
    },
  });
  console.log(`並べ替え: 2〜${lastFilled}行目を投稿日時の昇順に並べ替えました`);
}

// No.列(=ROW()-1)の確認
const no = (
  await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!A2:A${lastFilled}`, valueRenderOption: "FORMULA" })
).data.values ?? [];
const broken = no.map((r, i) => [i + 2, r[0]]).filter(([, v]) => v !== "=ROW()-1");
console.log(broken.length === 0 ? `No.列: 2〜${lastFilled}行目すべて =ROW()-1 です` : `注意: No.列が式でない行: ${broken.map(([n]) => n).join(", ")}`);
