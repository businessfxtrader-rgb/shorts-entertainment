import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const logPath = path.join(root, "pipeline.log");
const MAX_ATTEMPTS = 10;

// 「バッファ方式」の設定: 常にSTOCK_DAYS日分・1日あたりSLOT_HOURS_UTC.length本の
// 予約投稿をストックしておく。実際の公開時刻はYouTube側のpublishAtが正確に守るため、
// このパイプラインの実行タイミングが多少ズレても投稿の公開時刻には影響しない。
const STOCK_DAYS = 3;
const SLOT_HOURS_UTC = [3, 9]; // 03:00 UTC = 12:00 JST, 09:00 UTC = 18:00 JST
const STOCK_SLOTS = STOCK_DAYS * SLOT_HOURS_UTC.length;
const MAX_NEW_PER_RUN = 3; // 1回の実行で作りすぎないための上限

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(logPath, line + "\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1〜3分のランダムな待ち時間(同じ待ち時間で連続失敗するのを避けるため)
function randomWaitMs() {
  return (60 + Math.floor(Math.random() * 120)) * 1000;
}

function runOnce(scriptName, envOverrides = {}) {
  const result = spawnSync("node", [path.join(root, "scripts", scriptName)], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, ...envOverrides },
  });
  if (result.stdout) fs.appendFileSync(logPath, result.stdout);
  if (result.stderr) fs.appendFileSync(logPath, result.stderr);
  return result;
}

function runRenderOnce() {
  const result = spawnSync(
    "npx",
    ["remotion", "render", "ShortsVideo", "out/final.mp4", "--crf=18"],
    { cwd: root, encoding: "utf-8", shell: true }
  );
  if (result.stdout) fs.appendFileSync(logPath, result.stdout);
  if (result.stderr) fs.appendFileSync(logPath, result.stderr);
  return result;
}

// 生成・投稿・シート記入などの重要な工程は、失敗しても1〜3分待って最大10回まで再試行する
async function runWithRetry(label, runFn) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    log(`開始(${attempt}/${MAX_ATTEMPTS}回目): ${label}`);
    const result = runFn();
    if (result.status === 0) {
      log(`完了: ${label}`);
      return;
    }
    log(`失敗(${attempt}/${MAX_ATTEMPTS}回目): ${label} (exit code ${result.status})`);
    if (attempt < MAX_ATTEMPTS) {
      const waitMs = randomWaitMs();
      log(`${Math.round(waitMs / 1000)}秒待って再試行します...`);
      await sleep(waitMs);
    }
  }
  throw new Error(`${label} が${MAX_ATTEMPTS}回試行しても失敗しました`);
}

function runNodeSoft(scriptName) {
  log(`開始(失敗しても継続): ${scriptName}`);
  const result = runOnce(scriptName);
  if (result.status !== 0) {
    log(`警告: ${scriptName} が失敗しましたが、パイプラインは継続します (exit code ${result.status})`);
  } else {
    log(`完了: ${scriptName}`);
  }
}

// 今から先の投稿枠(JST 12:00 / 18:00)を、必要数だけ古い順に列挙する
function computeUpcomingSlots(now, count) {
  const slots = [];
  let dayOffset = 0;
  while (slots.length < count && dayOffset < 30) {
    const baseUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset);
    for (const h of SLOT_HOURS_UTC) {
      const slot = new Date(baseUTC + h * 3600 * 1000);
      if (slot.getTime() > now.getTime()) slots.push(slot);
    }
    dayOffset++;
  }
  slots.sort((a, b) => a - b);
  return slots.slice(0, count);
}

log("========== パイプライン開始(バッファチェック) ==========");

const usedTopicsPath = path.join(root, "content", "used-topics.json");
const usedTopics = JSON.parse(fs.readFileSync(usedTopicsPath, "utf-8"));
const now = new Date();

// used-topics.jsonのpublishedAtが未来の日時になっているもの = まだ公開されていない予約済み動画
const futureQueuedCount = usedTopics.filter(
  (t) => t.publishedAt && new Date(t.publishedAt).getTime() > now.getTime()
).length;

const upcomingSlots = computeUpcomingSlots(now, STOCK_SLOTS);
const neededCount = Math.max(0, STOCK_SLOTS - futureQueuedCount);
const slotsToFill = upcomingSlots.slice(
  futureQueuedCount,
  futureQueuedCount + Math.min(neededCount, MAX_NEW_PER_RUN)
);

log(
  `現在の予約済み本数: ${futureQueuedCount}本 / 目標: ${STOCK_SLOTS}本(${STOCK_DAYS}日分・1日${SLOT_HOURS_UTC.length}本) → 今回作成: ${slotsToFill.length}本`
);

for (const slot of slotsToFill) {
  const slotIso = slot.toISOString();
  log(`----- 予約枠 ${slotIso} 用の動画を作成します -----`);
  try {
    await runWithRetry("generate-script.mjs", () => runOnce("generate-script.mjs"));
    await runWithRetry("generate-tts.mjs", () => runOnce("generate-tts.mjs"));
    await runWithRetry("auto-fetch-bg.mjs", () => runOnce("auto-fetch-bg.mjs"));
    await runWithRetry("select-bgm.mjs", () => runOnce("select-bgm.mjs"));
    await runWithRetry("write-segments.mjs", () => runOnce("write-segments.mjs"));
    await runWithRetry("write-description.mjs", () => runOnce("write-description.mjs"));
    await runWithRetry("remotion render", runRenderOnce);
    await runWithRetry("youtube-upload.mjs", () =>
      runOnce("youtube-upload.mjs", { TARGET_PUBLISH_AT: slotIso })
    );
    runNodeSoft("set-thumbnail.mjs");
    await runWithRetry("append-sheet.mjs", () => runOnce("append-sheet.mjs"));
    log(`----- 予約枠 ${slotIso} 完了 -----`);
  } catch (err) {
    log(`予約枠 ${slotIso} の作成に失敗しました: ${err.message}`);
    const report = spawnSync(
      "node",
      [
        path.join(root, "scripts", "report-status.mjs"),
        "エラー",
        `予約枠(${slotIso})の動画作成に失敗しました: ${err.message}`,
      ],
      { cwd: root, encoding: "utf-8" }
    );
    if (report.stdout) fs.appendFileSync(logPath, report.stdout);
    if (report.stderr) fs.appendFileSync(logPath, report.stderr);
    // このスロットの失敗で全体を止めない。バッファに余裕があるため次回実行時に再試行される。
  }
}

runNodeSoft("reply-comments.mjs");

log("========== パイプライン終了 ==========");
