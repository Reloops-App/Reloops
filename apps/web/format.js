import fs from 'fs';
const content = fs.readFileSync('src/components/review/video.tsx', 'utf-8');
const lines = content.split('\n');
let depth = 0;
let out = "";
for (let i = 230; i < lines.length; i++) {
  const line = lines[i];
  const opens = (line.match(/<div/g) || []).length;
  const motionOpens = (line.match(/<motion\.div/g) || []).length;
  const animOpens = (line.match(/<AnimatePresence>/g) || []).length;

  const closes = (line.match(/<\/div>/g) || line.match(/<\/div >/g) || []).length;
  const motionCloses = (line.match(/<\/motion\.div>/g) || []).length;
  const animCloses = (line.match(/<\/AnimatePresence>/g) || []).length;
  
  if (opens + motionOpens + animOpens > 0) {
      out += `[${depth}] LINE ${i+1}: ${line.trim()}\n`;
  }
  
  depth += opens + motionOpens + animOpens;
  depth -= (closes + motionCloses + animCloses);
  
  if (closes + motionCloses + animCloses > 0) {
      out += `[${depth}] LINE ${i+1}: ${line.trim()} (CLOSES)\n`;
  }
}
console.log(out);
