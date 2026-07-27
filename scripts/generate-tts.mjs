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
const apiKey = env.GOOGLE_TTS_API_KEY;
if (!apiKey) {
  console.error("GOOGLE_TTS_API_KEY が .env に見つかりません");
  process.exit(1);
}

const scriptPath = path.join(root, "content", "latest-script.json");
const latestScript = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
const segments = latestScript.segments.map((s) => ({ id: s.id, text: s.narration }));

const outDir = path.join(root, "public", "audio");
fs.mkdirSync(outDir, { recursive: true });

async function synthesize(segment) {
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: segment.text },
        voice: { languageCode: "ja-JP", name: "ja-JP-Chirp3-HD-Orus" },
        audioConfig: { audioEncoding: "MP3", speakingRate: 1.15 },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[${segment.id}] TTS API エラー (${res.status}): ${body}`);
  }

  const json = await res.json();
  const buffer = Buffer.from(json.audioContent, "base64");
  const outPath = path.join(outDir, `${segment.id}.mp3`);
  fs.writeFileSync(outPath, buffer);
  console.log(`OK: ${outPath}`);
}

for (const segment of segments) {
  await synthesize(segment);
}

console.log("すべてのナレーション音声を生成しました。");
