import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// pipeline.mjsと同じバッファ設定。予約済み本数がこの半分を下回ったら「バッファ枯渇の危険」とみなす。
const STOCK_DAYS = 3;
const SLOTS_PER_DAY = 2;
const STOCK_SLOTS = STOCK_DAYS * SLOTS_PER_DAY;
const WARN_THRESHOLD = Math.ceil(STOCK_SLOTS / 2);

const usedTopics = JSON.parse(
  fs.readFileSync(path.join(root, "content", "used-topics.json"), "utf-8")
);
const now = new Date();
const futureQueuedCount = usedTopics.filter(
  (t) => t.publishedAt && new Date(t.publishedAt).getTime() > now.getTime()
).length;

console.log(`予約済み本数: ${futureQueuedCount}本(目標${STOCK_SLOTS}本 / 警告ライン${WARN_THRESHOLD}本)`);

if (futureQueuedCount < WARN_THRESHOLD) {
  console.error(`警告: 予約済みの投稿が${WARN_THRESHOLD}本を下回っています(${futureQueuedCount}本)`);
  process.exit(1);
}

console.log("OK: バッファは十分にあります");
