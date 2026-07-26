import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const logPath = path.join(root, "pipeline.log");

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(logPath, line + "\n");
}

function runNode(scriptName) {
  log(`開始: ${scriptName}`);
  const result = spawnSync("node", [path.join(root, "scripts", scriptName)], {
    cwd: root,
    encoding: "utf-8",
  });
  if (result.stdout) fs.appendFileSync(logPath, result.stdout);
  if (result.stderr) fs.appendFileSync(logPath, result.stderr);
  if (result.status !== 0) {
    throw new Error(`${scriptName} が失敗しました (exit code ${result.status})`);
  }
  log(`完了: ${scriptName}`);
}

function runNodeSoft(scriptName) {
  log(`開始(失敗しても継続): ${scriptName}`);
  const result = spawnSync("node", [path.join(root, "scripts", scriptName)], {
    cwd: root,
    encoding: "utf-8",
  });
  if (result.stdout) fs.appendFileSync(logPath, result.stdout);
  if (result.stderr) fs.appendFileSync(logPath, result.stderr);
  if (result.status !== 0) {
    log(`警告: ${scriptName} が失敗しましたが、パイプラインは継続します (exit code ${result.status})`);
  } else {
    log(`完了: ${scriptName}`);
  }
}

function runRender() {
  log("開始: remotion render");
  const result = spawnSync(
    "npx",
    ["remotion", "render", "ShortsVideo", "out/final.mp4", "--crf=18"],
    { cwd: root, encoding: "utf-8", shell: true }
  );
  if (result.stdout) fs.appendFileSync(logPath, result.stdout);
  if (result.stderr) fs.appendFileSync(logPath, result.stderr);
  if (result.status !== 0) {
    throw new Error(`remotion render が失敗しました (exit code ${result.status})`);
  }
  log("完了: remotion render");
}

log("========== パイプライン開始 ==========");

try {
  runNode("generate-script.mjs");
  runNode("generate-tts.mjs");
  runNode("auto-fetch-bg.mjs");
  runNode("select-bgm.mjs");
  runNode("write-segments.mjs");
  runNode("write-description.mjs");
  runRender();
  runNode("youtube-upload.mjs");
  runNodeSoft("set-thumbnail.mjs");
  runNode("append-sheet.mjs");
  runNodeSoft("reply-comments.mjs");
  log("========== パイプライン正常終了 ==========");
} catch (err) {
  log(`エラーで停止しました: ${err.message}`);
  const report = spawnSync("node", [path.join(root, "scripts", "report-error.mjs"), err.message], {
    cwd: root,
    encoding: "utf-8",
  });
  if (report.stdout) fs.appendFileSync(logPath, report.stdout);
  if (report.stderr) fs.appendFileSync(logPath, report.stderr);
  log("========== パイプライン異常終了 ==========");
  process.exit(1);
}
