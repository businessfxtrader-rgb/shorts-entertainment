import {
  AbsoluteFill,
  Audio,
  CalculateMetadataFunction,
  Composition,
  Loop,
  OffthreadVideo,
  Sequence,
  Series,
  staticFile,
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
    const { durationInSeconds: videoDuration } = await parseMedia({
      src: staticFile(`bg/${seg.id}.mp4`),
      fields: { durationInSeconds: true },
      reader: webReader,
    });

    const segmentDurationInSeconds = LEAD_IN_SEC + (audioDuration ?? 2) + TAIL_SEC;

    timings.push({
      id: seg.id,
      durationInFrames: Math.round(segmentDurationInSeconds * FPS),
      narrationStartFrame: Math.round(LEAD_IN_SEC * FPS),
      bgLoopFrames: Math.max(1, Math.round((videoDuration ?? 5) * FPS)),
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

const ShortsVideoComponent: React.FC<Props> = ({ timings }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Series>
        {timings.map((timing) => {
          const seg = segments.find((s) => s.id === timing.id)!;
          return (
            <Series.Sequence key={timing.id} durationInFrames={timing.durationInFrames}>
              <AbsoluteFill>
                <Loop durationInFrames={timing.bgLoopFrames}>
                  <OffthreadVideo
                    src={staticFile(`bg/${timing.id}.mp4`)}
                    muted
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </Loop>
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
