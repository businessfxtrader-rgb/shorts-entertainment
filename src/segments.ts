export const screenTitle: string[] = [];
export const themeIndex = 0;

export type SegmentId = "hook" | "rank3" | "rank2" | "rank1" | "outro";

export type Segment = {
  id: SegmentId;
  badge?: string;
  caption: string[];
  bgType: "image" | "video";
  bgExt: "jpg" | "png" | "mp4";
};

export const segments: Segment[] = [
  { id: "hook", caption: ["南アフリカの過酷な砂漠に","小石そっくりの正体とは"], bgType: "video", bgExt: "mp4" },
  { id: "rank3", caption: ["気温50度を超える砂漠","動物に狙われる過酷な地"], bgType: "image", bgExt: "jpg" },
  { id: "rank2", caption: ["体のほとんどは地中に","表面に浮かぶ謎の模様"], bgType: "image", bgExt: "jpg" },
  { id: "rank1", caption: ["その正体はリトープス","石そっくりに擬態する多肉植物"], bgType: "image", bgExt: "jpg" },
  { id: "outro", caption: ["チャンネル登録で新知識を","驚いた雑学はコメントへ"], bgType: "video", bgExt: "mp4" },
];
