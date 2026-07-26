import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const text = fs.readFileSync(path.join(root, ".env"), "utf-8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

const env = loadEnv();
const apiKey = env.PEXELS_API_KEY;
if (!apiKey) {
  console.error("PEXELS_API_KEY が .env に見つかりません");
  process.exit(1);
}

const scriptPath = path.join(root, "content", "latest-script.json");
const latestScript = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));

async function search(query) {
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=5`,
    { headers: { Authorization: apiKey } }
  );
  if (!res.ok) {
    throw new Error(`Pexels API エラー (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

function pickBestFile(video) {
  const files = video.video_files.filter((f) => f.file_type === "video/mp4");
  files.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const hd = files.find((f) => f.height && f.height <= 1920 && f.height >= 1280);
  return hd ?? files[0];
}

const outDir = path.join(root, "public", "bg");
fs.mkdirSync(outDir, { recursive: true });

for (const seg of latestScript.segments) {
  const data = await search(seg.pexelsQuery);
  const video = data.videos?.[0];
  if (!video) {
    throw new Error(`[${seg.id}] "${seg.pexelsQuery}" の背景動画が見つかりませんでした`);
  }
  const file = pickBestFile(video);
  const res = await fetch(file.link);
  if (!res.ok) {
    throw new Error(`[${seg.id}] ダウンロード失敗 (${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const outPath = path.join(outDir, `${seg.id}.mp4`);
  fs.writeFileSync(outPath, buffer);
  console.log(`OK: ${seg.id} <- "${seg.pexelsQuery}" (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
}

console.log("すべての背景動画を取得しました。");
