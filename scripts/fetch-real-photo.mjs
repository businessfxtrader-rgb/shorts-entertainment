import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// 実在の建物・ランドマーク等が題材のsegmentについて、Pexelsの抽象的なストック映像の代わりに
// Wikimedia Commons(フリー素材のみを扱うWikipedia姉妹サイト)から実物の写真を取得する。
// 2026-09-09追加。トリビアの沼(@torivia_numa)の分析から得た知見: 汎用ストック映像より
// 実写真の方が説得力・具体性が段違いという指摘を受けて実装。
// 見つからない場合はここでは何もせず、後続のauto-fetch-bg.mjsが通常通りPexelsで埋める
// (無理に対象物をでっち上げない・フリー素材で代替してよい、という前提のフォールバック設計)。

const scriptPath = path.join(root, "content", "latest-script.json");
const latestScript = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));

// CC0・パブリックドメイン・CC BY・CC BY-SA系のみ許可(表示義務のない/軽いものに限定)
const ALLOWED_LICENSE_PATTERN = /^(cc0|public domain|pd|cc[\s-]?by([\s-]?sa)?[\s-]?\d?\.?\d?)$/i;
const MIN_DIMENSION = 480; // アイコン・ロゴ等の低解像度画像を除外する目安

// Wikimedia側のUser-Agentポリシー(連絡先情報を含めることを推奨)に従い、かつ
// 短時間の連続アクセスによる429(レート制限)を避けるため軽くスリープを挟む
const USER_AGENT =
  "shorts-entertainment-bot/1.0 (https://github.com/businessfxtrader-rgb/shorts-entertainment; non-commercial YouTube Shorts background image fetch)";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    await sleep(1000 * (attempt + 1));
  }
  return fetch(url, options);
}

async function commonsSearch(query) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=${encodeURIComponent(
    query
  )}&srlimit=6&format=json`;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.query?.search ?? []).map((s) => s.title);
}

async function fetchImageInfo(title) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    title
  )}&prop=imageinfo&iiprop=url|extmetadata|size&format=json`;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const data = await res.json();
  const pages = data.query?.pages ?? {};
  const page = Object.values(pages)[0];
  return page?.imageinfo?.[0] ?? null;
}

function isUsable(info) {
  if (!info) return false;
  if (!/\.(jpe?g|png)(\?|$)/i.test(info.url ?? "")) return false; // svg・図解等は除外
  if ((info.width ?? 0) < MIN_DIMENSION || (info.height ?? 0) < MIN_DIMENSION) return false;
  const restrictions = info.extmetadata?.Restrictions?.value ?? "";
  if (restrictions.trim()) return false;
  const license = (info.extmetadata?.LicenseShortName?.value ?? "").trim();
  if (!ALLOWED_LICENSE_PATTERN.test(license)) return false;
  return true;
}

function stripHtml(s) {
  return (s ?? "").replace(/<[^>]+>/g, "").trim();
}

const outDir = path.join(root, "public", "bg");
fs.mkdirSync(outDir, { recursive: true });

// パイプラインは複数動画を連続生成するループなので、前回動画の実写真が
// public/bg/に残ったままだと、今回auto-fetch-bg.mjsが誤って「既に実写真あり」と
// 判定してPexelsフォールバックをスキップしてしまう。毎回まず古い実写真だけ削除しておく
// (Pexels動画の.mp4は auto-fetch-bg.mjs 側が毎回上書きするので対象外)
for (const seg of latestScript.segments) {
  for (const ext of ["jpg", "png"]) {
    const stalePath = path.join(outDir, `${seg.id}.${ext}`);
    if (fs.existsSync(stalePath)) fs.rmSync(stalePath);
  }
}

const credits = [];
let fetched = 0;

for (const seg of latestScript.segments) {
  const subject = seg.realPhotoSubject;
  if (!subject || typeof subject !== "string") continue;

  try {
    const titles = await commonsSearch(subject);
    let picked = null;
    for (const title of titles) {
      const info = await fetchImageInfo(title);
      if (isUsable(info)) {
        picked = { title, info };
        break;
      }
    }
    if (!picked) {
      console.log(`[${seg.id}] "${subject}" の実写真は見つかりませんでした(Pexelsにフォールバック)`);
      continue;
    }

    const imgRes = await fetchWithRetry(picked.info.url, { headers: { "User-Agent": USER_AGENT } });
    if (!imgRes.ok) {
      console.log(`[${seg.id}] 画像ダウンロード失敗 (${imgRes.status})`);
      continue;
    }
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const ext = /\.png(\?|$)/i.test(picked.info.url) ? "png" : "jpg";
    const outPath = path.join(outDir, `${seg.id}.${ext}`);
    fs.writeFileSync(outPath, buffer);

    const artist = stripHtml(picked.info.extmetadata?.Artist?.value) || "不明";
    const license = stripHtml(picked.info.extmetadata?.LicenseShortName?.value);
    credits.push({
      segmentId: seg.id,
      subject,
      file: `bg/${seg.id}.${ext}`,
      title: picked.title,
      artist,
      license,
      sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(picked.title)}`,
    });
    fetched++;
    console.log(`OK: ${seg.id} <- "${subject}" (${picked.title}, ${license}, ${(buffer.length / 1024).toFixed(0)}KB)`);
  } catch (err) {
    console.log(`[${seg.id}] "${subject}" の検索中にエラー: ${err.message}(Pexelsにフォールバック)`);
  }
  await sleep(500);
}

fs.writeFileSync(
  path.join(root, "content", "current-photo-credits.json"),
  JSON.stringify(credits, null, 2)
);

console.log(`OK: ${fetched}件の実写真を取得しました(対象外・未取得は後続でPexels映像を使用します)`);
