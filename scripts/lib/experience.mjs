// 体験型(見る人が自分で試す)動画の課題を決める(2026-10-18追加、ジャンル「錯覚」)。
// 課題の映像は src/experience/ がプログラムで描く。正解はここで決めて台本作家(Claude)に「事実」として渡すので、
// 映像とナレーションが食い違わない。写真・動画素材は使わない(毎回オリジナル、権利の心配なし)。
// 点滅・ちらつく模様は使わない(光過敏への配慮)。
//
// 構成(5セグメント): hook=課題を出す / rank3=見るポイント / rank2=考える時間(カウントダウンつき) /
// rank1=種明かし(映像が変化して正解が見える) / outro=コメントを促す。最後まで見たらそのまま冒頭にループする

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

// 似た字の組(左が多数派、右が1つだけ混ざる)。どれも一般的な字で、見分けにくいもの
const GLYPH_PAIRS = [
  ["未", "末"], ["鳥", "烏"], ["土", "士"], ["ぬ", "め"], ["輸", "輪"], ["貸", "貨"],
  ["待", "侍"], ["折", "析"], ["己", "巳"], ["入", "人"], ["問", "間"], ["ソ", "ン"],
  ["シ", "ツ"], ["わ", "ね"], ["崇", "祟"], ["徴", "微"],
];

const TYPES = {
  ebbinghaus: () => {
    const bigLeft = Math.random() < 0.5;
    return {
      type: "ebbinghaus",
      params: { bigSurroundOnLeft: bigLeft },
      facts: `画面には2つのオレンジ色の円がある。${bigLeft ? "左" : "右"}の円は大きな灰色の円に囲まれ、${bigLeft ? "右" : "左"}の円は小さな灰色の円に囲まれている。周りに囲まれ方の違いがあるため、${bigLeft ? "右" : "左"}の円の方が大きく見える。種明かしで周りの円が消え、2つのオレンジの円が並ぶと、実は**まったく同じ大きさ**だと分かる(エビングハウス錯視)`,
      question: "どちらのオレンジの円が大きいか",
    };
  },
  "muller-lyer": () => {
    const outOnTop = Math.random() < 0.5;
    return {
      type: "muller-lyer",
      params: { outwardOnTop: outOnTop },
      facts: `画面には上下に2本の横線がある。${outOnTop ? "上" : "下"}の線は両端に外向きの矢羽根、${outOnTop ? "下" : "上"}の線は内向きの矢羽根が付いている。外向きの方が長く見える。種明かしで矢羽根が消えて縦の補助線が出ると、2本は**まったく同じ長さ**だと分かる(ミュラー・リヤー錯視)`,
      question: "上と下、どちらの線が長いか",
    };
  },
  "cafe-wall": () => ({
    type: "cafe-wall",
    params: {},
    facts: "画面には白黒のタイルが段ごとに半分ずつずれて並び、間に灰色の細い線がある。横の灰色の線が交互に傾いて見える。種明かしでタイルが灰色に変わると、横の線は**すべて完全に平行でまっすぐ**だと分かる(カフェウォール錯視)",
    question: "横の線は傾いているか、まっすぐか",
  }),
  contrast: () => {
    const darkLeft = Math.random() < 0.5;
    return {
      type: "contrast",
      params: { darkOnLeft: darkLeft },
      facts: `画面の背景は${darkLeft ? "左が暗く右が明るい" : "左が明るく右が暗い"}グラデーションで、その上に灰色の四角が左右に1つずつある。暗い背景の上の四角の方が明るく見える。種明かしで背景が一色になると、2つの四角は**まったく同じ色**だと分かる(明るさの対比錯視)`,
      question: "左右の四角、どちらの方が明るいか",
    };
  },
  "odd-glyph": () => {
    const [major, odd] = pick(GLYPH_PAIRS);
    const cols = 7;
    const rows = 10;
    const row = randInt(1, rows - 2);
    const col = randInt(0, cols - 1);
    return {
      type: "odd-glyph",
      params: { major, odd, cols, rows, row, col },
      facts: `画面には「${major}」という字が縦${rows}行・横${cols}列にびっしり並んでいて、その中に1つだけ「${odd}」が混ざっている。場所は上から${row + 1}行目、左から${col + 1}列目。種明かしでその1文字に丸が付く。ナレーションでは答えの字(「${odd}」)と場所を、種明かしの段落まで言わないこと`,
      question: `「${major}」の中に1つだけ混ざった違う字を探す`,
    };
  },
  "odd-color": () => {
    const hue = randInt(0, 359);
    const cols = 6;
    const rows = 8;
    return {
      type: "odd-color",
      params: { hue, cols, rows, row: randInt(1, rows - 2), col: randInt(0, cols - 1), delta: 7 },
      facts: `画面には同じ色のタイルが縦${rows}行・横${cols}列に並んでいて、1枚だけほんの少し明るい色のタイルがある。種明かしでそのタイルに丸が付く。ナレーションでは場所を種明かしの段落まで言わないこと`,
      question: "1枚だけ色が違うタイルを探す",
    };
  },
};

export const EXPERIENCE_TYPES = Object.keys(TYPES);

export function pickExperience() {
  return TYPES[pick(EXPERIENCE_TYPES)]();
}

// 体験型の台本の長さ(読み上げ約6.2字/秒。これに考える時間とループで、動画は約25〜30秒)
export const EXPERIENCE_CHARS = { min: 100, max: 150 };
// rank2(考える時間)の後に足す無音の秒数。画面にカウントダウンを出す
export const THINK_HOLD_SEC = 4;
