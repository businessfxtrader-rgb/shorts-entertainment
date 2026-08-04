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
const genreNames = categories.map((c) => c.name).join("、");

const prompt = `あなたはYouTube Shorts市場調査の専門家です。Web検索を使って、直近1〜2週間で日本語圏で伸びているYouTube Shortsに共通する「構造的なパターン」を調査してください。

# 調査対象の絞り込み
うちのチャンネルは顔出し・声出しなしで、雑学・都市伝説・動物・心理学・文化・人体・生態・日本といったジャンル(現在の全ジャンル: ${genreNames})を扱っています。これに近い、ナレーション+シンプルな背景映像だけで成立するジャンルの動画を対象に調査してください。

# 調査すべき観点
- タイトルの型(疑問形/断定形/数字型/伏せ字型/「〜理由」型など)で、今伸びやすいもの
- 冒頭フックの作り方(最初の1〜2秒でどう惹きつけているか)
- 構成の型(ランキング形式/単一トピック深掘り形式、どちらが今伸びやすい傾向にあるか)

# 重要な制約(著作権配慮)
特定の動画のセリフやナレーション内容をそのまま書き写さないこと。あくまで抽象化した「型・パターン」として報告し、exampleは実在の文言そのままではなく一般化した例にすること。

# 出力JSON形式(このスキーマに厳密に従うこと。説明文やコードフェンスは一切つけず、JSONのみ出力)
{
  "patterns": [
    { "pattern": "パターン名(短い名前)", "description": "何がなぜ効果的なのかの説明(1〜2文)", "example": "抽象化した一般的な例(実在動画の引用ではない)" }
  ],
  "summary": "全体的な傾向のまとめ(1〜2文)"
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

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`JSONが見つかりませんでした。出力: ${text}`);
  return JSON.parse(text.slice(start, end + 1));
}

console.log("トレンドパターンを調査中...");
const raw = await runClaude(prompt);
const result = extractJson(raw);

if (!Array.isArray(result.patterns) || result.patterns.length === 0) {
  console.error("有効なパターンが得られませんでした。今回は更新をスキップします");
  process.exit(0);
}

const output = {
  patterns: result.patterns.slice(0, 5),
  summary: result.summary ?? "",
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(
  path.join(root, "content", "trend-insights.json"),
  JSON.stringify(output, null, 2)
);

console.log(`OK: ${output.patterns.length}件のパターンを content/trend-insights.json に保存しました`);
output.patterns.forEach((p) => console.log(`  - ${p.pattern}: ${p.description}`));
