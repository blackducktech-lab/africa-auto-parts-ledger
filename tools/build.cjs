const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
// Write only explicit build outputs. Never copy local backups or reference files.
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
const result = spawnSync(process.execPath, [
  require.resolve('tailwindcss/lib/cli.js'), '-c', 'tailwind.config.cjs',
  '-i', 'assets/input.css', '-o', 'dist/assets/styles.css', '--minify'
], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const files = ['index.html', 'manifest.webmanifest', 'assets/app.js', 'assets/icon.svg'];
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(dist, file));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
const hash = crypto.createHash('sha256');
for (const file of [...files, 'assets/styles.css']) hash.update(fs.readFileSync(path.join(dist, file)));
let worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
worker = worker.replace('__BUILD_ID__', hash.digest('hex').slice(0, 16));
fs.writeFileSync(path.join(dist, 'sw.js'), worker);
console.log('Built GitHub Pages files in dist/ (no ledger records included).');
