import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const MAX_REPLIES_PER_RUN = 3;

const X_URL = "https://x.com/sakanachan_love";

// Xへの案内を含む返信(言い回しを変えたパターン。毎回同じ文面だとスパム判定のリスクがあるため)
const TEMPLATES_WITH_LINK = [
  `コメントありがとうございます!\nぜひ、感想・お問い合わせはX(Twitter)までお送りください!\n\n▼X(Twitter)はこちら\n${X_URL}`,
  `見てくださってありがとうございます!感想はXでもお待ちしています。\n\n▼X(Twitter)はこちら\n${X_URL}`,
  `コメント嬉しいです!よかったらXでも感想聞かせてください。\n\n▼X(Twitter)はこちら\n${X_URL}`,
  `ありがとうございます!お問い合わせ等はXからお願いします。\n\n▼X(Twitter)はこちら\n${X_URL}`,
  `コメントありがとうございます😊 感想はXでもぜひ!\n\n▼X(Twitter)はこちら\n${X_URL}`,
  `見ていただき感謝です!Xでも発信しているので、よければ覗いてみてください。\n\n▼X(Twitter)はこちら\n${X_URL}`,
  `ありがとうございます!ご意見・ご感想はXまでお寄せください。\n\n▼X(Twitter)はこちら\n${X_URL}`,
  `コメント嬉しいです!Xでも交流しているので、ぜひ見てみてください。\n\n▼X(Twitter)はこちら\n${X_URL}`,
  `見てくださりありがとうございます!感想・お問い合わせはXまでどうぞ。\n\n▼X(Twitter)はこちら\n${X_URL}`,
  `ありがとうございます!Xでも雑学を発信しています、ぜひ覗いてみてください。\n\n▼X(Twitter)はこちら\n${X_URL}`,
];

// リンクなしの返信(毎回リンクを貼ると宣伝色が強すぎて凍結リスクが上がるため、一部混ぜる)
const TEMPLATES_PLAIN = [
  "コメントありがとうございます!励みになります。",
  "見てくださってありがとうございます!また面白い雑学お届けしますね。",
  "コメント嬉しいです!今後もよろしくお願いします。",
  "うれしいコメントありがとうございます!",
];

function pickTemplate() {
  // 7割はXへの案内あり、3割はプレーンな返信
  const pool = Math.random() < 0.7 ? TEMPLATES_WITH_LINK : TEMPLATES_PLAIN;
  return pool[Math.floor(Math.random() * pool.length)];
}

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

const usedTopics = JSON.parse(
  fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8")
);
const videoIds = usedTopics.filter((t) => t.videoId).map((t) => t.videoId);

const repliedPath = path.join(root, "content", "replied-comments.json");
const replied = new Set(fs.existsSync(repliedPath) ? JSON.parse(fs.readFileSync(repliedPath, "utf-8")) : []);

let repliesSent = 0;

for (const videoId of videoIds) {
  if (repliesSent >= MAX_REPLIES_PER_RUN) break;

  let threads;
  try {
    const res = await youtube.commentThreads.list({
      part: ["snippet"],
      videoId,
      maxResults: 20,
      order: "time",
    });
    threads = res.data.items ?? [];
  } catch (err) {
    // コメントが無効化されている動画等はスキップ
    continue;
  }

  for (const thread of threads) {
    if (repliesSent >= MAX_REPLIES_PER_RUN) break;

    const commentId = thread.snippet.topLevelComment.id;
    if (replied.has(commentId)) continue;

    // 自分自身の過去のコメントには返信しない
    const authorChannelId = thread.snippet.topLevelComment.snippet.authorChannelId?.value;
    if (authorChannelId === tokens.channelId) continue;

    const text = pickTemplate();
    try {
      await youtube.comments.insert({
        part: ["snippet"],
        requestBody: {
          snippet: { parentId: commentId, textOriginal: text },
        },
      });
      replied.add(commentId);
      repliesSent++;
      console.log(`返信済み: ${commentId} -> "${text}"`);
    } catch (err) {
      console.log(`返信失敗: ${commentId} (${err.message})`);
    }
  }
}

fs.writeFileSync(repliedPath, JSON.stringify([...replied], null, 2));
console.log(`OK: ${repliesSent}件のコメントに返信しました`);
