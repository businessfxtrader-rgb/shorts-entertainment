// claude -p の出力からJSON部分だけを取り出す。
// 単純な indexOf("{") 〜 lastIndexOf("}") では、出力に余分な前後の文章や
// 説明文中に別の {} [] が含まれていると誤った範囲を切り出してJSON.parseが
// 失敗することがあった(2026-08-10・08-31に実際に週次ワークフローで発生)。
// 最初の開き括弧から、文字列リテラル内を除いて対応する閉じ括弧までを
// 正しく追跡することで、この種の誤抽出を防ぐ。
export function extractJson(text) {
  let start = -1;
  let opener = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{" || text[i] === "[") {
      start = i;
      opener = text[i];
      break;
    }
  }
  if (start === -1) {
    throw new Error(`JSONが見つかりませんでした。出力: ${text}`);
  }

  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (err) {
          throw new Error(`JSONの解析に失敗しました: ${err.message}\n抽出範囲: ${candidate.slice(0, 500)}`);
        }
      }
    }
  }

  throw new Error(`JSONが閉じられていません。出力: ${text}`);
}
