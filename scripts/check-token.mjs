import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// YouTube OAuthトークンが有効かどうかを確認する(watchdog.ymlから1日2回、GitHub Actions上で
// 実行される)。ローカルPCの起動状態に依存せず、クラウド上で完結させるための監視。
//
// 2026-10-13改訂: 2026-10-08 20:23の監視で、APIが一度だけ「認証情報が無効」(401)を返し、
// 実際には失効していないのに管理シートへ「トークン失効警告」が出た(同日19:03の監視もその後の
// 監視・アップロードもすべて成功)。一時的なエラー1回で警告しないよう、
//   - アクセストークンを取り直しながら、間隔を空けて最大4回試す
//   - リフレッシュトークン自体が無効(invalid_grant)のときだけ「失効」と判定する(再試行しても直らないため即判定)
// 終了コード: 0=有効 / 1=失効(要再認証) / 0(警告ログのみ)=4回とも一時的なエラー
// 一時的なエラーが長引く場合は、動画作成の失敗やバッファ残量の監視が別途シートに記録する

const ATTEMPTS = 4;
const WAIT_MS = Number(process.env.TOKEN_CHECK_WAIT_MS ?? 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));

const isRevoked = (err) => {
  const text = `${err?.message ?? ""} ${JSON.stringify(err?.response?.data ?? {})}`;
  return /invalid_grant|Token has been expired or revoked|unauthorized_client|invalid_client/i.test(text);
};

let lastError = null;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  // 毎回新しいクライアントで、保存済みのアクセストークンを使わずリフレッシュトークンから取り直す
  const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
  oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  try {
    const res = await youtube.channels.list({ part: ["snippet"], mine: true });
    const channel = res.data.items?.[0];
    if (!channel) throw new Error("認証は通ったがチャンネル情報が取得できない");
    console.log(`OK: 認証は有効です(チャンネル: ${channel.snippet.title}、${attempt}回目で確認)`);
    process.exit(0);
  } catch (err) {
    lastError = err;
    if (isRevoked(err)) {
      console.error(`トークンが失効しています(再認証が必要): ${err.message}`);
      process.exit(1);
    }
    console.log(`一時的なエラーの可能性(${attempt}/${ATTEMPTS}回目): ${err.message}`);
    if (attempt < ATTEMPTS) await sleep(WAIT_MS);
  }
}

console.log(
  `警告: ${ATTEMPTS}回とも確認できませんでしたが、トークン失効のエラーではないため警告は出しません: ${lastError?.message}`
);
process.exit(0);
