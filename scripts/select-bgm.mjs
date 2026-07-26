import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const library = JSON.parse(fs.readFileSync(path.join(root, "scripts", "bgm-library.json"), "utf-8"));
const chosen = library[Math.floor(Math.random() * library.length)];

const srcPath = path.join(root, "public", chosen.file);
const destPath = path.join(root, "public", "bgm", "bgm.mp3");
fs.copyFileSync(srcPath, destPath);

const creditPath = path.join(root, "content", "current-bgm-credit.json");
fs.writeFileSync(
  creditPath,
  JSON.stringify(
    {
      creditLine: `Music: ${chosen.title} by ${chosen.author} (${chosen.source})\nLicensed under Creative Commons: ${chosen.license}`,
    },
    null,
    2
  )
);

console.log(`OK: BGMに "${chosen.title}" (${chosen.mood}) を選びました`);
