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
import { segments, SegmentId, screenTitle, themeIndex, experience, thinkHoldSec } from "./segments";
import { ExperienceView } from "./experience/ExperienceView";
import { Caption } from "./Caption";
import { TitleBand } from "./TitleBand";
import { themeFor } from "./theme";

const { fontFamily } = loadFont();

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;
const LEAD_IN_SEC = 0.15;
const TAIL_SEC = 0.45;
const END_BUFFER_SEC = 1;
// BGMの音量。ナレーション中は下げて(ダッキング)、声が埋もれないようにする(2026-09-28追加)。
// 元気な曲だと、一定音量0.15のままではナレーションとの差が約5dBしかなく聞き取りにくかったため
const BGM_VOLUME = 0.15;
const BGM_VOLUME_UNDER_VOICE = 0.06;
const DUCK_RAMP_FRAMES = 6;

// 背景の切り替え間隔の目安(2026-10-13、PDCA v3)。以前は1つのsegment(約8秒)の間ずっと同じ映像で、
// 画面の変化が遅かった。1つのsegmentを最大3カットに分け、約3秒ごとに映像を切り替える
const TARGET_CUT_SEC = 2.8;

type BgClip = {
  src: string; // public/ からのパス
  type: "image" | "video";
  loopFrames: number; // 動画の長さ(ループ用)。静止画はカットの長さで上書きされる
};

type SegmentTiming = {
  id: SegmentId;
  durationInFrames: number;
  narrationStartFrame: number;
  clips: BgClip[];
};

type Props = {
  timings: SegmentTiming[];
};

const calculateMetadata: CalculateMetadataFunction<Props> = async () => {
  const timings: SegmentTiming[] = [];

  for (const seg of segments) {
    const { durationInSeconds: audioDuration } = await parseMedia({
      src: staticFile(`audio/${seg.id}.wav`),
      fields: { durationInSeconds: true },
      reader: webReader,
    });

    // 体験型(2026-10-18)は、rank2の読み上げの後に考える時間(無音・カウントダウン)を足す
    const holdSec = experience && seg.id === "rank2" ? thinkHoldSec : 0;
    const segmentDurationInSeconds = LEAD_IN_SEC + (audioDuration ?? 2) + holdSec + TAIL_SEC;

    // 背景のカット: 1本目(実写真またはPexels動画)+追加カット。segmentの長さに応じて使う本数を決める
    // 体験型は課題の映像をプログラムで描くので、背景素材は使わない
    const allClips = experience ? [] : [
      { src: `bg/${seg.id}.${seg.bgExt}`, type: seg.bgType },
      ...(seg.extraClips ?? []).map((f) => ({ src: `bg/${f}`, type: "video" as const })),
    ];
    const cutCount = Math.min(allClips.length, Math.max(1, Math.round(segmentDurationInSeconds / TARGET_CUT_SEC)));
    const clips: BgClip[] = [];
    for (const c of allClips.slice(0, cutCount)) {
      // 静止画はループ不要。動画は尺を調べてループフレーム数を決める
      let loopFrames = Math.round(segmentDurationInSeconds * FPS);
      if (c.type === "video") {
        const { durationInSeconds: videoDuration } = await parseMedia({
          src: staticFile(c.src),
          fields: { durationInSeconds: true },
          reader: webReader,
        });
        loopFrames = Math.max(1, Math.round((videoDuration ?? 5) * FPS));
      }
      clips.push({ src: c.src, type: c.type, loopFrames });
    }

    timings.push({
      id: seg.id,
      durationInFrames: Math.round(segmentDurationInSeconds * FPS),
      narrationStartFrame: Math.round(LEAD_IN_SEC * FPS),
      clips,
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

// カットごとに少しずつ寄る(または引く)動きを付け、切り替えを目立たせる
const PunchIn: React.FC<{ durationInFrames: number; zoomIn: boolean; children: React.ReactNode }> = ({
  durationInFrames,
  zoomIn,
  children,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], zoomIn ? [1.0, 1.07] : [1.07, 1.0], {
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ transform: `scale(${scale})` }}>{children}</AbsoluteFill>;
};

// 1つのsegmentの背景を、カットの本数で等分して順番に出す
const SegmentBackground: React.FC<{ timing: SegmentTiming }> = ({ timing }) => {
  const n = timing.clips.length;
  if (n === 0) return null;
  const base = Math.floor(timing.durationInFrames / n);
  return (
    <>
      {timing.clips.map((clip, i) => {
        const from = i * base;
        const len = i === n - 1 ? timing.durationInFrames - from : base;
        return (
          <Sequence key={clip.src} from={from} durationInFrames={len}>
            {clip.type === "image" ? (
              <KenBurnsImage src={staticFile(clip.src)} durationInFrames={len} />
            ) : (
              <PunchIn durationInFrames={len} zoomIn={i % 2 === 0}>
                <Loop durationInFrames={clip.loopFrames}>
                  <OffthreadVideo
                    src={staticFile(clip.src)}
                    muted
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </Loop>
              </PunchIn>
            )}
          </Sequence>
        );
      })}
    </>
  );
};

const ShortsVideoComponent: React.FC<Props> = ({ timings }) => {
  const theme = themeFor(themeIndex);
  // ナレーションが鳴っている区間(フレーム)
  const voiceWindows: [number, number][] = [];
  let offset = 0;
  for (const t of timings) {
    const start = offset + t.narrationStartFrame;
    const end = offset + t.durationInFrames - Math.round(TAIL_SEC * FPS);
    voiceWindows.push([start, end]);
    offset += t.durationInFrames;
  }
  const bgmVolume = (f: number) => {
    // 最も近い発話区間までの距離に応じて、なめらかに音量を下げる
    let duck = 0;
    for (const [s, e] of voiceWindows) {
      const dist = f < s ? s - f : f > e ? f - e : 0;
      duck = Math.max(duck, interpolate(dist, [0, DUCK_RAMP_FRAMES], [1, 0], { extrapolateRight: "clamp" }));
    }
    return BGM_VOLUME - (BGM_VOLUME - BGM_VOLUME_UNDER_VOICE) * duck;
  };
  // 体験型: 種明かし(rank1の開始)と、考える時間(rank2の読み上げ後)のフレーム位置
  const startOf = (id: SegmentId) => {
    let f = 0;
    for (const t of timings) {
      if (t.id === id) return f;
      f += t.durationInFrames;
    }
    return f;
  };
  const rank2 = timings.find((t) => t.id === "rank2");
  const holdFrames = experience ? Math.round(thinkHoldSec * FPS) : 0;
  const holdStartFrame = rank2 ? startOf("rank2") + rank2.durationInFrames - Math.round(TAIL_SEC * FPS) - holdFrames : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {experience ? (
        <ExperienceView
          type={experience.type}
          params={experience.params}
          revealFrame={startOf("rank1")}
          holdStartFrame={holdStartFrame}
          holdFrames={holdFrames}
          fontFamily={fontFamily}
        />
      ) : null}
      <Series>
        {timings.map((timing) => {
          const seg = segments.find((s) => s.id === timing.id)!;
          return (
            <Series.Sequence key={timing.id} durationInFrames={timing.durationInFrames}>
              <AbsoluteFill>
                <SegmentBackground timing={timing} />
                {experience ? null : (
                  <AbsoluteFill
                    style={{
                      background:
                        "linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0) 45%)",
                    }}
                  />
                )}
                <Caption
                  badge={seg.badge}
                  lines={seg.caption}
                  fontFamily={fontFamily}
                  captionBg={theme.captionBg}
                  badgeColor={theme.badgeColor}
                  position={experience ? "bottom" : "center"}
                />
                <Sequence from={timing.narrationStartFrame}>
                  <Audio src={staticFile(`audio/${timing.id}.wav`)} />
                </Sequence>
              </AbsoluteFill>
            </Series.Sequence>
          );
        })}
      </Series>
      <TitleBand lines={screenTitle} theme={theme} fontFamily={fontFamily} />
      <Audio src={staticFile("bgm/bgm.mp3")} volume={bgmVolume} loop />
    </AbsoluteFill>
  );
};
