export type SegmentId = "hook" | "rank3" | "rank2" | "rank1" | "outro";

export type Segment = {
  id: SegmentId;
  badge?: string;
  caption: string[];
  bgType: "image" | "video";
  bgExt: "jpg" | "png" | "mp4";
};

export const segments: Segment[] = [
  { id: "hook", caption: ["神殿・遺跡・超高層ビル","共通する衝撃の建築の秘密"], bgType: "video", bgExt: "mp4" },
  { id: "rank3", badge: "第3位", caption: ["パルテノン神殿は直線ゼロ","遠近法を計算した設計"], bgType: "image", bgExt: "jpg" },
  { id: "rank2", badge: "第2位", caption: ["チチェン・イッツァ遺跡","手拍子が鳥の声に変化"], bgType: "image", bgExt: "jpg" },
  { id: "rank1", badge: "第1位", caption: ["台北101・高さ300m","728トンの鉄球で制振"], bgType: "image", bgExt: "jpg" },
  { id: "outro", caption: ["他の建築ミステリーも","チャンネル登録して待ってて"], bgType: "video", bgExt: "mp4" },
];
