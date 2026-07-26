import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));

const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);

const youtube = google.youtube({ version: "v3", auth: oauth2Client });

const latestScript = JSON.parse(
  fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8")
);
const description = fs.readFileSync(path.join(root, "description.txt"), "utf-8");
const videoPath = path.join(root, "out", "final.mp4");

if (!fs.existsSync(videoPath)) {
  console.error(`動画ファイルが見つかりません: ${videoPath}`);
  process.exit(1);
}

console.log(`アップロード中: ${latestScript.title}`);

const res = await youtube.videos.insert({
  part: ["snippet", "status"],
  requestBody: {
    snippet: {
      title: latestScript.title,
      description,
      tags: latestScript.tags,
      categoryId: "24",
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false,
    },
  },
  media: {
    body: fs.createReadStream(videoPath),
  },
});

const videoId = res.data.id;
const publishedAt = res.data.snippet.publishedAt;
console.log(`OK: https://youtube.com/shorts/${videoId}`);

const usedTopicsPath = path.join(root, "content", "used-topics.json");
const usedTopics = JSON.parse(fs.readFileSync(usedTopicsPath, "utf-8"));
usedTopics.push({
  title: latestScript.title,
  topics: latestScript.topics,
  date: new Date().toISOString().slice(0, 10),
  publishedAt,
  videoId,
});
fs.writeFileSync(usedTopicsPath, JSON.stringify(usedTopics, null, 2));
console.log("OK: used-topics.json を更新しました");
