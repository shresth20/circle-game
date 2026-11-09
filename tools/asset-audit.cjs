/* Runtime-oriented asset audit.
   Reports compressed disk bytes and decoded RGBA memory (w * h * 4), which
   is the number that matters for browser image/GPU pressure.

   Usage: node tools/asset-audit.cjs [--json /path/report.json] */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/build/manifest.json')));
const rows = [];
const add = (kind, key, asset, width, height) => {
  const file = path.join(root, 'assets/build', asset.src);
  rows.push({ kind, key, src: asset.src, width, height, diskBytes: fs.statSync(file).size, decodedBytes: width * height * 4 });
};

Object.entries(manifest.images).forEach(([key, a]) => add('image', key, a, a.w, a.h));
Object.entries(manifest.walls).forEach(([key, a]) => add('wall', key, a, a.w, a.h));
Object.entries(manifest.sprites).forEach(([key, a]) => add('sprite', key, a, a.fw * a.cols, a.fh * a.rows));

const unique = [...new Map(rows.map((r) => [r.src, r])).values()];
const sum = (list, field) => list.reduce((n, row) => n + row[field], 0);
const mib = (bytes) => +(bytes / 1048576).toFixed(2);
const categories = [...new Set(unique.map((r) => r.kind))].map((kind) => {
  const list = unique.filter((r) => r.kind === kind);
  return { kind, files: list.length, diskMiB: mib(sum(list, 'diskBytes')), decodedMiB: mib(sum(list, 'decodedBytes')) };
});
const rawRoot = path.resolve(root, '../circle-game-art/images');
const walkBytes = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, entry) => n + (entry.isDirectory() ? walkBytes(path.join(dir, entry.name)) : fs.statSync(path.join(dir, entry.name)).size), 0);
const rawBytes = fs.existsSync(rawRoot) ? walkBytes(rawRoot) : null;
const report = {
  files: unique.length,
  diskMiB: mib(sum(unique, 'diskBytes')),
  potentialDecodedMiB: mib(sum(unique, 'decodedBytes')),
  rawSourceMiB: rawBytes == null ? null : mib(rawBytes),
  diskReductionPercent: rawBytes == null ? null : +(100 * (1 - sum(unique, 'diskBytes') / rawBytes)).toFixed(1),
  categories,
  assets: unique
    .slice()
    .sort((a, b) => b.decodedBytes - a.decodedBytes)
    .map((r) => ({
      kind: r.kind,
      key: r.key,
      src: r.src,
      dimensions: `${r.width}x${r.height}`,
      diskKiB: Math.round(r.diskBytes / 1024),
      decodedMiB: mib(r.decodedBytes),
    })),
  largestDecoded: unique.slice().sort((a, b) => b.decodedBytes - a.decodedBytes).slice(0, 20).map((r) => ({
    kind: r.kind,
    key: r.key,
    dimensions: `${r.width}x${r.height}`,
    diskKiB: Math.round(r.diskBytes / 1024),
    decodedMiB: mib(r.decodedBytes),
  })),
};

console.log(report);
console.table(categories);
console.table(report.largestDecoded);
const jsonAt = process.argv.indexOf('--json');
if (jsonAt >= 0 && process.argv[jsonAt + 1]) fs.writeFileSync(path.resolve(process.argv[jsonAt + 1]), JSON.stringify(report, null, 2));
