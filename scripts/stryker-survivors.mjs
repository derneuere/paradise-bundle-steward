import fs from 'node:fs';

const jsonPath = process.argv[2] ?? 'reports/mutation/streetData.json';
const r = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const survivors = [];
for (const [f, fd] of Object.entries(r.files || {})) {
  for (const mut of (fd.mutants || [])) {
    if (mut.status === 'Survived') {
      survivors.push({
        file: f,
        line: mut.location.start.line,
        col: mut.location.start.column,
        mutator: mut.mutatorName,
        repl: String(mut.replacement || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      });
    }
  }
}
survivors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);
console.log(`Survivors: ${survivors.length}`);
let lastFile = '';
for (const s of survivors) {
  if (s.file !== lastFile) { console.log(`\n${s.file}:`); lastFile = s.file; }
  console.log(`  ${String(s.line).padStart(4)}:${String(s.col).padEnd(3)} ${s.mutator.padEnd(22)} -> ${s.repl}`);
}
