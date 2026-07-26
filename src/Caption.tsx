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

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 260,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          background: "rgba(0,0,0,0.55)",
          borderRadius: 24,
          padding: "28px 40px",
          maxWidth: 900,
          textAlign: "center",
        }}
      >
        {badge ? (
          <div
            style={{
              fontFamily,
              fontWeight: 700,
              fontSize: 40,
              color: "#FFD400",
              marginBottom: 8,
            }}
          >
            {badge}
          </div>
        ) : null}
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily,
              fontWeight: 700,
              fontSize: 56,
              color: "white",
              lineHeight: 1.3,
              textShadow: "0 4px 12px rgba(0,0,0,0.6)",
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
