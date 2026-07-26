import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

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
if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error("CLAUDE_CODE_OAUTH_TOKEN が .env に見つかりません");
  process.exit(1);
}

const usedTopicsPath = path.join(root, "content", "used-topics.json");
const misreadingDictPath = path.join(root, "content", "misreading-dict.json");
const outputPath = path.join(root, "content", "latest-script.json");

const usedTopics = JSON.parse(fs.readFileSync(usedTopicsPath, "utf-8"));
const misreadingDict = JSON.parse(fs.readFileSync(misreadingDictPath, "utf-8"));

const usedTitlesList = usedTopics.map((t) => `- ${t.title}(${t.topics.join("/")})`).join("\n");
const misreadingList = Object.entries(misreadingDict)
  .map(([kanji, kana]) => `${kanji}→${kana}`)
  .join("、");

const categoriesPath = path.join(root, "scripts", "categories.json");
const CATEGORIES = JSON.parse(fs.readFileSync(categoriesPath, "utf-8"));
const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

const formatInstructions =
  category.format === "simulation"
    ? `- フォーマット: フック(極端な仮定を提示)→段階1→段階2→クライマックス、の5パート構成(シミュレーション仮説型)。badgeはすべてnullにする(順位表示はしない)
- 「もし〜だったら」「〜を1mmにしたら」のような、実在の科学的知見に基づく計算・比較を使った極端な思考実験にする。話が段階的にスケールアップしていく構成にする`
    : `- フォーマット: フック→第3位→第2位→第1位→締め、の5パート構成(ランキング型)`;

const titleInstructions =
  category.format === "simulation"
    ? "動画タイトル(30字以内、「もし〜だったら」「〜を1mmにしたら」のような極端な仮定が伝わる、事実に反しないキャッチーなもの)"
    : "動画タイトル(30字以内、ベスト3形式が伝わる魅力的なもの)";

const topicsInstructions =
  category.format === "simulation"
    ? "各段階の一言要約(3つ、話が進むにつれてスケールアップする)"
    : "3位/2位/1位の一言要約";

const segmentsExample =
  category.format === "simulation"
    ? `  "segments": [
    { "id": "hook", "badge": null, "caption": ["画面表示1行目", "画面表示2行目"], "narration": "極端な仮定を提示する読み上げ文", "pexelsQuery": "背景動画検索用の英語キーワード" },
    { "id": "rank3", "badge": null, "caption": ["...", "..."], "narration": "段階1の説明", "pexelsQuery": "..." },
    { "id": "rank2", "badge": null, "caption": ["...", "..."], "narration": "段階2の説明(スケールアップ)", "pexelsQuery": "..." },
    { "id": "rank1", "badge": null, "caption": ["...", "..."], "narration": "クライマックス(最も極端な結末)", "pexelsQuery": "..." },
    { "id": "outro", "badge": null, "caption": ["...", "..."], "narration": "チャンネル登録を促す文", "pexelsQuery": "..." }
  ]`
    : `  "segments": [
    { "id": "hook", "badge": null, "caption": ["画面表示1行目", "画面表示2行目"], "narration": "読み上げ文", "pexelsQuery": "背景動画検索用の英語キーワード" },
    { "id": "rank3", "badge": "第3位", "caption": ["...", "..."], "narration": "...", "pexelsQuery": "..." },
    { "id": "rank2", "badge": "第2位", "caption": ["...", "..."], "narration": "...", "pexelsQuery": "..." },
    { "id": "rank1", "badge": "第1位", "caption": ["...", "..."], "narration": "...", "pexelsQuery": "..." },
    { "id": "outro", "badge": null, "caption": ["...", "..."], "narration": "チャンネル登録を促す文", "pexelsQuery": "..." }
  ]`;

const prompt = `あなたはYouTubeショート動画の台本作家です。エンタメ・雑学系チャンネル用に、新しい1本分の台本をJSON形式だけで出力してください。説明文やコードフェンス(\`\`\`)は一切つけず、JSONのみを出力してください。

# チャンネル設定
- ナレーター: 20代女性の落ち着いたトーン
${formatInstructions}
- 締めのセリフは必ず「チャンネル登録」を促す言葉を含める(「フォロー」ではなく「チャンネル登録」)

# 過去に使ったネタ(絶対に重複させないこと)
${usedTitlesList || "(まだありません)"}

# 今回のジャンル
${category.name}: ${category.brief}

# ネタの条件
- 上記ジャンルの範囲内で作ること。悩み相談・個別相談への誘導・アフィリエイト誘導は絶対に含めない
- 内容は、事実として一般的に広く知られている正確な内容、または実在の科学的知見に基づく計算にする(不確かな内容や誇張は避ける)
- 全体で読み上げ時間40〜60秒程度になるよう、各narrationは短く

# 重複コンテンツ判定を避けるための工夫(重要)
- フックの言い回し・構成の型は、過去のネタと違うパターンにすること(問いかけ型・数字型・逆張り型など毎回変える)
- ナレーションの語り口も、丁寧すぎる/フランクめ等、毎回少し変化をつける

# 誤読防止ルール
- narration(読み上げ用テキスト)の中に、次の漢字が含まれる場合は必ずひらがなに置き換えること: ${misreadingList}
- telop(画面表示用テキスト)は通常の漢字表記のままでよい

# JSON出力上の重要な注意
- caption・narration・title等のテキスト内では、二重引用符(")を絶対に使わないこと。強調したい場合は「」(かぎ括弧)を使うこと。二重引用符を使うとJSONが壊れます。

# 出力JSON形式(このスキーマに厳密に従うこと)
{
  "title": "${titleInstructions}",
  "topics": ["${topicsInstructions}"],
  "descriptionHook": "概要欄の1行目。動画の内容を要約した1文",
  "tags": ["タグ1", "タグ2", "... 具体的なキーワードを8個程度"],
${segmentsExample}
}`;

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
  if (start === -1 || end === -1) {
    throw new Error(`JSONが見つかりませんでした。出力: ${text}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

console.log(`claude -p で新しい台本を生成中...(ジャンル: ${category.name})`);
const raw = await runClaude(prompt);
const script = extractJson(raw);
script.category = category.name;
script.format = category.format;

const requiredIds = ["hook", "rank3", "rank2", "rank1", "outro"];
const gotIds = script.segments.map((s) => s.id);
for (const id of requiredIds) {
  if (!gotIds.includes(id)) {
    throw new Error(`生成結果に "${id}" セグメントがありません`);
  }
}

fs.writeFileSync(outputPath, JSON.stringify(script, null, 2));
console.log(`OK: ${outputPath} に保存しました`);
console.log(`タイトル: ${script.title}`);
