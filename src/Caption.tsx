import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const Caption: React.FC<{
  badge?: string;
  lines: string[];
  fontFamily: string;
}> = ({ badge, lines, fontFamily }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame, fps, config: { damping: 200 } });
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const translateY = interpolate(progress, [0, 1], [20, 0]);

  const stroke = [
    "-3px -3px 0 #000", "3px -3px 0 #000",
    "-3px 3px 0 #000", "3px 3px 0 #000",
    "-4px 0 0 #000", "4px 0 0 #000",
    "0 -4px 0 #000", "0 4px 0 #000",
    "0 6px 14px rgba(0,0,0,0.5)",
  ].join(", ");

  return (
    // YouTube Shorts側のUI(下部のタイトル・チャンネル名・概要欄トレイ、右側のいいね等の
    // アイコン列)が画面下〜25%程度を覆うため、テロップは画面中央付近に配置する
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "0 60px",
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          background: "rgba(0,0,0,0.55)",
          borderRadius: 24,
          padding: "28px 40px",
          maxWidth: 940,
          textAlign: "center",
        }}
      >
        {badge ? (
          <div
            style={{
              fontFamily,
              fontWeight: 700,
              fontSize: 44,
              color: "#FFD400",
              marginBottom: 10,
              textShadow: stroke,
            }}
          >
            {badge}
          </div>
        ) : null}
        {lines.map((line, i) => {
          const lineProgress = spring({
            frame: frame - i * 4,
            fps,
            config: { damping: 200 },
          });
          return (
            <div
              key={i}
              style={{
                fontFamily,
                fontWeight: 900,
                fontSize: 60,
                color: "white",
                lineHeight: 1.35,
                letterSpacing: 1,
                textShadow: stroke,
                opacity: lineProgress,
                transform: `translateY(${interpolate(lineProgress, [0, 1], [16, 0])}px)`,
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
