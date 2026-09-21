// VOICEVOXエンジン(Docker、既定 http://localhost:50021)でナレーションを合成する共通処理。
// 2026-09-21: Google Cloud TTS(Chirp3-HD Orus)から切り替え。

export const VOICEVOX_URL = process.env.VOICEVOX_URL ?? "http://localhost:50021";

// 目標の読み上げ速度(総文字数÷音声の合計秒数)。切り替え前のGoogle TTS(Orus、speakingRate 1.15)を
// 8本の実台本で実測した平均6.19字/秒(5.97〜6.53)に合わせる。台本の文字数(320〜345字)から
// 動画尺(54〜59秒)を見積もっているため、声が変わっても字/秒を揃える必要がある。
export const TARGET_CPS = 6.2;

// 声のプール(動画ごとにランダムに1人選ぶ)。nameはエンジンの話者名そのもの。
// credit: 概要欄に入れるクレジット(VOICEVOXの利用規約で必須)。省略時は「VOICEVOX:<name>」。
//   規約が表記を指定しているキャラ(もち子さん・Voidoll)だけ、その指定どおりの文字列を入れる。
// style: スタイル名を明示する場合だけ指定(省略時は「ノーマル」または「ふつう」を探す)。
// 各キャラの公式利用規約の原文を読んで決めた(根拠と、入れていない声の理由はSPEC.mdの
// 「ナレーション(VOICEVOX)」節)。チャンネル運営者(個人)の判断と責任で、ずんだもん系の声も含めている。
export const VOICE_POOL = [
  // VirVox Project規約・WhiteCUL・個別規約で、商用可かつ条件なしと確認できた声
  { name: "玄野武宏" },
  { name: "白上虎太郎" },
  { name: "雀松朱司" },
  { name: "麒ヶ島宗麟" },
  { name: "黒沢冴白" },
  { name: "WhiteCUL" },
  { name: "雨晴はう" },
  { name: "冥鳴ひまり" },
  { name: "栗田まろん" },
  { name: "春日部つむぎ" },
  // 「企業が携わる形は事前確認/法人は不可」の条件付きの声(運営は個人のため条件を満たす)。
  // 青山龍星は規約上「企業・個人事業主」は事前申請が必要(個人事業主として運営する場合は要申請)
  { name: "青山龍星" },
  { name: "もち子さん", credit: "VOICEVOX:もち子(cv 明日葉よもぎ)" },
  { name: "後鬼", style: "人間ver." },
  { name: "ナースロボ＿タイプＴ" },
  { name: "猫使アル" },
  { name: "猫使ビィ" },
  { name: "Voidoll", credit: "VOICEVOX:Voidoll(CV:丹下桜)" },
  // zunko.jp規約の系列。禁止事項に「情報商材での利用・宣伝目的」「虚偽・誤解を招く内容」
  // 「団体(国家を含む)の非難・批判または応援目的」があるが、運営者が目的に該当しないことを確認し責任を負う
  { name: "ずんだもん" },
  { name: "四国めたん" },
  { name: "九州そら" },
  { name: "中国うさぎ" },
  { name: "中部つるぎ" },
  { name: "あんこもん" },
  { name: "東北ずん子" },
  { name: "東北きりたん" },
  { name: "東北イタコ" },
];

export function creditLineFor(voice) {
  return voice.credit ?? `VOICEVOX:${voice.name}`;
}

const STYLE_NAMES = ["ノーマル", "ふつう"];
const MIN_SPEED = 0.9;
const MAX_SPEED = 1.6;
const TOLERANCE = 0.02; // 目標の±2%以内なら調整終了
const MAX_PASSES = 4;

export async function fetchSpeakers() {
  const res = await fetch(`${VOICEVOX_URL}/speakers`);
  if (!res.ok) throw new Error(`/speakers が失敗しました (${res.status})`);
  return res.json();
}

// キャラから、スタイルが「ノーマル」または「ふつう」(またはstyle指定)のidを引く
export function resolveStyleId(speakers, voice) {
  const speaker = speakers.find((s) => s.name === voice.name);
  if (!speaker) throw new Error(`話者が見つかりません: ${voice.name}`);
  const wanted = voice.style ? [voice.style] : STYLE_NAMES;
  const style = speaker.styles.find((st) => wanted.includes(st.name));
  if (!style) throw new Error(`${voice.name} に ${wanted.join("/")} のスタイルがありません`);
  return style.id;
}

export function pickRandomVoice() {
  return VOICE_POOL[Math.floor(Math.random() * VOICE_POOL.length)];
}

export async function synthesizeWav(text, styleId, speedScale) {
  const qRes = await fetch(
    `${VOICEVOX_URL}/audio_query?${new URLSearchParams({ text, speaker: String(styleId) })}`,
    { method: "POST" }
  );
  if (!qRes.ok) throw new Error(`/audio_query が失敗しました (${qRes.status}): ${await qRes.text()}`);
  const query = await qRes.json();
  query.speedScale = speedScale;
  const sRes = await fetch(`${VOICEVOX_URL}/synthesis?${new URLSearchParams({ speaker: String(styleId) })}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!sRes.ok) throw new Error(`/synthesis が失敗しました (${sRes.status}): ${await sRes.text()}`);
  return Buffer.from(await sRes.arrayBuffer());
}

function findChunk(buf, id) {
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (chunkId === id) return { start: pos + 8, size };
    pos += 8 + size + (size % 2);
  }
  return null;
}

// WAVヘッダーから長さ(秒)を計算する
export function wavDurationSeconds(buf) {
  const fmt = findChunk(buf, "fmt ");
  const data = findChunk(buf, "data");
  if (!fmt || !data) throw new Error("WAVのヘッダーを解析できません");
  const byteRate = buf.readUInt32LE(fmt.start + 8);
  const dataSize = data.size > buf.length - data.start ? buf.length - data.start : data.size;
  return dataSize / byteRate;
}

// 同一フォーマット(VOICEVOX出力はすべて24kHz/16bit/モノラル)のWAVを、間に無音を挟んで連結する
export function concatWavs(bufs, gapSec = 0) {
  const fmt = findChunk(bufs[0], "fmt ");
  const byteRate = bufs[0].readUInt32LE(fmt.start + 8);
  const blockAlign = bufs[0].readUInt16LE(fmt.start + 12);
  const pcm = [];
  bufs.forEach((b, i) => {
    const d = findChunk(b, "data");
    const size = d.size > b.length - d.start ? b.length - d.start : d.size;
    pcm.push(b.subarray(d.start, d.start + size));
    if (gapSec > 0 && i < bufs.length - 1) {
      const gapBytes = Math.round(gapSec * byteRate);
      pcm.push(Buffer.alloc(gapBytes - (gapBytes % blockAlign)));
    }
  });
  const data = Buffer.concat(pcm);
  const header = Buffer.from(bufs[0].subarray(0, fmt.start + fmt.size));
  const out = Buffer.concat([header, Buffer.from("data"), Buffer.alloc(4), data]);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(out.length - 8, 4);
  out.writeUInt32LE(data.length, header.length + 4);
  return out;
}

function clamp(v) {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, v));
}

// 全セグメントを合成し、総文字数÷音声の合計秒数が目標の字/秒になるようspeedScaleを自動調整する。
// 1回目: speedScale=1.0で合成して素の速さを測る → speedScale = 合計秒数 × 目標字/秒 ÷ 総文字数。
// pre/postPhonemeLengthなど速度に比例しない無音が残るため、合成後の実測が目標から2%以上ずれていたら
// 実測から補正して再合成する(最大MAX_PASSES回)。
export async function synthesizeSegments(segments, styleId, targetCps = TARGET_CPS) {
  const chars = segments.reduce((sum, s) => sum + s.text.length, 0);

  const run = async (speed) => {
    const wavs = [];
    let seconds = 0;
    for (const seg of segments) {
      const buf = await synthesizeWav(seg.text, styleId, speed);
      wavs.push({ id: seg.id, buf });
      seconds += wavDurationSeconds(buf);
    }
    return { wavs, seconds };
  };

  let speed = 1.0;
  let result = await run(speed);
  const baseSeconds = result.seconds;
  let passes = 1;

  speed = clamp((baseSeconds * targetCps) / chars);
  while (passes < MAX_PASSES) {
    result = await run(speed);
    passes++;
    const cps = chars / result.seconds;
    if (Math.abs(cps - targetCps) / targetCps <= TOLERANCE) break;
    const next = clamp((speed * targetCps) / cps);
    if (next === speed) break; // クランプ上限/下限に張り付いた
    speed = next;
  }

  return {
    wavs: result.wavs,
    speedScale: speed,
    seconds: result.seconds,
    chars,
    cps: chars / result.seconds,
    baseCps: chars / baseSeconds,
    passes,
  };
}
