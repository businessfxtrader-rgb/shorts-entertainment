import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

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

const categoriesPath = path.join(root, "scripts", "categories.json");
const categories = JSON.parse(fs.readFileSync(categoriesPath, "utf-8"));
const existingNames = categories.map((c) => c.name).join("、");

const prompt = `あなたはYouTubeショートの企画リサーチャーです。今、短尺動画(YouTube Shorts)で伸びやすい「エンタメ・雑学系」のジャンル・切り口を調査し、新しいジャンル候補を最大2個、JSON配列だけで出力してください。説明文やコードフェンス(\`\`\`)は一切つけず、JSONのみを出力してください。Web検索が使えるなら、実際に最近伸びている短尺動画の傾向を調べた上で提案してください。

# 既存のジャンル(これらとは違う新しいものを提案すること)
${existingNames}

# 新ジャンル候補の絶対条件
- 著作権のあるキャラクター・作品(アニメ・漫画・映画・ゲーム等)への言及や、それらに基づくランキングは絶対に禁止
- 実在の人物(有名人・YouTuber等)を扱う内容は絶対に禁止(なりすまし・肖像権のリスクがあるため)
- 投資・金融商品の売買助言、個別の医療・法律相談に該当する内容は絶対に禁止
- 誰でも当てはまる一般的な知識・雑学・科学的な事実に基づく内容に限る
- ナレーション(音声)とシンプルな背景動画だけで成立する内容にすること(実写の人物出演やアニメーション制作が必須なものは不可)

# 出力JSON形式(このスキーマに厳密に従うこと。既存ジャンルと同じ形)
[
  {
    "name": "ジャンル名(短く)",
    "brief": "台本作家への指示となる説明文。何を扱うか、何を避けるべきかを具体的に",
    "format": "ranking か simulation のどちらか(ranking=ベスト3形式、simulation=もしも〜だったら形式)"
  }
]`;

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

function extractJson(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error(`JSON配列が見つかりませんでした。出力: ${text}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

console.log("新ジャンルをリサーチ中...");
const raw = await runClaude(prompt);
const candidates = extractJson(raw);

let added = 0;
for (const c of candidates) {
  if (!c.name || !c.brief || !["ranking", "simulation"].includes(c.format)) {
    console.log(`スキップ(形式が不正): ${JSON.stringify(c)}`);
    continue;
  }
  if (categories.some((existing) => existing.name === c.name)) {
    console.log(`スキップ(既存と重複): ${c.name}`);
    continue;
  }
  categories.push({ name: c.name, brief: c.brief, format: c.format });
  added++;
  console.log(`追加: ${c.name} (${c.format})`);
}

if (added > 0) {
  fs.writeFileSync(categoriesPath, JSON.stringify(categories, null, 2));
  console.log(`OK: ${added}件の新ジャンルを categories.json に追加しました`);
} else {
  console.log("新しく追加されたジャンルはありませんでした");
}
