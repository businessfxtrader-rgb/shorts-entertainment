import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const latestScript = JSON.parse(
  fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8")
);

const bgDir = path.join(root, "public", "bg");

// fetch-real-photo.mjs / auto-fetch-bg.mjsの実行後に呼ばれる前提で、実際にどちらの
// ファイルが存在するかを見て背景の種類(実写真の静止画 or Pexels動画ループ)を確定する
function detectBgType(segmentId) {
  if (fs.existsSync(path.join(bgDir, `${segmentId}.jpg`))) return { bgType: "image", bgExt: "jpg" };
  if (fs.existsSync(path.join(bgDir, `${segmentId}.png`))) return { bgType: "image", bgExt: "png" };
  return { bgType: "video", bgExt: "mp4" };
}

const entries = latestScript.segments
  .map((s) => {
    const badge = s.badge ? `, badge: ${JSON.stringify(s.badge)}` : "";
    const { bgType, bgExt } = detectBgType(s.id);
    return `  { id: ${JSON.stringify(s.id)}${badge}, caption: ${JSON.stringify(s.caption)}, bgType: ${JSON.stringify(bgType)}, bgExt: ${JSON.stringify(bgExt)} },`;
  })
  .join("\n");

const content = `export type SegmentId = "hook" | "rank3" | "rank2" | "rank1" | "outro";

export type Segment = {
  id: SegmentId;
  badge?: string;
  caption: string[];
  bgType: "image" | "video";
  bgExt: "jpg" | "png" | "mp4";
};

export const segments: Segment[] = [
${entries}
];
`;

fs.writeFileSync(path.join(root, "src", "segments.ts"), content);
console.log("OK: src/segments.ts を更新しました");
