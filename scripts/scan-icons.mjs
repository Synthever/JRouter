import fs from "fs";
import path from "path";

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat && stat.isDirectory()) {
      if (!full.includes("node_modules") && !full.includes(".next") && !full.includes(".git") && !full.includes("tests") && !full.includes("gitbook")) {
        results = results.concat(walk(full));
      }
    } else if (/\.(js|jsx|ts|tsx|css|mjs)$/.test(file)) {
      results.push(full);
    }
  });
  return results;
}

const files = walk("./src");
const fileOccurrences = [];

files.forEach(f => {
  const content = fs.readFileSync(f, "utf8");
  const count = (content.match(/material-symbols-outlined/g) || []).length;
  if (count > 0) {
    fileOccurrences.push({ file: f, count });
  }
});

fileOccurrences.sort((a, b) => b.count - a.count);
console.log(`Total files: ${fileOccurrences.length}`);
console.log(`Total spans: ${fileOccurrences.reduce((s, x) => s + x.count, 0)}`);
fileOccurrences.forEach(x => console.log(`${x.count.toString().padStart(3)}: ${x.file}`));
