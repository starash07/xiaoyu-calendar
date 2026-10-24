// Electron 运行环境独立放在用户目录；源码和开发数据始终使用当前项目。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const appDir = path.resolve(__dirname, '..');

function prepareRuntime() {
  if (process.platform !== 'win32') return require('electron');
  if (!process.env.LOCALAPPDATA) throw new Error('无法获取当前用户的本地应用目录。');
  const source = path.join(appDir, 'node_modules', 'electron', 'dist');
  const version = fs.readFileSync(path.join(source, 'version'), 'utf8').trim();
  const files = [];
  function collect(folder, prefix = '') {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) collect(path.join(folder, entry.name), relative);
      else if (entry.isFile()) {
        const stat = fs.statSync(path.join(source, relative));
        files.push({ relative, size: stat.size, modified: stat.mtimeMs });
      } else throw new Error('Electron 运行文件包含异常链接，请重新安装项目依赖。');
    }
  }
  collect(source);
  files.sort((a, b) => a.relative.localeCompare(b.relative));
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
  const cache = path.join(process.env.LOCALAPPDATA, 'YuyuPlanner', 'dev-runtime');
  const destination = path.join(cache, `electron-${version}-${fingerprint}`);
  const ready = () => fs.existsSync(path.join(destination, '.complete'))
    && files.every(file => {
      try { return fs.statSync(path.join(destination, file.relative)).size === file.size; }
      catch { return false; }
    });
  if (ready()) return path.join(destination, 'electron.exe');
  // 已存在但不完整的缓存不复用，也不删除可能仍在运行的环境。
  if (fs.existsSync(destination)) throw new Error(`测试运行环境不完整：${destination}`);

  console.log('正在准备测试版运行环境，首次启动需要片刻…');
  fs.mkdirSync(cache, { recursive: true });
  const staging = fs.mkdtempSync(path.join(cache, '.prepare-'));
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (const file of files) {
      const target = path.join(staging, file.relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const input = fs.openSync(path.join(source, file.relative), 'r');
      try {
        // 新文件继承用户目录权限，不复制开发目录附带的完整性标签。
        const output = fs.openSync(target, 'wx');
        try {
          let length;
          while ((length = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
            fs.writeFileSync(output, buffer.subarray(0, length));
          }
        } finally { fs.closeSync(output); }
      } finally { fs.closeSync(input); }
    }
    fs.writeFileSync(path.join(staging, '.complete'), fingerprint);
    try { fs.renameSync(staging, destination); }
    catch (error) { if (!ready()) throw error; } // 同时启动时复用先完成的缓存。
  } finally {
    const relative = path.relative(cache, staging);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      fs.rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
    }
  }
  return path.join(destination, 'electron.exe');
}

function fail(error) {
  console.error(`鱼鱼日程启动失败：${error.message}`);
  process.exitCode = 1;
}

try {
  const executable = prepareRuntime();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [appDir, ...process.argv.slice(2)], {
    cwd: appDir, env, detached: true, stdio: 'ignore', windowsHide: true,
  });
  const startup = setTimeout(() => child.unref(), 1800);
  child.once('error', error => { clearTimeout(startup); fail(error); });
  child.once('exit', code => {
    clearTimeout(startup);
    if (code !== 0) fail(new Error(`Electron 提前退出（${code}）。`));
  });
} catch (error) { fail(error); }
