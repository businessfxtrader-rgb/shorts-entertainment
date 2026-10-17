import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// 体験型(見る人が自分で試す)動画の課題映像(2026-10-18追加、ジャンル「錯覚」)。
// 課題と正解は scripts/lib/experience.mjs が決める。ここではそれをプログラムで描き、
// revealFrame から約1秒かけて「種明かし」の状態に変化させる。点滅・ちらつく模様は使わない。
// 画面の上(見出しの帯)と下(字幕・YouTubeの操作ボタン)を避け、中央の y=460〜1300 に課題を置く

const W = 1080;
const H = 1920;
const BG = "#101418";
const ACCENT = "#ff3b3b";

type Params = Record<string, unknown>;

export const ExperienceView: React.FC<{
  type: string;
  params: Params;
  revealFrame: number;
  holdStartFrame: number;
  holdFrames: number;
  fontFamily: string;
}> = ({ type, params, revealFrame, holdStartFrame, holdFrames, fontFamily }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // 種明かしの進み具合 0→1(約1秒)
  const p = interpolate(frame, [revealFrame, revealFrame + fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  let body: React.ReactNode = null;
  if (type === "ebbinghaus") body = <Ebbinghaus p={p} bigLeft={Boolean(params.bigSurroundOnLeft)} />;
  else if (type === "muller-lyer") body = <MullerLyer p={p} outwardOnTop={Boolean(params.outwardOnTop)} />;
  else if (type === "cafe-wall") body = <CafeWall p={p} />;
  else if (type === "contrast") body = <Contrast p={p} darkLeft={Boolean(params.darkOnLeft)} />;
  else if (type === "odd-glyph") body = <OddGlyph p={p} params={params} fontFamily={fontFamily} />;
  else if (type === "odd-color") body = <OddColor p={p} params={params} />;

  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {body}
      </svg>
      <Countdown frame={frame} start={holdStartFrame} frames={holdFrames} fps={fps} fontFamily={fontFamily} />
    </AbsoluteFill>
  );
};

// 考える時間のカウントダウン(課題の邪魔にならない右上)
const Countdown: React.FC<{ frame: number; start: number; frames: number; fps: number; fontFamily: string }> = ({
  frame,
  start,
  frames,
  fps,
  fontFamily,
}) => {
  if (frames <= 0 || frame < start || frame >= start + frames) return null;
  const remaining = Math.ceil((start + frames - frame) / fps);
  const local = (frame - start) % fps;
  const scale = interpolate(local, [0, 6], [1.25, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: "470px 50px 0 0" }}>
      <div
        style={{
          width: 130,
          height: 130,
          borderRadius: 65,
          background: ACCENT,
          color: "white",
          fontFamily,
          fontWeight: 900,
          fontSize: 80,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          transform: `scale(${scale})`,
          boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
        }}
      >
        {remaining}
      </div>
    </AbsoluteFill>
  );
};

const RevealRing: React.FC<{ cx: number; cy: number; r: number; p: number }> = ({ cx, cy, r, p }) => {
  if (p <= 0) return null;
  const s = spring({ frame: p * 30, fps: 30, config: { damping: 10 } });
  return <circle cx={cx} cy={cy} r={r * (0.6 + 0.4 * s)} fill="none" stroke={ACCENT} strokeWidth={12} opacity={p} />;
};

// エビングハウス錯視: 同じ大きさの円が、周りの円の大きさで違って見える
const Ebbinghaus: React.FC<{ p: number; bigLeft: boolean }> = ({ p, bigLeft }) => {
  const cy = 930;
  const r = 62;
  const leftX = interpolate(p, [0, 1], [290, 440]);
  const rightX = interpolate(p, [0, 1], [790, 640]);
  const ring = (cx: number, big: boolean) => {
    const n = big ? 6 : 8;
    const dist = big ? 185 : 102;
    const rr = big ? 98 : 28;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return <circle key={i} cx={cx + Math.cos(a) * dist} cy={cy + Math.sin(a) * dist} r={rr} fill="#9aa3ad" opacity={1 - p} />;
    });
  };
  return (
    <g>
      {ring(290, bigLeft)}
      {ring(790, !bigLeft)}
      <circle cx={leftX} cy={cy} r={r} fill="#ff8a1f" />
      <circle cx={rightX} cy={cy} r={r} fill="#ff8a1f" />
      {p >= 1 ? (
        <line x1={380} x2={700} y1={cy - r} y2={cy - r} stroke={ACCENT} strokeWidth={6} strokeDasharray="18 12" />
      ) : null}
      {p >= 1 ? (
        <line x1={380} x2={700} y1={cy + r} y2={cy + r} stroke={ACCENT} strokeWidth={6} strokeDasharray="18 12" />
      ) : null}
    </g>
  );
};

// ミュラー・リヤー錯視: 同じ長さの線が、矢羽根の向きで違って見える
const MullerLyer: React.FC<{ p: number; outwardOnTop: boolean }> = ({ p, outwardOnTop }) => {
  const x1 = 280;
  const x2 = 800;
  const ys = [760, 1100];
  const fin = (x: number, y: number, dir: number, key: string) => (
    <g key={key} opacity={1 - p}>
      <line x1={x} y1={y} x2={x + dir * 70} y2={y - 60} stroke="white" strokeWidth={12} strokeLinecap="round" />
      <line x1={x} y1={y} x2={x + dir * 70} y2={y + 60} stroke="white" strokeWidth={12} strokeLinecap="round" />
    </g>
  );
  const line = (y: number, outward: boolean, i: number) => (
    <g key={i}>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="white" strokeWidth={12} strokeLinecap="round" />
      {/* 外向き(>——<)は長く、内向き(<——>)は短く見える */}
      {fin(x1, y, outward ? -1 : 1, `a${i}`)}
      {fin(x2, y, outward ? 1 : -1, `b${i}`)}
    </g>
  );
  return (
    <g>
      {line(ys[0], outwardOnTop, 0)}
      {line(ys[1], !outwardOnTop, 1)}
      {[x1, x2].map((x) => (
        <line key={x} x1={x} x2={x} y1={640} y2={1220} stroke={ACCENT} strokeWidth={6} strokeDasharray="18 12" opacity={p} />
      ))}
    </g>
  );
};

// カフェウォール錯視: 平行な横線が、ずれたタイルで傾いて見える
const CafeWall: React.FC<{ p: number }> = ({ p }) => {
  const tileW = 120;
  const tileH = 84;
  const mortar = 6;
  const rows = 8;
  const top = 520;
  const shifts = [0, 30, 60, 30, 0, 30, 60, 30];
  const tiles: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const y = top + r * (tileH + mortar);
    for (let c = -1; c < 10; c++) {
      const x = c * tileW + shifts[r];
      const dark = (c + 100) % 2 === 0;
      const color = dark ? interpolate(p, [0, 1], [0, 90]) : interpolate(p, [0, 1], [255, 165]);
      tiles.push(<rect key={`${r}-${c}`} x={x} y={y} width={tileW} height={tileH} fill={`rgb(${color},${color},${color})`} />);
    }
  }
  const lines = Array.from({ length: rows + 1 }, (_, r) => top + r * (tileH + mortar) - mortar / 2);
  return (
    <g>
      <rect x={0} y={top - mortar} width={W} height={rows * (tileH + mortar) + mortar} fill="#8a8a8a" />
      {tiles}
      {lines.map((y) => (
        <line key={y} x1={0} x2={W} y1={y} y2={y} stroke={ACCENT} strokeWidth={4} opacity={p} />
      ))}
    </g>
  );
};

// 明るさの対比: 同じ灰色の四角が、背景の明るさで違って見える
const Contrast: React.FC<{ p: number; darkLeft: boolean }> = ({ p, darkLeft }) => {
  const x0 = 40;
  const y0 = 500;
  const w = 1000;
  const h = 780;
  const size = 190;
  const cy = y0 + h / 2;
  return (
    <g>
      <defs>
        <linearGradient id="grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={darkLeft ? "#0d0d0d" : "#f2f2f2"} />
          <stop offset="100%" stopColor={darkLeft ? "#f2f2f2" : "#0d0d0d"} />
        </linearGradient>
      </defs>
      <rect x={x0} y={y0} width={w} height={h} fill="#5a5a5a" />
      <rect x={x0} y={y0} width={w} height={h} fill="url(#grad)" opacity={1 - p} />
      <rect x={250 - size / 2} y={cy - size / 2} width={size} height={size} fill="#8c8c8c" />
      <rect x={830 - size / 2} y={cy - size / 2} width={size} height={size} fill="#8c8c8c" />
      {/* 種明かし: 同じ色の帯で2つをつなぐ */}
      <rect x={250} y={cy - 30} width={580} height={60} fill="#8c8c8c" opacity={p} />
    </g>
  );
};

// 仲間はずれ探し(似た字): 1つだけ違う字が混ざっている
const OddGlyph: React.FC<{ p: number; params: Params; fontFamily: string }> = ({ p, params, fontFamily }) => {
  const cols = Number(params.cols ?? 7);
  const rows = Number(params.rows ?? 11);
  const tr = Number(params.row ?? 0);
  const tc = Number(params.col ?? 0);
  const major = String(params.major ?? "未");
  const odd = String(params.odd ?? "末");
  const cellW = 980 / cols;
  const cellH = 820 / rows;
  const x0 = 50;
  const y0 = 470;
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isOdd = r === tr && c === tc;
      cells.push(
        <text
          key={`${r}-${c}`}
          x={x0 + c * cellW + cellW / 2}
          y={y0 + r * cellH + cellH * 0.78}
          textAnchor="middle"
          fontFamily={fontFamily}
          fontWeight={700}
          fontSize={Math.min(cellW, cellH) * 0.82}
          fill={isOdd && p >= 1 ? ACCENT : "white"}
        >
          {isOdd ? odd : major}
        </text>
      );
    }
  }
  return (
    <g>
      {cells}
      <RevealRing cx={x0 + tc * cellW + cellW / 2} cy={y0 + tr * cellH + cellH / 2} r={Math.max(cellW, cellH) * 0.7} p={p} />
    </g>
  );
};

// 仲間はずれ探し(色): 1枚だけわずかに明るいタイル
const OddColor: React.FC<{ p: number; params: Params }> = ({ p, params }) => {
  const cols = Number(params.cols ?? 6);
  const rows = Number(params.rows ?? 9);
  const tr = Number(params.row ?? 0);
  const tc = Number(params.col ?? 0);
  const hue = Number(params.hue ?? 200);
  const delta = Number(params.delta ?? 7);
  const gap = 12;
  const tileW = (980 - gap * (cols - 1)) / cols;
  const tileH = (820 - gap * (rows - 1)) / rows;
  const x0 = 50;
  const y0 = 470;
  const tiles: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isOdd = r === tr && c === tc;
      tiles.push(
        <rect
          key={`${r}-${c}`}
          x={x0 + c * (tileW + gap)}
          y={y0 + r * (tileH + gap)}
          width={tileW}
          height={tileH}
          rx={14}
          fill={`hsl(${hue}, 62%, ${isOdd ? 50 + delta : 50}%)`}
        />
      );
    }
  }
  return (
    <g>
      {tiles}
      <RevealRing
        cx={x0 + tc * (tileW + gap) + tileW / 2}
        cy={y0 + tr * (tileH + gap) + tileH / 2}
        r={Math.max(tileW, tileH) * 0.75}
        p={p}
      />
    </g>
  );
};
