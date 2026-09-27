import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Theme } from "./theme";

// 画面上部に動画の最初から最後まで出し続ける見出し(2026-09-28追加)。
// ショートは最初の1〜2秒で見るかスワイプするかが決まるため、1コマ目で「何の動画か」を伝える。
// YouTube側のUI(上部の検索・メニューアイコン)に重ならないよう、上端から少し下げて置く
export const TitleBand: React.FC<{ lines: string[]; theme: Theme; fontFamily: string }> = ({
  lines,
  theme,
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (lines.length === 0) return null;

  // 1コマ目から読めるよう、フェードインではなく小さく弾むだけにする
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 180 } });
  const scale = interpolate(pop, [0, 1], [0.94, 1]);

  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 210 }}>
      <div
        style={{
          transform: `scale(${scale}) rotate(-1.5deg)`,
          background: theme.bandBg,
          borderRadius: 18,
          padding: "20px 44px 24px",
          maxWidth: 980,
          textAlign: "center",
          boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily,
              fontWeight: 900,
              fontSize: 78,
              lineHeight: 1.22,
              letterSpacing: 2,
              color: i === lines.length - 1 && lines.length > 1 ? theme.bandAccent : theme.bandText,
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
