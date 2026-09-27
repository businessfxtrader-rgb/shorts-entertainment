// 動画ごとに切り替える見た目のテーマ(2026-09-28追加)。
// 全動画が同じ見た目だと「同じ型で量産された動画」に見えやすいため(収益化審査対策)、
// generate-script.mjsがvisualThemeとして0〜3をランダムに選び、write-segments.mjsがsegments.tsに書き出す。
export type Theme = {
  bandBg: string; // 画面上部の見出しの帯の色
  bandText: string; // 見出しの文字色
  bandAccent: string; // 見出し2行目の文字色
  captionBg: string; // 中央テロップの背景
  badgeColor: string; // 「第3位」などのバッジの文字色
};

export const THEMES: Theme[] = [
  { bandBg: "#FFD400", bandText: "#111111", bandAccent: "#C8102E", captionBg: "rgba(0,0,0,0.55)", badgeColor: "#FFD400" },
  { bandBg: "#FFFFFF", bandText: "#111111", bandAccent: "#0057B8", captionBg: "rgba(10,25,60,0.62)", badgeColor: "#7FD1FF" },
  { bandBg: "#C8102E", bandText: "#FFFFFF", bandAccent: "#FFE066", captionBg: "rgba(40,0,0,0.58)", badgeColor: "#FFE066" },
  { bandBg: "#111111", bandText: "#FFFFFF", bandAccent: "#39FF88", captionBg: "rgba(0,0,0,0.6)", badgeColor: "#39FF88" },
];

export const themeFor = (index: number): Theme => THEMES[((index % THEMES.length) + THEMES.length) % THEMES.length];
