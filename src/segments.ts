export type SegmentId = "hook" | "rank3" | "rank2" | "rank1" | "outro";

export type Segment = {
  id: SegmentId;
  badge?: string;
  caption: string[];
};

export const segments: Segment[] = [
  { id: "hook", caption: ["数学最難関のテストで","正答率97%超えの新型AI"] },
  { id: "rank3", caption: ["開発元はOpenAI","ARC-AGI-3で99.9%"] },
  { id: "rank2", caption: ["複数アプリをまたいで","自動操作するAI機能"] },
  { id: "rank1", caption: ["GPT-6 Astra誕生","入力10ドル・出力50ドル"] },
  { id: "outro", caption: ["SFではなく実在するAI","チャンネル登録お願い！"] },
];
