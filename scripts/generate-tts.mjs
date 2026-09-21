import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TARGET_CPS,
  fetchSpeakers,
  pickRandomVoice,
  resolveStyleId,
  synthesizeSegments,
} from "./lib/voicevox.mjs";

// ナレーション音声をVOICEVOXで生成する(2026-09-21にGoogle Cloud TTSから切り替え)。
// - 動画ごとに声のプール(scripts/lib/voicevox.mjsのVOICE_POOL)からランダムに1人選ぶ
// - 読む速さは切り替え前と同じ約6.2字/秒になるようspeedScaleを自動調整する
// - 使った声のクレジット(VOICEVOX:キャラ名)を content/current-voice-credit.json に書き出す
//   (VOICEVOXの利用規約で必須。write-description.mjsが概要欄に差し込む)
// VOICEVOXエンジンが起動している必要がある(ワークフローでは.github/actions/start-voicevox)。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const latestScript = JSON.parse(
  fs.readFileSync(path.join(root, "content", "latest-script.json"), "utf-8")
);
const segments = latestScript.segments.map((s) => ({ id: s.id, text: s.narration }));

const outDir = path.join(root, "public", "audio");
fs.mkdirSync(outDir, { recursive: true });

const voice = pickRandomVoice();
const speakers = await fetchSpeakers();
const styleId = resolveStyleId(speakers, voice.name);
console.log(`声: ${voice.name} (styleId=${styleId})`);

const result = await synthesizeSegments(segments, styleId, TARGET_CPS);

for (const { id, buf } of result.wavs) {
  const outPath = path.join(outDir, `${id}.wav`);
  fs.writeFileSync(outPath, buf);
  console.log(`OK: ${outPath}`);
}

fs.writeFileSync(
  path.join(root, "content", "current-voice-credit.json"),
  JSON.stringify(
    {
      character: voice.name,
      creditLine: `VOICEVOX:${voice.name}`,
      speedScale: Number(result.speedScale.toFixed(3)),
      charsPerSecond: Number(result.cps.toFixed(2)),
    },
    null,
    2
  )
);

console.log(
  `素の速さ ${result.baseCps.toFixed(2)}字/秒 → speedScale ${result.speedScale.toFixed(3)} → ` +
    `${result.cps.toFixed(2)}字/秒 (目標${TARGET_CPS}、${result.seconds.toFixed(1)}秒、合成${result.passes}回)`
);
console.log("すべてのナレーション音声を生成しました。");
