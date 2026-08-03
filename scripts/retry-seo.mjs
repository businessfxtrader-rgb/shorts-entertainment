import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const SPREADSHEET_ID = "1oyuIHE27xiOGppc3QOdP7fA0pNczDI14MTb5wnDQq4c";
const CORE_TAGS = ["雑学", "豆知識", "shorts"];
const GENERIC_WORDS = new Set([...CORE_TAGS, "ランキング", "雑学クイズ", "面白い雑学"]);

// 対象: 投稿から4日以上経過しても伸び悩んでいる動画
const TARGET_VIDEO_IDS = [
  "b70d_pdbnuU",
  "VlAKHT0CNrU",
  "KcvGYX-4lYU",
  "0-WR1m5X9pE",
  "rjDsWvYWmJ8",
  "93dLaMBmMZQ",
  "hK_tkfkC9qw",
  "IxGsYkSbL9A",
  "M4v-ZmNo8Ks",
  "2g0g4RH53ho",
  "2-1RaVHLN8E",
];

function loadEnv() {
  const text = fs.readFileSync(path.join(root, ".env"), "utf-8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}
const env = loadEnv();

function runClaude(promptText) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude -p が失敗しました (code ${code}): ${stderr}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.write(promptText);
    child.stdin.end();
  });
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`JSONが見つかりませんでした: ${text}`);
  return JSON.parse(text.slice(start, end + 1));
}

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

const sheetsAuth = new google.auth.GoogleAuth({
  keyFile: path.join(root, "service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: sheetsAuth });

const usedTopicsPath = path.join(root, "content", "used-topics.json");
const usedTopics = JSON.parse(fs.readFileSync(usedTopicsPath, "utf-8"));

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const SHEET_NAME = meta.data.sheets[0].properties.title;
const urlColumn = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${SHEET_NAME}!I:I`,
});
const urlValues = urlColumn.data.values ?? [];

for (const videoId of TARGET_VIDEO_IDS) {
  console.log(`\n===== ${videoId} =====`);
  const entry = usedTopics.find((t) => t.videoId === videoId);
  if (!entry) {
    console.error("used-topics.jsonに見つかりません:", videoId);
    continue;
  }

  const videoRes = await youtube.videos.list({ part: ["snippet"], id: [videoId] });
  const video = videoRes.data.items[0];
  if (!video) {
    console.error("YouTube上に見つかりません:", videoId);
    continue;
  }
  const oldSnippet = video.snippet;

  const prompt = `あなたはYouTubeショート動画のSEO改善担当です。以下の動画は投稿から日数が経っているのに再生数が伸び悩んでいます。内容(トピック)は変えず、タイトル・タグ・概要欄冒頭だけをより検索・クリックされやすい形に改善してください。JSON形式だけで出力してください。説明文やコードフェンスは一切つけないでください。

# 動画の内容(変更しないこと)
ジャンル: ${entry.category}
トピック: ${(entry.topics ?? []).join(" / ")}

# 現在のタイトル(参考、これより改善すること)
${oldSnippet.title}

# SEO改善ルール(重要)
- titleには、検索されやすい具体的なキーワード(固有名詞・数字)を、できるだけ前方(最初の10〜15字以内)に配置すること。「〜ベスト3」のような定番の検索意図に合う言い回しにする。30字以内
- 感嘆符・疑問符は必ず全角(！／？)を使うこと。半角(!／?)は使わない。二重引用符(")は使わない
- tagsは、最も重要・具体的なキーワードを先頭から順に8個程度。検索ボリュームが見込める一般語(雑学,豆知識等)と、固有名詞・専門用語を両方含める
- descriptionHookは、検索結果・スマホ画面で最初に表示される1文。内容とキーワードが一目で伝わるようにする(曖昧な要約にしない)
- seoNotesには、今回どうSEO改善したかを日本語1〜2文で具体的に説明すること

# 出力JSON形式
{
  "title": "改善後のタイトル",
  "tags": ["タグ1", "タグ2", "..."],
  "descriptionHook": "改善後の概要欄冒頭1文",
  "seoNotes": "SEO改善の説明"
}`;

  const raw = await runClaude(prompt);
  const result = extractJson(raw);

  // 概要欄の固定部分(BGMクレジット・X誘導)は既存のものをそのまま維持し、
  // 冒頭のhookと末尾のハッシュタグ行だけ差し替える
  const blocks = oldSnippet.description.split("\n\n");
  const extraTags = (result.tags ?? []).filter((t) => !GENERIC_WORDS.has(t)).slice(0, 2);
  const hashtags = [...CORE_TAGS, ...extraTags].map((t) => `#${t}`).join(" ");
  blocks[0] = result.descriptionHook;
  blocks[blocks.length - 1] = hashtags;
  const newDescription = blocks.join("\n\n");

  const newSnippet = {
    ...oldSnippet,
    title: result.title,
    description: newDescription,
    tags: result.tags,
  };

  await youtube.videos.update({ part: ["snippet"], requestBody: { id: videoId, snippet: newSnippet } });
  console.log(`YouTube更新: ${oldSnippet.title} -> ${result.title}`);

  const rowIndex = urlValues.findIndex((row) => row[0]?.includes(videoId));
  if (rowIndex !== -1) {
    const row = rowIndex + 1;
    // I列(動画URL)には触れない。F〜H列とJ列を別々に更新する
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!F${row}:H${row}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[result.title, newDescription, hashtags]] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!J${row}:J${row}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[result.seoNotes]] },
    });
    console.log(`シート更新: row ${row}`);
  } else {
    console.error("シート上の行が見つかりませんでした:", videoId);
  }

  entry.title = result.title;
  fs.writeFileSync(usedTopicsPath, JSON.stringify(usedTopics, null, 2));
}

console.log("\n完了しました。");
