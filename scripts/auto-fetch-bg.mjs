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

// 2026-10-13(PDCA v3): 1つのsegmentの中で背景を約3秒ごとに切り替えるため、最大3本の映像を取る。
// 1本目 = pexelsQuery(実写真があればそれが1本目になるので取らない)、2・3本目 = extraPexelsQueries。
// ファイル名は <id>.mp4(1本目)、<id>_2.mp4、<id>_3.mp4。同じ動画の中で同じ映像が二度出ないようにする。
// 追加カットが見つからなくても動画作りは止めない(そのsegmentはカット数が減るだけ)
const MAX_CLIPS = 3;
const usedVideoIds = new Set();

// パイプラインは複数動画を続けて作るため、前の動画の追加カットが残らないよう先に消す
for (const seg of latestScript.segments) {
  for (let k = 2; k <= MAX_CLIPS; k++) {
    const stale = path.join(outDir, `${seg.id}_${k}.mp4`);
    if (fs.existsSync(stale)) fs.rmSync(stale);
  }
}

async function download(video, outPath, label) {
  const file = pickBestFile(video);
  const res = await fetch(file.link);
  if (!res.ok) throw new Error(`${label} ダウンロード失敗 (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  usedVideoIds.add(video.id);
  return buffer.length;
}

const firstUnused = (data) => (data.videos ?? []).find((v) => !usedVideoIds.has(v.id));

for (const seg of latestScript.segments) {
  // fetch-real-photo.mjsが実写真を取得済みなら、それを1本目にする
  const hasRealPhoto = fs.existsSync(path.join(outDir, `${seg.id}.jpg`)) || fs.existsSync(path.join(outDir, `${seg.id}.png`));
  const mainData = await search(seg.pexelsQuery);

  if (hasRealPhoto) {
    console.log(`SKIP: ${seg.id} の1本目は実写真を使います`);
  } else {
    const video = firstUnused(mainData);
    if (!video) {
      throw new Error(`[${seg.id}] "${seg.pexelsQuery}" の背景動画が見つかりませんでした`);
    }
    const size = await download(video, path.join(outDir, `${seg.id}.mp4`), `[${seg.id}]`);
    console.log(`OK: ${seg.id} <- "${seg.pexelsQuery}" (${(size / 1024 / 1024).toFixed(1)}MB)`);
  }

  const extras = Array.isArray(seg.extraPexelsQueries) ? seg.extraPexelsQueries.filter((q) => typeof q === "string" && q.trim()) : [];
  for (let k = 2; k <= MAX_CLIPS; k++) {
    const query = extras[k - 2];
    try {
      // 追加カット用のキーワードで探し、無ければ1本目と同じキーワードの別の映像を使う
      let video = query ? firstUnused(await search(query)) : null;
      if (!video) video = firstUnused(mainData);
      if (!video) {
        console.log(`[${seg.id}] ${k}本目の映像は見つかりませんでした(カット数を減らします)`);
        continue;
      }
      const size = await download(video, path.join(outDir, `${seg.id}_${k}.mp4`), `[${seg.id}_${k}]`);
      console.log(`OK: ${seg.id}_${k} <- "${query ?? seg.pexelsQuery}" (${(size / 1024 / 1024).toFixed(1)}MB)`);
    } catch (err) {
      console.log(`[${seg.id}] ${k}本目の映像の取得に失敗しました(カット数を減らします): ${err.message}`);
    }
  }
}

console.log("すべての背景動画を取得しました。");
