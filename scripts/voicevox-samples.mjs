import fs from "node:fs";
import path from "node:path";
import {
  VOICE_POOL,
  TARGET_CPS,
  fetchSpeakers,
  resolveStyleId,
  synthesizeWav,
  synthesizeSegments,
  wavDurationSeconds,
  concatWavs,
} from "./lib/voicevox.mjs";

// 一時的な用途: 声のプールの候補それぞれで、実際の台本を読み上げたサンプル音声を作り、
// ユーザーに聴いて選んでもらう(2026-09-21)。本番のTTSと同じ関数(速度の自動調整込み)を使うので、
// 速さもサンプルで確認できる。各サンプルの冒頭で声の名前を名乗る。
const READINGS = { WhiteCUL: "ホワイトカル" };

const outDir = path.join(process.cwd(), "samples-out");
fs.mkdirSync(outDir, { recursive: true });

const script = JSON.parse(fs.readFileSync(path.join(process.cwd(), "content", "latest-script.json"), "utf-8"));
const segments = script.segments.map((s) => ({ id: s.id, text: s.narration }));
console.log(`台本: ${script.title} (${segments.reduce((n, s) => n + s.text.length, 0)}字)`);

const speakers = await fetchSpeakers();
const summary = [`目標: ${TARGET_CPS}字/秒 / 台本: ${script.title}`];
const all = [];

for (const [i, voice] of VOICE_POOL.entries()) {
  const styleId = resolveStyleId(speakers, voice.name);
  const r = await synthesizeSegments(segments, styleId);
  const intro = await synthesizeWav(`私は、${READINGS[voice.name] ?? voice.name}です。`, styleId, r.speedScale);
  const sample = concatWavs([intro, ...r.wavs.map((w) => w.buf)], 0.35);
  const file = `${String(i + 1).padStart(2, "0")}_${voice.name.replace(/[\\/:*?"<>|]/g, "_")}.wav`;
  fs.writeFileSync(path.join(outDir, file), sample);
  all.push(sample);
  const line = `${file} styleId=${styleId} 素の速さ=${r.baseCps.toFixed(2)}字/秒 speedScale=${r.speedScale.toFixed(3)} 調整後=${r.cps.toFixed(2)}字/秒 音声${r.seconds.toFixed(1)}秒 合成${r.passes}回`;
  console.log(line);
  summary.push(line);
}

fs.writeFileSync(path.join(outDir, "00_全員まとめ.wav"), concatWavs(all, 1.5));
fs.writeFileSync(path.join(outDir, "summary.txt"), summary.join("\n"));
console.log("OK");
