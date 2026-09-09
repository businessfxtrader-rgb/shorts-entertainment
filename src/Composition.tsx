import {
  AbsoluteFill,
  Audio,
  CalculateMetadataFunction,
  Composition,
  Img,
  Loop,
  OffthreadVideo,
  Sequence,
  Series,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { parseMedia } from "@remotion/media-parser";
import { webReader } from "@remotion/media-parser/web";
import { loadFont } from "@remotion/google-fonts/NotoSansJP";
import { segments, SegmentId } from "./segments";
import { Caption } from "./Caption";

const { fontFamily } = loadFont();

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;
const LEAD_IN_SEC = 0.15;
const TAIL_SEC = 0.45;
const END_BUFFER_SEC = 1;

type SegmentTiming = {
  id: SegmentId;
  durationInFrames: number;
  narrationStartFrame: number;
  bgLoopFrames: number;
};

type Props = {
  timings: SegmentTiming[];
};

const calculateMetadata: CalculateMetadataFunction<Props> = async () => {
  const timings: SegmentTiming[] = [];

  for (const seg of segments) {
    const { durationInSeconds: audioDuration } = await parseMedia({
      src: staticFile(`audio/${seg.id}.mp3`),
      fields: { durationInSeconds: true },
      reader: webReader,
    });

    const segmentDurationInSeconds = LEAD_IN_SEC + (audioDuration ?? 2) + TAIL_SEC;

    // 実写真(静止画)の場合はループ不要。Pexels動画のみ尺を調べてループフレーム数を決める
    let bgLoopFrames = Math.round(segmentDurationInSeconds * FPS);
    if (seg.bgType === "video") {
      const { durationInSeconds: videoDuration } = await parseMedia({
        src: staticFile(`bg/${seg.id}.${seg.bgExt}`),
        fields: { durationInSeconds: true },
        reader: webReader,
      });
      bgLoopFrames = Math.max(1, Math.round((videoDuration ?? 5) * FPS));
    }

    timings.push({
      id: seg.id,
      durationInFrames: Math.round(segmentDurationInSeconds * FPS),
      narrationStartFrame: Math.round(LEAD_IN_SEC * FPS),
      bgLoopFrames,
    });
  }

  const totalFrames =
    timings.reduce((sum, t) => sum + t.durationInFrames, 0) +
    Math.round(END_BUFFER_SEC * FPS);

  return {
    props: { timings },
    durationInFrames: totalFrames,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
  };
};

export const ShortsVideo = () => {
  return (
    <Composition
      id="ShortsVideo"
      component={ShortsVideoComponent}
      durationInFrames={150}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      calculateMetadata={calculateMetadata}
      defaultProps={{ timings: [] }}
    />
  );
};

// 実写真(静止画)用のゆっくりズームイン効果(いわゆるケンバーンズ効果)。
// ストック動画のような動きが無いと静止画は間延びして見えるための対策
const KenBurnsImage: React.FC<{ src: string; durationInFrames: number }> = ({
  src,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.12], {
    extrapolateRight: "clamp",
  });
  const translateX = interpolate(frame, [0, durationInFrames], [0, -12], {
    extrapolateRight: "clamp",
  });
  return (
    <Img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `scale(${scale}) translateX(${translateX}px)`,
      }}
    />
  );
};

const ShortsVideoComponent: React.FC<Props> = ({ timings }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Series>
        {timings.map((timing) => {
          const seg = segments.find((s) => s.id === timing.id)!;
          return (
            <Series.Sequence key={timing.id} durationInFrames={timing.durationInFrames}>
              <AbsoluteFill>
                {seg.bgType === "image" ? (
                  <KenBurnsImage
                    src={staticFile(`bg/${timing.id}.${seg.bgExt}`)}
                    durationInFrames={timing.durationInFrames}
                  />
                ) : (
                  <Loop durationInFrames={timing.bgLoopFrames}>
                    <OffthreadVideo
                      src={staticFile(`bg/${timing.id}.${seg.bgExt}`)}
                      muted
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </Loop>
                )}
                <AbsoluteFill
                  style={{
                    background:
                      "linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0) 45%)",
                  }}
                />
                <Caption badge={seg.badge} lines={seg.caption} fontFamily={fontFamily} />
                <Sequence from={timing.narrationStartFrame}>
                  <Audio src={staticFile(`audio/${timing.id}.mp3`)} />
                </Sequence>
              </AbsoluteFill>
            </Series.Sequence>
          );
        })}
      </Series>
      <Audio src={staticFile("bgm/bgm.mp3")} volume={0.15} loop />
    </AbsoluteFill>
  );
};
