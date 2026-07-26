import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const MAX_REPLIES_PER_RUN = 3;

const TEMPLATES = [
  "コメントありがとうございます!励みになります。",
  "見てくださってありがとうございます!また面白い雑学お届けしますね。",
  "コメント嬉しいです!今後もよろしくお願いします。",
  "ありがとうございます!他の動画もぜひ見てみてください。",
  "コメントありがとうございます😊 引き続き頑張ります!",
  "見ていただけて嬉しいです!チャンネル登録もお待ちしています。",
  "ありがとうございます!次回の投稿もお楽しみに。",
  "コメント感謝です!また新しい雑学を紹介しますね。",
  "うれしいコメントありがとうございます!",
  "見てくださってありがとうございます、参考になれば幸いです!",
  "コメントありがとうございます!今後も面白い内容をお届けします。",
  "ありがとうございます!よかったら他の動画も覗いてみてください。",
  "コメント嬉しいです😊 これからもよろしくお願いします!",
  "見ていただき感謝です!また次の動画でお会いしましょう。",
  "ありがとうございます!励みになります、これからも頑張ります。",
];

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

    const text = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
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
