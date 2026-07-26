import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const clientSecretPath = path.join(root, "client_secret.json");
const tokenPath = path.join(root, "youtube-token.json");

const { installed } = JSON.parse(fs.readFileSync(clientSecretPath, "utf-8"));
const { client_id, client_secret } = installed;

const PORT = 51823;
const REDIRECT_URI = `http://localhost:${PORT}`;

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

console.log("\n以下のURLをブラウザで開いて、YouTubeチャンネルのGoogleアカウントでログインし、「許可」してください:\n");
console.log(authUrl);
console.log("\n(自動でブラウザが開かない場合は、上のURLをコピーして手動で開いてください)\n");

const { default: open } = await import("open").catch(() => ({ default: null }));
if (open) {
  open(authUrl);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");

  if (!code) {
    res.end("認証コードが見つかりませんでした。");
    return;
  }

  res.end("認証が完了しました。このタブは閉じて、Claude Codeの画面に戻ってください。");
  server.close();

  const { tokens } = await oauth2Client.getToken(code);
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  console.log(`\n認証成功! ${tokenPath} にトークンを保存しました。`);
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`ローカルサーバーがポート${PORT}で待機中...`);
});
