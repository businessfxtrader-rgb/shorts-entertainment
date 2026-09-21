import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { wavDurationSeconds } from "./lib/voicevox.mjs";

// 一時的な検証用(feature/voicevox-ttsのクラウド検証ワークフローから呼ぶ)。
// ①音声が正常か ②速さが目標どおりか ③概要欄にクレジットが入るか、を実測で確認する。
const root = process.cwd();
const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${msg}`);
  if (!ok) failures.push(msg);
};

const script = JSON.parse(fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8"));
const credit = JSON.parse(fs.readFileSync(path.join(root, "content", "current-voice-credit.json"), "utf-8"));
console.log(`声: ${credit.character} / speedScale=${credit.speedScale}`);

// ② 速さ: WAVの実測(総文字数÷音声の合計秒数)
let chars = 0;
let audioSec = 0;
for (const seg of script.segments) {
  const wav = fs.readFileSync(path.join(root, "public", "audio", `${seg.id}.wav`));
  chars += seg.narration.length;
  audioSec += wavDurationSeconds(wav);
}
const cps = chars / audioSec;
console.log(`文字数=${chars} 音声合計=${audioSec.toFixed(2)}秒 → ${cps.toFixed(2)}字/秒`);
check(Math.abs(cps - 6.2) / 6.2 <= 0.03, `読む速さが目標6.2字/秒の±3%以内 (${cps.toFixed(2)})`);

// ① 音声: 最終mp4に音声トラックがあり、長さが「音声合計+セグメントごとの前後余白+末尾1秒」と一致する
const remotion = (args) => spawnSync("npx", ["remotion", ...args], { encoding: "utf-8", shell: true, cwd: root });
const dur = remotion(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", "out/final.mp4"]);
const videoSec = parseFloat(dur.stdout.trim().split(/\r?\n/).pop());
const expected = audioSec + (0.15 + 0.45) * script.segments.length + 1.0;
console.log(`最終動画=${videoSec.toFixed(2)}秒 / 期待値(音声+余白)=${expected.toFixed(2)}秒`);
check(Number.isFinite(videoSec) && Math.abs(videoSec - expected) <= 0.6, "動画の長さがWAVの長さから見積もった値と一致(Remotionが.wavの長さを正しく取れている)");

const aud = remotion(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name,channels", "-of", "default=nw=1", "out/final.mp4"]);
check(/codec_name=/.test(aud.stdout), `最終動画に音声トラックがある (${aud.stdout.trim().replace(/\r?\n/g, " ")})`);

const vol = remotion(["ffmpeg", "-i", "out/final.mp4", "-vn", "-af", "volumedetect", "-f", "null", "-"]);
const mean = /mean_volume: (-?[\d.]+) dB/.exec(vol.stderr + vol.stdout);
const max = /max_volume: (-?[\d.]+) dB/.exec(vol.stderr + vol.stdout);
console.log(`音量: mean=${mean?.[1]}dB max=${max?.[1]}dB`);
check(mean && parseFloat(mean[1]) > -50, "音声が無音ではない(平均音量 > -50dB)");

// ③ 概要欄にクレジットが入る
const desc = fs.readFileSync(path.join(root, "description.txt"), "utf-8");
check(desc.includes(credit.creditLine), `概要欄に「${credit.creditLine}」が入っている`);

if (failures.length > 0) {
  console.error(`\n失敗: ${failures.length}件`);
  process.exit(1);
}
console.log("\nすべての検証に合格しました");
