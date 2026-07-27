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

# 新ジャンル候補の絶対条件(fictionがtrueでも変わらず適用される)
- 著作権のあるキャラクター・作品(アニメ・漫画・映画・ゲーム等)への言及や、それらに基づくランキングは絶対に禁止
- 実在の人物(有名人・YouTuber等)の実名・私生活を扱う内容は絶対に禁止(なりすまし・肖像権のリスクがあるため)
- 投資・金融商品の売買助言、個別の医療・法律相談に該当する内容は絶対に禁止
- ナレーション(音声)とシンプルな背景動画だけで成立する内容にすること(実写の人物出演やアニメーション制作が必須なものは不可)

# fictionフィールドについて
- 雑学・科学的事実など、事実性が重要なジャンルは fiction: false にする
- 怖い話・ショートストーリーなど、エンタメ・創作として成立するジャンルは fiction: true にしてよい(創作物語だが、実話であるかのように装わないこと)

# nameの命名ルール(重要)
- nameは「雑学」「宇宙」「歴史」のように、2〜4文字程度の単語1つだけにすること
- 「の」「・」「と」などの接続詞・助詞や、長い説明的なフレーズ(例:「宇宙・スケールのシミュレーション仮説」「もしも歴史の発明が消えたら」)は絶対に使わないこと
- 詳しい内容の説明はnameではなくbriefに書くこと

# 出力JSON形式(このスキーマに厳密に従うこと。既存ジャンルと同じ形)
[
  {
    "name": "ジャンル名(上記の命名ルールに従った短い単語1つ)",
    "brief": "台本作家への指示となる説明文。何を扱うか、何を避けるべきかを具体的に",
    "format": "ranking・simulation・qaのいずれか(ranking=ベスト3形式、simulation=もしも〜だったら形式、qa=問いかけ→結論形式)",
    "fiction": "true か false(true=創作フィクションを許可するジャンル、false=事実に基づく内容限定)"
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
  if (!c.name || !c.brief || !["ranking", "simulation", "qa"].includes(c.format)) {
    console.log(`スキップ(形式が不正): ${JSON.stringify(c)}`);
    continue;
  }
  if (categories.some((existing) => existing.name === c.name)) {
    console.log(`スキップ(既存と重複): ${c.name}`);
    continue;
  }
  const fiction = c.fiction === true || c.fiction === "true";
  categories.push({ name: c.name, brief: c.brief, format: c.format, fiction });
  added++;
  console.log(`追加: ${c.name} (${c.format}, fiction: ${fiction})`);
}

if (added > 0) {
  fs.writeFileSync(categoriesPath, JSON.stringify(categories, null, 2));
  console.log(`OK: ${added}件の新ジャンルを categories.json に追加しました`);
} else {
  console.log("新しく追加されたジャンルはありませんでした");
}
