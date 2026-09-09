import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const latestScript = JSON.parse(
  fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8")
);
const { creditLine } = JSON.parse(
  fs.readFileSync(path.join(root, "content", "current-bgm-credit.json"), "utf-8")
);
const template = fs.readFileSync(path.join(root, "description-template.txt"), "utf-8");

const photoCreditsPath = path.join(root, "content", "current-photo-credits.json");
const photoCredits = fs.existsSync(photoCreditsPath)
  ? JSON.parse(fs.readFileSync(photoCreditsPath, "utf-8"))
  : [];
// Wikimedia Commonsのライセンス表示義務(CC BY / CC BY-SA)を満たすため、写真ごとに
// 作者・ライセンス・出典URLをクレジットする(fetch-real-photo.mjsが実写真を使った場合のみ)
const photoCreditsBlock =
  photoCredits.length > 0
    ? "\n" +
      photoCredits
        .map((c) => `Photo: ${c.title} by ${c.artist} (${c.license}, ${c.sourceUrl})`)
        .join("\n")
    : "";

const CORE_TAGS = ["雑学", "豆知識", "shorts"];
const GENERIC_WORDS = new Set([...CORE_TAGS, "ランキング", "雑学クイズ", "面白い雑学"]);

const extraTags = (latestScript.tags ?? [])
  .filter((t) => !GENERIC_WORDS.has(t))
  .slice(0, 2);

const hashtags = [...CORE_TAGS, ...extraTags].map((t) => `#${t}`).join(" ");

const description = `${latestScript.descriptionHook}\n\n${template
  .replace("{{MUSIC_CREDIT}}", creditLine)
  .replace("{{PHOTO_CREDITS}}", photoCreditsBlock)
  .replace("{{HASHTAGS}}", hashtags)}`;

fs.writeFileSync(path.join(root, "description.txt"), description);
fs.writeFileSync(
  path.join(root, "content", "current-hashtags.json"),
  JSON.stringify({ hashtags }, null, 2)
);
console.log(`OK: description.txt を更新しました(タグ: ${hashtags})`);
