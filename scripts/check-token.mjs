import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// YouTube OAuthトークンが有効かどうかを確認する(watchdog.ymlから1日2回、GitHub Actions上で
// 実行される)。ローカルPCの起動状態に依存せず、クラウド上で完結させるための監視。
// 異常時はreport-status.mjsと同じ方式で管理シートにエラー行を記録する(ローカル通知に
// 頼らず、シートを見れば気づける形にするため)。

const { installed } = JSON.parse(fs.readFileSync(path.join(root, "client_secret.json"), "utf-8"));
const tokens = JSON.parse(fs.readFileSync(path.join(root, "youtube-token.json"), "utf-8"));
const oauth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
oauth2Client.setCredentials(tokens);
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

try {
  const res = await youtube.channels.list({ part: ["snippet"], mine: true });
  const channel = res.data.items?.[0];
  if (!channel) {
    console.error("チャンネル情報が取得できませんでした(認証は通ったが該当チャンネルなし)");
    process.exit(1);
  }
  console.log(`OK: 認証は有効です(チャンネル: ${channel.snippet.title})`);
} catch (err) {
  console.error(`トークン確認に失敗しました: ${err.message}`);
  process.exit(1);
}
