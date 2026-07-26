import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const latestScript = JSON.parse(
  fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8")
);

const entries = latestScript.segments
  .map((s) => {
    const badge = s.badge ? `, badge: ${JSON.stringify(s.badge)}` : "";
    return `  { id: ${JSON.stringify(s.id)}${badge}, caption: ${JSON.stringify(s.caption)} },`;
  })
  .join("\n");

const content = `export type SegmentId = "hook" | "rank3" | "rank2" | "rank1" | "outro";

export type Segment = {
  id: SegmentId;
  badge?: string;
  caption: string[];
};

export const segments: Segment[] = [
${entries}
];
`;

fs.writeFileSync(path.join(root, "src", "segments.ts"), content);
console.log("OK: src/segments.ts を更新しました");
