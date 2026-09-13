const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(root, p), s, 'utf8');

// 1) Remove only the contiguous legacy server block.
const serverPath = 'server.ts';
let server = read(serverPath);
const startMarker = '  // 一键下载 PC 电脑安装版';
const endMarker = '  // API routes FIRST';
const start = server.indexOf(startMarker);
const end = server.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) {
  throw new Error('Legacy server block markers not found in the expected order; refusing to modify server.ts');
}
server = server.slice(0, start) + server.slice(end);

for (const forbidden of [
  '/api/download-pc-installer',
  '/api/download-mobile-app',
  '/api/export-project',
  '/api/activation/status',
  '/api/activation/register',
  '/api/activation/verify',
  'nodemailer',
  'archiver'
]) {
  if (server.includes(forbidden)) {
    throw new Error(`Legacy server token remains after cleanup: ${forbidden}`);
  }
}
write(serverPath, server);

// 2) Remove dependencies used only by the retired systems.
const pkgPath = 'package.json';
const pkg = JSON.parse(read(pkgPath));
for (const name of ['archiver', '@types/archiver', 'nodemailer', 'playwright']) {
  if (pkg.dependencies) delete pkg.dependencies[name];
}
if (pkg.devDependencies) delete pkg.devDependencies['@types/nodemailer'];
write(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 3) Protect real environment files from ever being committed.
const ignorePath = '.gitignore';
let ignore = read(ignorePath);
const envBlock = '\n# Environment secrets\n.env\n.env.*\n!.env.example\n';
if (!ignore.includes('!.env.example')) {
  ignore = ignore.replace(/\s*$/, '') + '\n' + envBlock;
  write(ignorePath, ignore);
}

// 4) The script/workflow are one-shot scaffolding; remove them from the resulting tree.
for (const p of ['scripts/cleanup-legacy-once.cjs', '.github/workflows/legacy-cleanup-once.yml']) {
  const full = path.join(root, p);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

console.log('Legacy cleanup completed: server routes retired, unused dependencies removed, env ignore hardened.');
