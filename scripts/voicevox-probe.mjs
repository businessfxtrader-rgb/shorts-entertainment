import fs from "node:fs";
import path from "node:path";

// 一時的な調査用: VOICEVOXエンジンの話者一覧と、各キャラの利用規約(policy)を取得して保存する。
// 声のプールを決めるために、規約の原文を読む目的で使う。
const BASE = process.env.VOICEVOX_URL ?? "http://localhost:50021";
const outDir = path.join(process.cwd(), "probe-out");
fs.mkdirSync(outDir, { recursive: true });

const version = await (await fetch(`${BASE}/version`)).text();
console.log("engine version:", version);
fs.writeFileSync(path.join(outDir, "version.txt"), version);

const speakers = await (await fetch(`${BASE}/speakers`)).json();
fs.writeFileSync(path.join(outDir, "speakers.json"), JSON.stringify(speakers, null, 2));
console.log(`speakers: ${speakers.length}`);

const policies = [];
for (const sp of speakers) {
  let info = null;
  for (const q of ["&resource_format=url", ""]) {
    try {
      const res = await fetch(`${BASE}/speaker_info?speaker_uuid=${sp.speaker_uuid}${q}`);
      if (res.ok) {
        info = await res.json();
        break;
      }
    } catch {
      // 次の形式を試す
    }
  }
  policies.push({
    name: sp.name,
    speaker_uuid: sp.speaker_uuid,
    styles: sp.styles.map((s) => ({ id: s.id, name: s.name, type: s.type })),
    policy: info?.policy ?? null,
  });
}
fs.writeFileSync(path.join(outDir, "policies.json"), JSON.stringify(policies, null, 2));
console.log("policies saved:", policies.filter((p) => p.policy).length, "/", policies.length);
