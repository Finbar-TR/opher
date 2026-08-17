import sharp from "sharp";
import { readFileSync } from "fs";
import { join } from "path";

// Rasterise the source SVG into the PNG sizes a PWA needs for install prompts
// and Apple home-screen icons. Re-run whenever public/icon.svg changes.
const root = join(__dirname, "..", "public");
const svg = readFileSync(join(root, "icon.svg"));

const targets = [
  { size: 192, file: "icon-192.png" },
  { size: 512, file: "icon-512.png" },
  { size: 180, file: "apple-touch-icon.png" },
];

async function main() {
  for (const t of targets) {
    await sharp(svg, { density: 384 })
      .resize(t.size, t.size)
      .png()
      .toFile(join(root, t.file));
    console.log("wrote", t.file);
  }
}

main();
