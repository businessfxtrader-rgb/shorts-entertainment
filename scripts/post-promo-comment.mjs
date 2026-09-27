import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

// 公開済みの動画に、Xと別チャンネルへの案内コメントをチャンネル自身として投稿する(2026-09-28追加。
// 視聴者コメントへの自動返信 reply-comments.mjs は廃止し、こちらに置き換えた)。
// - YouTube Data APIにはコメントを「固定」する機能がないため、投稿までを自動化する(固定は手動のみ)
// - 予約公開前(private)の動画にはコメントできないため、公開済み(public)の動画だけが対象
// - 投稿済みの記録は content/promo-comments.json。記録が失われても二重投稿しないよう、
//   投稿前に動画のコメント欄を見て、自チャンネルの同じ案内コメントがあればそれを記録するだけにする
// - コメント投稿はAPIの枠を1件50使う。同じ文面のリンク付きコメントを短時間に大量投稿すると
//   スパム扱いされる恐れもあるため、1回の実行での上限(PROMO_MAX)と投稿間隔(PROMO_DELAY_MS)を設ける

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const CHANNEL_ID = "UCiPr3RQd39CFUV1NXZMtWLA"; // ほっと一息チャンネル
const MARKER = "x.com/sakanachan_love"; // 既に案内コメントがあるかの判定に使う
const PROMO_TEXT = `Xや他のチャンネルもやっているので、ぜひ覗いてみてね！

【X（Twitter）】
https://x.com/sakanachan_love

【別チャンネル】
https://www.youtube.com/@tac_group

概要欄からクリックしてみてください！`;

const MAX_PER_RUN = Number(process.env.PROMO_MAX ?? 10);
const DELAY_MS = Number(process.env.PROMO_DELAY_MS ?? 20000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

// 認証中のアカウントが別チャンネルだった場合に、そのチャンネル名義でコメントしてしまわないよう確認する
const me = await youtube.channels.list({ part: ["id"], mine: true });
const myId = me.data.items?.[0]?.id;
if (myId !== CHANNEL_ID) {
  console.error(`認証中のチャンネル(${myId})が ほっと一息チャンネル(${CHANNEL_ID}) ではないため中止します`);
  process.exit(1);
}

const usedTopics = JSON.parse(fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8"));
const statePath = path.join(root, "content", "promo-comments.json");
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf-8")) : {};
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

const now = Date.now();
// 公開時刻を過ぎた動画を、新しい順に(いま見られている動画から優先して)処理する
const candidates = usedTopics
  .filter((t) => t.videoId && !state[t.videoId] && t.publishedAt && new Date(t.publishedAt).getTime() <= now)
  .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

console.log(`案内コメント未投稿の公開済み動画: ${candidates.length}本(今回の上限${MAX_PER_RUN}本)`);

let posted = 0;
for (const t of candidates) {
  if (posted >= MAX_PER_RUN) break;

  const v = await youtube.videos.list({ part: ["status", "snippet"], id: [t.videoId] });
  const item = v.data.items?.[0];
  if (!item) {
    console.log(`スキップ(動画が見つからない): ${t.videoId}`);
    continue;
  }
  if (item.snippet.channelId !== CHANNEL_ID) {
    console.log(`スキップ(別チャンネルの動画): ${t.videoId}`);
    continue;
  }
  if (item.status.privacyStatus !== "public") {
    console.log(`スキップ(まだ公開されていない: ${item.status.privacyStatus}): ${t.videoId}`);
    continue;
  }

  let existing = null;
  try {
    const threads = await youtube.commentThreads.list({ part: ["snippet"], videoId: t.videoId, maxResults: 100 });
    existing = (threads.data.items ?? []).find((th) => {
      const s = th.snippet.topLevelComment.snippet;
      return s.authorChannelId?.value === CHANNEL_ID && (s.textOriginal ?? "").includes(MARKER);
    });
  } catch (err) {
    console.log(`スキップ(コメント欄を読めない: ${err.message}): ${t.videoId}`);
    continue;
  }
  if (existing) {
    state[t.videoId] = { commentId: existing.snippet.topLevelComment.id, postedAt: existing.snippet.topLevelComment.snippet.publishedAt };
    save();
    console.log(`投稿済みを確認(記録のみ): ${t.videoId}`);
    continue;
  }

  if (posted > 0) await sleep(DELAY_MS);
  try {
    const res = await youtube.commentThreads.insert({
      part: ["snippet"],
      requestBody: {
        snippet: { channelId: CHANNEL_ID, videoId: t.videoId, topLevelComment: { snippet: { textOriginal: PROMO_TEXT } } },
      },
    });
    state[t.videoId] = { commentId: res.data.id, postedAt: new Date().toISOString() };
    save();
    posted++;
    console.log(`投稿: ${t.videoId} ${t.title}`);
  } catch (err) {
    console.log(`投稿失敗: ${t.videoId} (${err.message})`);
    // 枠切れ・レート制限なら、残りは次回の実行に回す
    if (/quota|rate/i.test(err.message)) break;
  }
}

save();
console.log(`OK: 案内コメントを${posted}件投稿しました`);
