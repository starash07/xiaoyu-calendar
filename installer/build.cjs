// electron-builder 负责安装、升级与卸载；轻量 WPF 窗口提供统一的安装界面。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'app');
const output = path.join(root, 'dist');
const engineDir = path.join(output, 'engine');
const preview = process.argv.includes('--preview');
const uiOnly = process.argv.includes('--ui-only');
const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));

function run(command, args, cwd = root, env = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`构建失败，退出码 ${result.status}`);
}

if (process.platform !== 'win32') throw new Error('请在 Windows 上构建安装包。');
fs.mkdirSync(output, { recursive: true });
const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const compiler = path.join(framework, 'csc.exe');
if (!fs.existsSync(compiler)) throw new Error('缺少 Windows .NET Framework 4.x 编译工具。');

if (!preview && !uiOnly) {
  const cli = require.resolve('electron-builder/cli.js', { paths: [appDir] });
  // NSIS 构建时会运行卸载器生成程序，给它独立的临时目录，避免依赖系统 TEMP。
  const buildTemp = fs.mkdtempSync(path.join(output, 'nsis-temp-'));
  try {
    run(process.execPath, [cli, '--config', path.join(__dirname, 'electron-builder.cjs'), '--win', 'nsis', '--x64', '--publish', 'never'], appDir,
      { TEMP: buildTemp, TMP: buildTemp });
  } finally {
    const relative = path.relative(output, buildTemp);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      fs.rmSync(buildTemp, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

const engine = path.join(engineDir, `鱼鱼日程-${pkg.version}-engine.exe`);
if (!preview && !fs.existsSync(engine)) throw new Error('未找到安装引擎，请先完整构建。');
const payloadHash = preview ? '' : crypto.createHash('sha256').update(fs.readFileSync(engine)).digest('hex');
const generated = path.join(output, 'BuildInfo.cs');
fs.writeFileSync(generated, `using System.Reflection;\n[assembly: AssemblyTitle("鱼鱼日程安装程序")]\n[assembly: AssemblyProduct("鱼鱼日程")]\n[assembly: AssemblyCompany("StarAsh")]\n[assembly: AssemblyVersion("${pkg.version}.0")]\nnamespace YuyuPlanner.Setup { internal static class BuildInfo { internal const string Version = "${pkg.version}"; internal const string PayloadHash = "${payloadHash}"; internal const bool Preview = ${preview}; internal const long RequiredBytes = 1073741824L; } }\n`);
const destination = path.join(output, preview ? '鱼鱼日程-安装预览.exe' : `鱼鱼日程-${pkg.version}-Setup.exe`);
const references = ['System.dll', 'System.Core.dll', 'System.Xaml.dll', 'System.Windows.Forms.dll',
  'WPF/WindowsBase.dll', 'WPF/PresentationCore.dll', 'WPF/PresentationFramework.dll'];
const args = ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output',
  `/out:${destination}`, `/win32icon:${path.join(appDir, 'assets/icons/app-icon.ico')}`,
  `/win32manifest:${path.join(__dirname, 'setup.manifest')}`,
  ...references.map(file => `/reference:${path.join(framework, file)}`),
  `/resource:${path.join(appDir, 'assets/icons/app-icon.png')},AppIcon.png`,
  `/resource:${path.join(__dirname, 'assets/calendar-mark.png')},CalendarMark.png`,
  path.join(__dirname, 'preview/Preview.cs'), generated];
if (!preview) args.push(`/resource:${engine},InstallEngine.exe`);
run(compiler, args);
console.log(`\n已生成：${destination}`);
