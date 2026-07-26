import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const candidates = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "pexels-candidates.json"), "utf-8")
);

const outDir = path.join(root, "public", "bg");
fs.mkdirSync(outDir, { recursive: true });

for (const c of candidates) {
  const res = await fetch(c.fileUrl);
  if (!res.ok) {
    throw new Error(`[${c.id}] ダウンロード失敗 (${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const outPath = path.join(outDir, `${c.id}.mp4`);
  fs.writeFileSync(outPath, buffer);
  console.log(`OK: ${outPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
}

console.log("すべての背景動画をダウンロードしました。");
