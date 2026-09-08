import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { extractJson } from "./lib/extract-json.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// youtube-seo-skills(https://github.com/deeployCO/youtube-seo-skills)の
// youtube-seo-competitorスキルの考え方(実在の競合動画からタイトル・フック・
// テーマの「型」を抽出する)を、このチャンネルの週次リサーチに取り込んだもの。
// 元スキルはyt-dlpでの字幕取得・OpenCVでのサムネ解析など重い依存を前提にしているが、
// このプロジェクトは既存のYouTube Data API連携(videos.list等)とWebSearchだけで
// 完結する軽量版として実装している。

function loadEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return {};
  const text = fs.readFileSync(envPath, "utf-8");
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
const env = { ...process.env, ...loadEnv() };
if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error("CLAUDE_CODE_OAUTH_TOKEN が見つかりません");
  process.exit(1);
}

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

const categoriesPath = path.join(root, "scripts", "categories.json");
const categories = JSON.parse(fs.readFileSync(categoriesPath, "utf-8"));
const displayGenres = [...new Set(categories.map((c) => c.displayGenre))];

// 毎回全ジャンルを調べるとAPIクォータ・実行時間を消費しすぎるため、4ジャンルだけ抽選する
function pickRandom(arr, n) {
  const pool = [...arr];
  const picked = [];
  while (picked.length < n && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}
const targetGenres = pickRandom(displayGenres, Math.min(4, displayGenres.length));
console.log(`対象ジャンル: ${targetGenres.join("、")}`);

const publishedAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

// 1) ジャンルごとにYouTube Data APIで直近30日・再生数順の関連ショートを検索し、
//    実在の動画データ(タイトル・概要欄・チャンネル名・再生数)を集める
const collected = [];
for (const genre of targetGenres) {
  try {
    const res = await youtube.search.list({
      part: ["snippet"],
      type: "video",
      videoDuration: "short",
      order: "viewCount",
      q: `${genre} 雑学 ショート`,
      maxResults: 10,
      publishedAfter,
      relevanceLanguage: "ja",
    });
    const items = res.data.items ?? [];
    for (const item of items) {
      collected.push({
        genre,
        videoId: item.id.videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
      });
    }
    console.log(`  ${genre}: ${items.length}件取得`);
  } catch (err) {
    console.log(`  ${genre}: 検索失敗 (${err.message})`);
  }
}

if (collected.length === 0) {
  console.error("競合動画が1件も取得できませんでした。今回は更新をスキップします");
  process.exit(0);
}

// 2) 取得した動画IDのstatistics(再生数)をバッチ取得し、再生数上位を絞り込む
//    (videos.list は50件までの一括取得。auto-retry-seo.mjsと同じ制限)
const idChunks = [];
const allIds = collected.map((c) => c.videoId);
for (let i = 0; i < allIds.length; i += 50) idChunks.push(allIds.slice(i, i + 50));
const statsById = new Map();
for (const chunk of idChunks) {
  const res = await youtube.videos.list({ part: ["statistics"], id: chunk });
  for (const item of res.data.items ?? []) {
    statsById.set(item.id, Number(item.statistics.viewCount ?? 0));
  }
}
for (const c of collected) c.viewCount = statsById.get(c.videoId) ?? 0;

// 各ジャンル上位5件(再生数順)だけをプロンプトに渡す(トークン節約・ノイズ削減)
const topByGenre = new Map();
for (const genre of targetGenres) {
  const top = collected
    .filter((c) => c.genre === genre)
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, 5);
  topByGenre.set(genre, top);
}

const dataBlock = targetGenres
  .map((genre) => {
    const lines = (topByGenre.get(genre) ?? [])
      .map((c) => `  - 「${c.title}」(${c.channelTitle}、${c.viewCount.toLocaleString()}回再生)`)
      .join("\n");
    return `## ${genre}\n${lines || "  (該当なし)"}`;
  })
  .join("\n\n");

const prompt = `あなたはYouTube競合分析の専門家です。以下は、YouTube Data APIで実際に取得した「直近30日で再生数が多いショート動画」の実データです(タイトル・チャンネル名・再生数は捏造ではなく実際の検索結果です)。この実データから、タイトル・フック(冒頭の惹きつけ方)・テーマの「型」を抽出してください。

# 実データ(ジャンル別、再生数上位)
${dataBlock}

# 分析してほしいこと
1. **タイトルの型**: 上記タイトル群から繰り返し現れる構造パターンを3〜5個抽出する(例:「〇〇な理由」型、数字型、二択煽り型など)。パターンごとに、実際のタイトル例を1つ挙げる(捏造せず上記データから引用)。
2. **フックの型**: タイトルと概要から推測できる、冒頭でどう惹きつけているかの傾向を2〜4個抽出する(例:結論を伏せて問いかける、極端な数字を最初に出す、など)。
3. **テーマの型**: ジャンルごとに、今どんな切り口・題材が反応を得ているかを1〜2文でまとめる。

# 重要な制約(著作権配慮)
- タイトルは引用してよいが、動画本編の台本・セリフ・ナレーション文言は絶対に書き写さない(タイトルしか実データとして渡していないので、本編内容は推測で補わないこと)
- 抽出したパターンは「型」として一般化すること。うちのチャンネル(顔出し・声出しなし、雑学・エンタメ系)向けに応用できる形で書く

# 出力JSON形式(このスキーマに厳密に従うこと。説明文やコードフェンスは一切つけず、JSONのみ出力)
{
  "titleFormulas": [
    { "pattern": "型の名前", "description": "なぜ効くかの説明(1文)", "example": "実データから引用した実際のタイトル" }
  ],
  "hookPatterns": [
    { "pattern": "型の名前", "description": "なぜ効くかの説明(1文)" }
  ],
  "themePatterns": [
    { "genre": "ジャンル名", "insight": "今反応が良い切り口・題材の説明(1〜2文)" }
  ]
}`;

function runClaude(promptText) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env,
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

console.log("競合パターンを分析中...");
const raw = await runClaude(prompt);
const result = extractJson(raw);

if (!Array.isArray(result.titleFormulas) || result.titleFormulas.length === 0) {
  console.error("有効なパターンが得られませんでした。今回は更新をスキップします");
  process.exit(0);
}

const output = {
  titleFormulas: result.titleFormulas.slice(0, 5),
  hookPatterns: Array.isArray(result.hookPatterns) ? result.hookPatterns.slice(0, 4) : [],
  themePatterns: Array.isArray(result.themePatterns) ? result.themePatterns.slice(0, 8) : [],
  sourceGenres: targetGenres,
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(
  path.join(root, "content", "competitor-insights.json"),
  JSON.stringify(output, null, 2)
);

console.log(
  `OK: ${output.titleFormulas.length}件のタイトル型・${output.hookPatterns.length}件のフック型・${output.themePatterns.length}件のテーマ傾向を content/competitor-insights.json に保存しました`
);
output.titleFormulas.forEach((t) => console.log(`  - [タイトル型] ${t.pattern}: ${t.example}`));
output.hookPatterns.forEach((h) => console.log(`  - [フック型] ${h.pattern}`));
