import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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
if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error("CLAUDE_CODE_OAUTH_TOKEN が .env に見つかりません");
  process.exit(1);
}

const usedTopicsPath = path.join(root, "content", "used-topics.json");
const misreadingDictPath = path.join(root, "content", "misreading-dict.json");
const outputPath = path.join(root, "content", "latest-script.json");

const usedTopics = JSON.parse(fs.readFileSync(usedTopicsPath, "utf-8"));
const misreadingDict = JSON.parse(fs.readFileSync(misreadingDictPath, "utf-8"));

const usedTitlesList = usedTopics.map((t) => `- ${t.title}(${t.topics.join("/")})`).join("\n");
const misreadingList = Object.entries(misreadingDict)
  .map(([kanji, kana]) => `${kanji}→${kana}`)
  .join("、");

const categoriesPath = path.join(root, "scripts", "categories.json");
const CATEGORIES = JSON.parse(fs.readFileSync(categoriesPath, "utf-8"));

const categoryStatsPath = path.join(root, "content", "category-stats.json");
const categoryStats = fs.existsSync(categoryStatsPath)
  ? JSON.parse(fs.readFileSync(categoryStatsPath, "utf-8"))
  : {};

const retentionSummaryPath = path.join(root, "content", "retention-summary.json");
const retentionSummary = fs.existsSync(retentionSummaryPath)
  ? JSON.parse(fs.readFileSync(retentionSummaryPath, "utf-8"))
  : { overallRetentionPercentage: null };
const overallRetention = retentionSummary.overallRetentionPercentage;

// 週次のトレンド調査結果(scripts/research-trends.mjs)。存在すればランダムに1パターンだけ
// プロンプトに混ぜる(毎回同じパターンに偏らないように)。構造パターン(patterns)・
// テーマ・内容の傾向(themes)・検索キーワード選定の傾向(keywords)の3種類を持つ
const trendInsightsPath = path.join(root, "content", "trend-insights.json");
const trendInsights = fs.existsSync(trendInsightsPath)
  ? JSON.parse(fs.readFileSync(trendInsightsPath, "utf-8"))
  : { patterns: [], themes: [], keywords: [] };
const trendPatterns = trendInsights.patterns ?? [];
const trendThemes = trendInsights.themes ?? [];
const trendKeywords = trendInsights.keywords ?? [];
const trendPattern =
  trendPatterns.length > 0 ? trendPatterns[Math.floor(Math.random() * trendPatterns.length)] : null;
const trendKeyword =
  trendKeywords.length > 0 ? trendKeywords[Math.floor(Math.random() * trendKeywords.length)] : null;

// ローテーション対策(2026-08-08追加): 直近(全ジャンル数-1)本以内に使われたジャンルは
// 今回の抽選から除外する。こうすることで、一度伸びたジャンルの重みがどれだけ大きくても
// 「必ず一巡してから次の巡目に入る」ことが保証される。実績が無い/一度も使われていない
// ジャンルは当然この除外対象に入らないため、自動的に優先的な候補になる(コールドスタート対策も兼ねる)。
// 以前は重み(下記)だけでジャンルを決めていたが、一度ヒットしたジャンルの重みが数百に達する
// 一方で未使用ジャンルは基礎重みのままのため、実質的に一部ジャンルへ生成が偏る問題があった。
const ROTATION_WINDOW = Math.max(0, CATEGORIES.length - 1);
const recentlyUsedGenres = new Set(
  usedTopics.slice(-ROTATION_WINDOW).map((t) => t.category)
);
const rotationEligible = CATEGORIES.filter((c) => !recentlyUsedGenres.has(c.name));
const candidateCategories = rotationEligible.length > 0 ? rotationEligible : CATEGORIES;

// 過去の平均再生数が高いジャンルほど選ばれやすくする(候補は上記でローテーション制御済みのため、
// ここでの重み付けは「どの巡目内候補を優先するか」の役割に限定される)。
// さらに、視聴維持率がチャンネル平均より高いジャンルは重みを増やし、低いジャンルは減らす
// (再生数だけだと初期のアルゴリズム的な偏りに引っ張られやすいが、視聴維持率はコンテンツの
// 質そのものを示すより安定した指標のため)。倍率は0.5〜2.0倍に制限してノイズの影響を抑える。
const BASELINE_WEIGHT = 30;
const weights = candidateCategories.map((c) => {
  const stat = categoryStats[c.name];
  const avgViews = stat?.avgViews ?? 0;
  const retention = stat?.avgRetentionPercentage;
  const retentionMultiplier =
    retention != null && overallRetention
      ? Math.min(2, Math.max(0.5, retention / overallRetention))
      : 1;
  return avgViews * retentionMultiplier + BASELINE_WEIGHT;
});
const totalWeight = weights.reduce((a, b) => a + b, 0);
let pick = Math.random() * totalWeight;
let categoryIndex = 0;
for (let i = 0; i < weights.length; i++) {
  pick -= weights[i];
  if (pick <= 0) {
    categoryIndex = i;
    break;
  }
}
const category = candidateCategories[categoryIndex];

// ジャンルとフォーマットは独立した軸として扱う(1ジャンルが複数フォーマットを持てる)。
// 同じジャンルでも毎回どのフォーマットで語るかをランダムに選ぶ
const chosenFormat = category.formats[Math.floor(Math.random() * category.formats.length)];

// 選ばれたジャンルに関連するテーマ傾向があれば優先し、無ければランダムに1件だけ採用する
const matchingThemes = trendThemes.filter((t) => t.relatedGenre === category.name);
const themePool = matchingThemes.length > 0 ? matchingThemes : trendThemes;
const trendTheme = themePool.length > 0 ? themePool[Math.floor(Math.random() * themePool.length)] : null;

const FORMAT_SPECS = {
  simulation: {
    formatInstructions: `- フォーマット: フック(極端な仮定を提示)→段階1→段階2→クライマックス、の5パート構成(シミュレーション仮説型)。badgeはすべてnullにする(順位表示はしない)
- 「もし〜だったら」「〜を1mmにしたら」のような、実在の科学的知見に基づく計算・比較を使った極端な思考実験にする。話が段階的にスケールアップしていく構成にする`,
    titleInstructions:
      "動画タイトル(30字以内、「もし〜だったら」「〜を1mmにしたら」のような極端な仮定が伝わる、事実に反しないキャッチーなもの)",
    topicsInstructions: "各段階の一言要約(3つ、話が進むにつれてスケールアップする)",
    segmentsExample: `  "segments": [
    { "id": "hook", "badge": null, "caption": ["画面表示1行目", "画面表示2行目"], "narration": "極端な仮定を提示する読み上げ文", "pexelsQuery": "背景動画検索用の英語キーワード" },
    { "id": "rank3", "badge": null, "caption": ["...", "..."], "narration": "段階1の説明", "pexelsQuery": "..." },
    { "id": "rank2", "badge": null, "caption": ["...", "..."], "narration": "段階2の説明(スケールアップ)", "pexelsQuery": "..." },
    { "id": "rank1", "badge": null, "caption": ["...", "..."], "narration": "クライマックス(最も極端な結末)", "pexelsQuery": "..." },
    { "id": "outro", "badge": null, "caption": ["...", "..."], "narration": "チャンネル登録を促す文", "pexelsQuery": "..." }
  ]`,
  },
  qa: {
    formatInstructions: `- フォーマット: フック(問いかけ)→振り1→振り2→結論(答え)→締め、の5パート構成(問いかけ→結論型)。badgeはすべてnullにする(順位表示はしない)
- フックは「〜って知っていますか?」「なぜ〜なのか知っていますか?」のような、視聴者に直接問いかける形にする
- rank3・rank2では、答えに関連する背景・伏線・意外な事実を小出しにしながら期待を高める(答えをまだ明かさない)
- rank1で、意外性のある結論・理由を明快に明かす(ここが動画の核心)`,
    titleInstructions:
      "動画タイトル(30字以内、「〜な理由」「〜って知ってる?」のように、答えを知りたくなる問いかけ・断定調のもの)",
    topicsInstructions: "振り1/振り2/結論の一言要約",
    segmentsExample: `  "segments": [
    { "id": "hook", "badge": null, "caption": ["画面表示1行目", "画面表示2行目"], "narration": "視聴者への問いかけ", "pexelsQuery": "背景動画検索用の英語キーワード" },
    { "id": "rank3", "badge": null, "caption": ["...", "..."], "narration": "背景・伏線1(答えはまだ明かさない)", "pexelsQuery": "..." },
    { "id": "rank2", "badge": null, "caption": ["...", "..."], "narration": "背景・伏線2(期待を高める)", "pexelsQuery": "..." },
    { "id": "rank1", "badge": null, "caption": ["...", "..."], "narration": "意外性のある結論・理由を明かす", "pexelsQuery": "..." },
    { "id": "outro", "badge": null, "caption": ["...", "..."], "narration": "チャンネル登録を促す文", "pexelsQuery": "..." }
  ]`,
  },
  ranking: {
    formatInstructions: `- フォーマット: フック→第3位→第2位→第1位→締め、の5パート構成(ランキング型)`,
    titleInstructions:
      "動画タイトル(30字以内、ベスト3形式が伝わる魅力的なもの。可能であれば『史上最高の』『歴代最強の』のような、このジャンルで繰り返し使える定番の枕詞を先頭に置くと、シリーズものとして視聴者に認識されやすい)",
    topicsInstructions: "3位/2位/1位の一言要約",
    segmentsExample: `  "segments": [
    { "id": "hook", "badge": null, "caption": ["画面表示1行目", "画面表示2行目"], "narration": "読み上げ文", "pexelsQuery": "背景動画検索用の英語キーワード" },
    { "id": "rank3", "badge": "第3位", "caption": ["...", "..."], "narration": "...", "pexelsQuery": "..." },
    { "id": "rank2", "badge": "第2位", "caption": ["...", "..."], "narration": "...", "pexelsQuery": "..." },
    { "id": "rank1", "badge": "第1位", "caption": ["...", "..."], "narration": "...", "pexelsQuery": "..." },
    { "id": "outro", "badge": null, "caption": ["...", "..."], "narration": "チャンネル登録を促す文", "pexelsQuery": "..." }
  ]`,
  },
  reversal: {
    formatInstructions: `- フォーマット: フック(見下す・疑うセリフの引用+人物紹介)→変化1→変化2→結末(価値観が覆る)→締め、の5パート構成(掌返しストーリー型)。badgeはすべてnullにする(順位表示はしない)
- フックは「〇〇なんて〜でしょ」のような懐疑的・見下すセリフの引用から始め、直後にそれを言う人物像(職業・立場などの一般的な属性。実在しない架空の一般人)を一言で示す。見下す・疑う対象は今回のジャンルの内容に沿ったものにする
- 変化1・変化2では、その人物が実際にその対象を体験し、少しずつ認識が変わっていく過程を段階的に描く(結論を急がない)
- 結末(rank1)で、価値観が完全に覆る瞬間と、それに伴う強い感情(驚き・感動)を描く`,
    titleInstructions:
      "動画タイトル(50〜70字程度。冒頭を「〇〇なんて〜」のような見下す・疑うセリフの引用『」』で始め→それを言う人物像(実在しない一般的な設定)→体験した対象→最後に強い結果を示す言葉(例:価値観が崩壊、涙腺崩壊、異常事態に発展)で締める、一連の物語が伝わる長めのタイトルにする。実在の個人名・SNSアカウント名は使わない)",
    topicsInstructions: "見下す発言の内容/体験した対象/価値観が変わった結末、の一言要約(3つ)",
    segmentsExample: `  "segments": [
    { "id": "hook", "badge": null, "caption": ["画面表示1行目", "画面表示2行目"], "narration": "見下す・疑うセリフの引用と人物紹介", "pexelsQuery": "背景動画検索用の英語キーワード" },
    { "id": "rank3", "badge": null, "caption": ["...", "..."], "narration": "変化1(体験し始める)", "pexelsQuery": "..." },
    { "id": "rank2", "badge": null, "caption": ["...", "..."], "narration": "変化2(認識が変わり始める)", "pexelsQuery": "..." },
    { "id": "rank1", "badge": null, "caption": ["...", "..."], "narration": "結末(価値観が覆る瞬間と強い感情)", "pexelsQuery": "..." },
    { "id": "outro", "badge": null, "caption": ["...", "..."], "narration": "チャンネル登録を促す文", "pexelsQuery": "..." }
  ]`,
  },
  choice: {
    formatInstructions: `- フォーマット: フック(二択の提示)→伏線1(選択肢Aのヒント)→伏線2(選択肢Bのヒント)→緊張の高まり(締め切りが迫る)→締め、の5パート構成(二択選択ゲーム型)。badgeには各セグメントで画面に出す短い数字・統計文言を入れる(例:「死亡率50%」「生存率99%」のような、見た目の印象と数字がねじれている組み合わせ)。rank1で「答え合わせ」はしないこと(正解を明かさずに終わるのがこの形式の核心)
- フックは「もし〜な状況で、2つの扉(または2つの選択肢)のどちらかを選ぶとしたら」という設定を提示し、両方の選択肢を見せる。それぞれに一見矛盾する数字・統計を添える(badgeに入れる)
- 伏線1・伏線2では、それぞれの選択肢に隠れた手がかり・不穏な気配を段階的に描写する(どちらが正解かは明言しない)
- 締め切り前の緊張感(残り時間が少ない、といった煽り)を高めながら終わる
- 冒頭のフック場面に、後半の伏線につながる要素をさりげなく仕込んでおく(見返すと気づける工夫。narrationやcaptionで直接説明しなくてよい、ト書き的な演出指示としてpexelsQueryやcaptionの選び方に反映させる程度でよい)`,
    titleInstructions:
      "動画タイトル(30字以内。『〜な扉を選んでください Pick a door!』のように、判断基準を一言(見た目に騙されにくい/直感で選ぶ/最後まで耐えられそう、等)で示してから、シリーズ物と分かる固定の呼びかけ文『扉を選んでください Pick a door!』で締める型を毎回使うこと)",
    topicsInstructions: "二択の設定/選択肢Aの伏線/選択肢Bの伏線、の一言要約(3つ)",
    segmentsExample: `  "segments": [
    { "id": "hook", "badge": "死亡率50%", "caption": ["画面表示1行目", "画面表示2行目"], "narration": "二択の設定を提示する読み上げ文", "pexelsQuery": "背景動画検索用の英語キーワード" },
    { "id": "rank3", "badge": "生存率99%", "caption": ["...", "..."], "narration": "選択肢Aのヒント・不穏な気配", "pexelsQuery": "..." },
    { "id": "rank2", "badge": "残り10秒", "caption": ["...", "..."], "narration": "選択肢Bのヒント・不穏な気配", "pexelsQuery": "..." },
    { "id": "rank1", "badge": "残り3秒", "caption": ["...", "..."], "narration": "締め切りが迫る緊張感(正解は明かさない)", "pexelsQuery": "..." },
    { "id": "outro", "badge": null, "caption": ["...", "..."], "narration": "選んだ扉をコメントで教えてほしいと伝え、チャンネル登録も促す文", "pexelsQuery": "..." }
  ]`,
  },
};

const spec = FORMAT_SPECS[chosenFormat] ?? FORMAT_SPECS.ranking;
const { formatInstructions, titleInstructions, topicsInstructions, segmentsExample } = spec;

// YouTube Analyticsの実測データ(視聴維持率)を踏まえた指示。維持率が低いほど、
// フックと情報密度をより強く指示する(track-performance.mjsが週次で更新する)
const retentionInstructions =
  overallRetention != null && overallRetention < 40
    ? `\n# 視聴維持率について(重要・実データに基づく指示)
直近の動画の平均視聴維持率は${overallRetention}%と低めです。最後まで見てもらえていません。今回は特に以下を徹底すること:
- フックの最初の1文だけで「え、なに」と思わせる、具体的な数字・意外な事実・断定的な一言を置く。「〜について紹介します」のような前置きは厳禁
- 各文の間延びを避け、1文ごとに新しい情報を必ず出す(既出情報の言い換え・繰り返しは禁止)
- rank3→rank2→rank1(またはstep1→step2→climax)にかけて、意外性・インパクトが尻すぼみにならず右肩上がりになるようにする`
    : "";

const prompt = `あなたはYouTubeショート動画の台本作家です。エンタメ・雑学系チャンネル用に、新しい1本分の台本をJSON形式だけで出力してください。説明文やコードフェンス(\`\`\`)は一切つけず、JSONのみを出力してください。

# チャンネル設定
- ナレーター: 20代女性の落ち着いたトーン
${formatInstructions}
- 締めのセリフは必ず「チャンネル登録」を促す言葉を含める(「フォロー」ではなく「チャンネル登録」)

# 過去に使ったネタ(絶対に重複させないこと)
${usedTitlesList || "(まだありません)"}

# 今回のジャンル
${category.name}: ${category.brief}

# ネタの条件
- 上記ジャンルの範囲内で作ること。悩み相談・個別相談への誘導・アフィリエイト誘導は絶対に含めない
- ${
  category.fiction
    ? "このジャンルはエンタメ・フィクション作品として、創作の物語・設定で構成してよい(実話であるかのように装わないこと。ただし以下の絶対禁止事項は変わらず適用される)"
    : "内容は、事実として一般的に広く知られている正確な内容、または実在の科学的知見に基づく計算にする(不確かな内容や誇張、フィクションは避ける)"
}
- 実在の人物(有名人・YouTuber等)の実名・私生活を扱う内容、著作権のあるキャラクター・作品への言及は、フィクションであっても絶対に含めない
- 情報密度を高くすること。前置き・相槌・当たり障りのない一般論を削り、具体的な数字・固有名詞・比較を積極的に使って、短い時間により多くの情報を詰め込む
- 各narrationは1〜2文で簡潔にしつつも、内容が薄くならないよう具体性を重視する(「〜と言われています」のような曖昧な言い回しより、断定的で情報量のある言い方を優先する)
- 動画の尺は54〜59秒が目標。narration(読み上げ文)の合計文字数が320〜345字程度になるようにすること(目安: hook 50〜55字、rank3/rank2/rank1は各65〜85字、outroは50〜55字)。文字数が少なすぎても多すぎても尺がずれるので、この範囲を必ず守ること
- (視聴維持率対策・常時適用)フックの最初の1文だけで惹きつけること。「〜について紹介します」のような前置きは厳禁で、具体的な数字・意外な事実・断定的な一言から入る。前半で間延びさせず、後半に行くほど情報の意外性・インパクトが強くなる(尻すぼみにならない)構成にする
- (視聴維持率対策・常時適用)タイトルだけでなく、可能な場面ではnarrationの構成自体も「核心を先に明かさず、少し焦らしてから明かす」形にする(例:「〜な理由」「実は〜」のように、結論を保留してから見せる)。ランキング形式であっても、各順位の紹介文の冒頭で結論を言い切らず、一言タメを作ってから核心に入るとよい
${retentionInstructions}
${
  trendPattern
    ? `- (今週のトレンド調査より)可能であれば次のパターンを今回の台本に取り入れてみること: 『${trendPattern.pattern}』── ${trendPattern.description}(参考例: ${trendPattern.example})。無理に当てはめて不自然にならない場合のみ採用すること`
    : ""
}
${
  trendTheme
    ? `- (今週のトレンド調査より)可能であれば次のテーマ・切り口を今回のトピック選定に取り入れてみること: 『${trendTheme.theme}』── ${trendTheme.description}。このジャンル(${category.name})の内容として不自然にならない場合のみ採用すること`
    : ""
}

# テロップ(caption)のルール(重要)
- captionは画面に大きく表示される文字情報であり、音声を聞かなくても内容が伝わる密度にすること。narrationの単なる短縮ではなく、そのシーンの核心となる数字・固有名詞を必ず含めること(画面内テキストはYouTube側でタイトルより強いトピック信号として解析されるとされ、フィード配信の精度に直結する)
- 各captionは2行、1行あたり10〜16字程度を目安にする(短すぎる相槌的な文言は避ける。例:「衝撃の事実」のような中身のない見出しではなく、「胃の粘膜は3日で交換」のように具体的にする)

# 重複コンテンツ判定を避けるための工夫(重要)
- フックの言い回し・構成の型は、過去のネタと違うパターンにすること(問いかけ型・数字型・逆張り型など毎回変える)
- ナレーションの語り口も、丁寧すぎる/フランクめ等、毎回少し変化をつける

# 誤読防止ルール
- narration(読み上げ用テキスト)の中に、次の漢字が含まれる場合は必ずひらがなに置き換えること: ${misreadingList}
- telop(画面表示用テキスト)は通常の漢字表記のままでよい

# SEO対策のルール(重要・2026-08-07改訂)
- 検索キーワード最適化(tags・descriptionHookに具体的キーワードを含める)は引き続きSEOの中心的な柱として重視すること
- ただしtitleについては、具体的すぎる数字・結論を言い切ってしまう「ネタバレ」は避けること(例:「〜は3つ！」「〜382日」のような断定)。見る前に答えが分かってしまうと視聴完了率が下がりスキップされやすくなるため。数字を使う場合も、答えそのものではなく「信じがたい・矛盾している」という引っかかりとして使うこと(例:「まさかの理由」「想定外の結末」のように、核心は動画を見ないとわからない状態を保つ)。検索キーワードは主にtags・descriptionHook側で担い、titleは視聴完了率(クリック後に最後まで見てもらえるか)を優先する役割分担にすること
${
  trendKeyword
    ? `- (今週のトレンド調査より)可能であれば次の検索キーワード選定の傾向を参考にすること: 『${trendKeyword.pattern}』── ${trendKeyword.description}(参考例: ${trendKeyword.example})。tags・descriptionHookへの反映を優先し、titleでのネタバレには使わないこと`
    : ""
}
- descriptionHookは、検索結果・スマホ画面で最初に表示される部分なので、動画の内容とキーワードが一目で伝わる1文にすること(ただしtitle同様、核心の答えまでは書かない)
- outro(締め)のnarrationには、「チャンネル登録」の呼びかけに加えて、コメント欄でのやり取りを促す一言(例:「あなたはどう思う？コメントで教えて」)も自然な形で含めること(エンゲージメントはアルゴリズム評価に直結するため)
- title・caption・descriptionHookを含む全てのテキストで、感嘆符・疑問符は必ず全角(！／？)を使うこと。半角(!／?)は使わない
- seoNotesには、今回どう視聴維持率・エンゲージメントを意識したかを、日本語1〜2文で具体的に説明すること(例:「タイトルでは結論の数字を伏せて『まさかの理由』とだけ示し、動画内で明かす構成にした」)。抽象的な説明ではなく、実際の工夫を挙げて説明すること

# JSON出力上の重要な注意
- caption・narration・title等のテキスト内では、二重引用符(")を絶対に使わないこと。強調したい場合は「」(かぎ括弧)を使うこと。二重引用符を使うとJSONが壊れます。

# 出力JSON形式(このスキーマに厳密に従うこと)
{
  "title": "${titleInstructions}",
  "topics": ["${topicsInstructions}"],
  "descriptionHook": "概要欄の1行目。動画の内容を要約した1文",
  "tags": ["タグ1", "タグ2", "... 具体的なキーワードを8個程度"],
  "seoNotes": "今回のSEO対策の具体的な説明(1〜2文)",
${segmentsExample}
}`;

function runClaude(promptText) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude -p が失敗しました (code ${code}): ${stderr}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(promptText);
    child.stdin.end();
  });
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`JSONが見つかりませんでした。出力: ${text}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

console.log(`claude -p で新しい台本を生成中...(ジャンル: ${category.name}, フォーマット: ${chosenFormat})`);
const raw = await runClaude(prompt);
const script = extractJson(raw);
script.category = category.name;
script.format = chosenFormat;
script.displayGenre = category.displayGenre ?? category.name;

const requiredIds = ["hook", "rank3", "rank2", "rank1", "outro"];
const gotIds = script.segments.map((s) => s.id);
for (const id of requiredIds) {
  if (!gotIds.includes(id)) {
    throw new Error(`生成結果に "${id}" セグメントがありません`);
  }
}

fs.writeFileSync(outputPath, JSON.stringify(script, null, 2));
console.log(`OK: ${outputPath} に保存しました`);
console.log(`タイトル: ${script.title}`);
