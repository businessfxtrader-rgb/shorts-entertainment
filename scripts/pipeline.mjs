import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const logPath = path.join(root, "pipeline.log");
const MAX_ATTEMPTS = 3;

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

function runOnce(scriptName) {
  const result = spawnSync("node", [path.join(root, "scripts", scriptName)], {
    cwd: root,
    encoding: "utf-8",
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

// 生成・投稿・シート記入などの重要な工程は、失敗しても1〜3分待って最大3回まで再試行する
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

log("========== パイプライン開始 ==========");

try {
  await runWithRetry("generate-script.mjs", () => runOnce("generate-script.mjs"));
  await runWithRetry("generate-tts.mjs", () => runOnce("generate-tts.mjs"));
  await runWithRetry("auto-fetch-bg.mjs", () => runOnce("auto-fetch-bg.mjs"));
  await runWithRetry("select-bgm.mjs", () => runOnce("select-bgm.mjs"));
  await runWithRetry("write-segments.mjs", () => runOnce("write-segments.mjs"));
  await runWithRetry("write-description.mjs", () => runOnce("write-description.mjs"));
  await runWithRetry("remotion render", runRenderOnce);
  await runWithRetry("youtube-upload.mjs", () => runOnce("youtube-upload.mjs"));
  runNodeSoft("set-thumbnail.mjs");
  await runWithRetry("append-sheet.mjs", () => runOnce("append-sheet.mjs"));
  runNodeSoft("reply-comments.mjs");
  log("========== パイプライン正常終了 ==========");
} catch (err) {
  log(`エラーで停止しました: ${err.message}`);
  const report = spawnSync(
    "node",
    [path.join(root, "scripts", "report-status.mjs"), "エラー", err.message],
    { cwd: root, encoding: "utf-8" }
  );
  if (report.stdout) fs.appendFileSync(logPath, report.stdout);
  if (report.stderr) fs.appendFileSync(logPath, report.stderr);
  log("========== パイプライン異常終了 ==========");
  process.exit(1);
}
