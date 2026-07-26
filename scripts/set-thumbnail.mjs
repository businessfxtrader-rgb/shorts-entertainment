import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const usedTopics = JSON.parse(
  fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8")
);
const latestEntry = usedTopics[usedTopics.length - 1];

if (!latestEntry || !latestEntry.videoId) {
  console.error("動画IDが見つかりません");
  process.exit(1);
}

const thumbnailPath = path.join(root, "out", "thumbnail.jpeg");

console.log("サムネイル画像を生成中...");
const render = spawnSync(
  "npx",
  [
    "remotion",
    "still",
    "ShortsVideo",
    "out/thumbnail.jpeg",
    "--frame=25",
    "--image-format=jpeg",
    "--jpeg-quality=85",
  ],
  { cwd: root, encoding: "utf-8", shell: true }
);
if (render.status !== 0) {
  console.error(render.stdout);
  console.error(render.stderr);
  throw new Error("サムネイルのレンダリングに失敗しました");
}
console.log("OK: サムネイル画像を生成しました");

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

console.log("サムネイルをアップロード中...");
try {
  await youtube.thumbnails.set({
    videoId: latestEntry.videoId,
    media: { body: fs.createReadStream(thumbnailPath) },
  });
  console.log(`OK: ${latestEntry.videoId} にサムネイルを設定しました`);
} catch (err) {
  const message = err?.errors?.[0]?.message || err.message;
  console.error(`サムネイル設定に失敗しました: ${message}`);
  console.error(
    "多くの場合、チャンネルの電話番号確認(カスタムサムネイル機能の解放)が済んでいないことが原因です。"
  );
  process.exit(1);
}
