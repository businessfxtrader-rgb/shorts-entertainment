export type SegmentId = "hook" | "rank3" | "rank2" | "rank1" | "outro";

export type Segment = {
  id: SegmentId;
  badge?: string;
  caption: string[];
};

export const segments: Segment[] = [
  { id: "hook", caption: ["その常識、実は","世界の非常識かも?"] },
  { id: "rank3", badge: "第3位", caption: ["首振りが","真逆の国がある"] },
  { id: "rank2", badge: "第2位", caption: ["食事は","右手だけが常識"] },
  { id: "rank1", badge: "第1位", caption: ["麺をすする音は","世界では非常識?"] },
  { id: "outro", caption: ["世界はもっと","おもしろい"] },
];
