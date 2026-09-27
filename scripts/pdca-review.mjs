import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractJson } from "./lib/extract-json.mjs";

// 「直近30日以内に投稿した動画で1万回再生」を達成するまで回すPDCA(2026-09-28追加)。
// 週2回(pdca-review.yml)、track-performance.mjsの直後に動く。
//   Check: 今の方針(pdcaVersion)で作られ、公開から3日以上たった動画の成績を、前の方針の動画と比べる
//   Act/Plan: claude -pに判定と次の方針を出させる(変えるのは1〜2点ずつ。効果が分からなくなるため)
//   Do: content/pdca-directives.jsonを更新 → generate-script.mjsが次の台本から反映する
// 変えられるのは、台本の長さ・ジャンルの重み/休止・台本への追加指示だけ(コードは変えない)。
// 見た目などコードの変更が必要な案は codeSuggestions として記録だけする(人が判断して実装する)。
// 目標を達成したら、方針をそのまま固定して以降は何も変えない。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const contentDir = path.join(root, "content");

const MATURE_DAYS = 3; // ショートの配信は公開後2〜3日でほぼ決まるため、それ以前の動画は判定に使わない
const MIN_COHORT = 8; // 今の方針の動画がこれだけ集まるまでは判定しない

const readJson = (name, fallback) => {
  const p = path.join(contentDir, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : fallback;
};
const writeJson = (name, data) => fs.writeFileSync(path.join(contentDir, name), JSON.stringify(data, null, 2));

function loadEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return {};
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function runClaude(promptText) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text", "--allowedTools", "WebSearch"], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...loadEnv() },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`claude -p が失敗しました (code ${code}): ${stderr}`))));
    child.stdin.write(promptText);
    child.stdin.end();
  });
}

const median = (arr) => {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

function summarize(videos) {
  return {
    count: videos.length,
    medianViews: median(videos.map((v) => v.views)),
    maxViews: videos.length ? Math.max(...videos.map((v) => v.views)) : null,
    medianEngagedRate: round(median(videos.map((v) => v.engagedRate)), 3),
    medianAPV: round(median(videos.map((v) => v.averageViewPercentage))),
    medianLikesPer1000: round(median(videos.map((v) => (v.views > 0 && v.likes != null ? (v.likes / v.views) * 1000 : null)))),
    totalComments: videos.reduce((s, v) => s + (v.comments ?? 0), 0),
    totalShares: videos.reduce((s, v) => s + (v.shares ?? 0), 0),
    totalSubscribersGained: videos.reduce((s, v) => s + (v.subscribersGained ?? 0), 0),
  };
}

const goal = readJson("goal-status.json", {});
const directives = readJson("pdca-directives.json", { version: 0 });
const log = readJson("pdca-log.json", []);
const { videos = [] } = readJson("video-stats.json", {});
const categories = JSON.parse(fs.readFileSync(path.join(root, "scripts", "categories.json"), "utf-8"));

if (goal.achieved) {
  console.log(`目標達成済み(${goal.achievedBy?.title} ${goal.achievedBy?.views}回)。方針は変更しません`);
  if (!log.some((e) => e.type === "goal-achieved")) {
    log.push({ type: "goal-achieved", at: new Date().toISOString(), version: directives.version, achievedBy: goal.achievedBy });
    writeJson("pdca-log.json", log);
    spawnSync(
      "node",
      [
        path.join(root, "scripts", "report-status.mjs"),
        "保留",
        `【目標達成】直近30日以内の動画が1万回再生を超えました: 「${goal.achievedBy?.title}」${goal.achievedBy?.views}回。PDCAの方針(v${directives.version})を固定しました`,
        "(PDCA目標達成)",
      ],
      { cwd: root, stdio: "inherit" }
    );
  }
  process.exit(0);
}

const now = Date.now();
const mature = videos.filter(
  (v) => v.privacyStatus === "public" && v.publishedAt && now - new Date(v.publishedAt).getTime() >= MATURE_DAYS * 86400000
);
const current = mature.filter((v) => (v.pdcaVersion ?? 0) === directives.version);
const byVersion = {};
for (const v of mature) (byVersion[v.pdcaVersion ?? 0] ??= []).push(v);
const versionSummaries = Object.fromEntries(Object.entries(byVersion).map(([ver, vs]) => [ver, summarize(vs)]));

console.log(`今の方針 v${directives.version}: 判定に使える動画 ${current.length}本(必要${MIN_COHORT}本)`);
console.log(`方針ごとの成績: ${JSON.stringify(versionSummaries)}`);

if (current.length < MIN_COHORT) {
  console.log("まだ判定できる本数に達していないため、方針は変えずに観察を続けます");
  process.exit(0);
}

const genreTable = {};
for (const v of current) (genreTable[v.category] ??= []).push(v);
const genreSummary = Object.fromEntries(
  Object.entries(genreTable).map(([g, vs]) => [g, { count: vs.length, medianViews: median(vs.map((v) => v.views)), medianEngagedRate: round(median(vs.map((v) => v.engagedRate)), 3) }])
);
const pick = (v) => ({
  title: v.title,
  category: v.category,
  format: v.format,
  views: v.views,
  engagedRate: v.engagedRate,
  apv: round(v.averageViewPercentage),
  likes: v.likes,
  comments: v.comments,
  realPhotoInHook: v.realPhotoInHook,
});
const sorted = [...current].sort((a, b) => b.views - a.views);

const prompt = `あなたはYouTubeショートチャンネル「ほっと一息チャンネル」(雑学・エンタメ系、完全自動生成、VOICEVOXナレーション)の運用アナリストです。
目標は「直近30日以内に投稿した動画で1万回再生」を1本出すこと。現状の直近30日の最高は${goal.recentBest?.views ?? "不明"}回。
YouTubeパートナープログラム(収益化)の審査も目指しているため、量産型・中身の薄いコンテンツに見える方向の施策は選ばないこと。

# 今の方針(v${directives.version})
${JSON.stringify(directives, null, 2)}

# これまでのPDCAの記録(古い順)
${JSON.stringify(log.slice(-8), null, 2)}

# 方針(pdcaVersion)ごとの成績(公開から${MATURE_DAYS}日以上たった公開動画のみ)
各指標: medianViews=再生回数の中央値 / medianEngagedRate=エンゲージビュー÷再生回数(冒頭で指が止まった割合の目安。高いほど良い) / medianAPV=平均視聴率%(100超はループ再生) / medianLikesPer1000=1000再生あたりの高評価
${JSON.stringify(versionSummaries, null, 2)}

# 今の方針の動画の上位5本・下位5本
上位: ${JSON.stringify(sorted.slice(0, 5).map(pick))}
下位: ${JSON.stringify(sorted.slice(-5).map(pick))}

# 今の方針の動画のジャンル別
${JSON.stringify(genreSummary)}

# 全ジャンル名
${categories.map((c) => c.name).join("、")}

# やること
1. 今の方針が、1つ前の方針と比べて良くなったか悪くなったかを判定する(本数が少ない・同時に複数を変えた場合はその不確かさも書く)
2. 次の方針を決める。変えるのは1〜2点だけにすること(一度に多く変えると何が効いたか分からなくなる)。悪化した変更は元に戻す
3. 変えられるのは次の4つだけ:
   - narrationChars: 台本の合計文字数の範囲 {min, max}(min 150〜330、max 165〜345。読み上げは約6.2字/秒。現在の動画はナレーション+間で約40秒)
   - genreMultipliers: ジャンル名→重み倍率(0.3〜3)。伸びているジャンルを増やし、弱いジャンルを減らす
   - pausedGenres: 一時的に休止するジャンル名の配列(最低8ジャンルは残すこと)
   - promptAdditions: 台本作家への追加指示(最大6個、各150字以内)。フックの作り方・題材の選び方・語り方など。事実に反する内容・実在の人物・著作権のある作品・過激な表現を促す指示は禁止
4. コードの変更が必要な改善案(見た目・構成など)があれば codeSuggestions に書く(自動では実装されず、記録だけされる)
必要ならWeb検索で、最近伸びているショートの手法を調べてよい。

# 出力(JSONのみ。説明文やコードフェンスは付けない)
{
  "judgement": "改善 | 悪化 | 明確な差なし | 判定不能",
  "analysis": "判定の根拠(日本語2〜4文、数字を挙げる)",
  "hypothesis": "次の方針で何がなぜ良くなると考えるか(日本語1〜2文)",
  "changes": "前の方針から何を変えたか(日本語1文)",
  "narrationChars": { "min": 210, "max": 240 },
  "genreMultipliers": {},
  "pausedGenres": [],
  "promptAdditions": [],
  "codeSuggestions": []
}`;

const out = extractJson(await runClaude(prompt));

const clamp = (v, lo, hi, fb) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
const names = new Set(categories.map((c) => c.name));
const min = clamp(out.narrationChars?.min, 150, 330, directives.narrationChars?.min ?? 210);
const max = Math.max(min + 15, clamp(out.narrationChars?.max, 165, 345, directives.narrationChars?.max ?? 240));
const genreMultipliers = Object.fromEntries(
  Object.entries(out.genreMultipliers ?? {})
    .filter(([g, m]) => names.has(g) && Number.isFinite(m))
    .map(([g, m]) => [g, clamp(m, 0.3, 3, 1)])
);
let pausedGenres = (out.pausedGenres ?? []).filter((g) => names.has(g));
if (names.size - pausedGenres.length < 8) pausedGenres = pausedGenres.slice(0, Math.max(0, names.size - 8));
const promptAdditions = (out.promptAdditions ?? [])
  .filter((s) => typeof s === "string" && s.trim())
  .map((s) => s.trim().slice(0, 150))
  .slice(0, 6);

const next = {
  version: (directives.version ?? 0) + 1,
  startedAt: new Date().toISOString(),
  narrationChars: { min, max },
  genreMultipliers,
  pausedGenres,
  promptAdditions,
  hypothesis: String(out.hypothesis ?? ""),
  changes: String(out.changes ?? ""),
};

log.push({
  type: "review",
  at: new Date().toISOString(),
  judgedVersion: directives.version,
  judgement: out.judgement,
  analysis: out.analysis,
  metrics: versionSummaries,
  nextVersion: next.version,
  changes: next.changes,
  hypothesis: next.hypothesis,
  codeSuggestions: out.codeSuggestions ?? [],
});
writeJson("pdca-directives.json", next);
writeJson("pdca-log.json", log);

const summary = `## PDCA v${directives.version} → v${next.version}
- 判定: ${out.judgement}
- 根拠: ${out.analysis}
- 次の変更: ${next.changes}
- 仮説: ${next.hypothesis}
- コード変更の提案: ${(out.codeSuggestions ?? []).join(" / ") || "なし"}
`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
