import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env");
  const text = fs.readFileSync(envPath, "utf-8");
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

const queries = [
  { id: "hook", query: "abstract particles blue" },
  { id: "rank3", query: "banana" },
  { id: "rank2", query: "honey" },
  { id: "rank1", query: "brain 3d animation" },
  { id: "outro", query: "social media phone" },
];

async function search(query) {
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(
      query
    )}&orientation=portrait&per_page=3`,
    { headers: { Authorization: apiKey } }
  );
  if (!res.ok) {
    throw new Error(`Pexels API エラー (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function pickBestFile(video) {
  // Prefer a portrait HD file (~1080x1920), fall back to the largest available.
  const files = video.video_files.filter((f) => f.file_type === "video/mp4");
  files.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const hd = files.find((f) => f.height && f.height <= 1920 && f.height >= 1280);
  return hd ?? files[0];
}

async function headSize(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const len = res.headers.get("content-length");
    return len ? `${(Number(len) / 1024 / 1024).toFixed(1)}MB` : "不明";
  } catch {
    return "不明";
  }
}

const results = [];
for (const { id, query } of queries) {
  const data = await search(query);
  const video = data.videos?.[0];
  if (!video) {
    console.log(`${id} (${query}): 候補なし`);
    continue;
  }
  const file = await pickBestFile(video);
  const size = await headSize(file.link);
  results.push({ id, query, pageUrl: video.url, fileUrl: file.link, width: file.width, height: file.height, size });
  console.log(`${id} (検索語: ${query})`);
  console.log(`  ページ: ${video.url}`);
  console.log(`  ファイル: ${file.link}`);
  console.log(`  解像度: ${file.width}x${file.height}  サイズ: ${size}`);
}

fs.writeFileSync(
  path.join(root, "scripts", "pexels-candidates.json"),
  JSON.stringify(results, null, 2)
);
console.log("\n候補一覧を scripts/pexels-candidates.json に保存しました。");
