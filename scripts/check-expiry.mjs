import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 期限のある認証情報の更新忘れで自走が止まらないよう、期限の30日前から管理シートに知らせる(2026-10-13追加)。
// watchdog.ymlから1日2回呼ばれるが、シートが埋まらないよう「月曜の1回目(UTC 4時台)」だけ記録する。
// 期限が分かっているものだけをここに書く。更新したら日付も書き換えること。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const CREDENTIALS = [
  {
    name: "CLAUDE_CODE_OAUTH_TOKEN",
    // GitHub Secretsへの登録日は2026-07-26。`claude setup-token`で作るトークンは1年有効のため、その1年後を目安にしている
    expiresAt: "2027-07-26",
    howToRenew:
      "ローカルPCで claude setup-token を実行して新しいトークンを作り、GitHub Secrets(CLAUDE_CODE_OAUTH_TOKEN)に登録し直してください。登録後はこのスクリプトの期限の日付も更新してください",
  },
];

const WARN_DAYS = 30;
const now = new Date();
const isWeeklyReportRun = now.getUTCDay() === 1 && now.getUTCHours() < 6;

for (const c of CREDENTIALS) {
  const daysLeft = Math.floor((new Date(`${c.expiresAt}T00:00:00Z`).getTime() - now.getTime()) / 86400000);
  console.log(`${c.name}: 期限の目安 ${c.expiresAt}(あと${daysLeft}日)`);
  if (daysLeft > WARN_DAYS) continue;
  if (!isWeeklyReportRun) {
    console.log("  期限が近いが、シートへの記録は月曜の1回目だけにしている");
    continue;
  }
  spawnSync(
    "node",
    [
      path.join(root, "scripts", "report-status.mjs"),
      "保留",
      `${c.name} の期限(目安 ${c.expiresAt})まであと${daysLeft}日です。${c.howToRenew}`,
      "(認証情報の期限が近い)",
    ],
    { cwd: root, stdio: "inherit" }
  );
}
