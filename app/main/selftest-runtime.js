// 自测只把故障写入独立测试目录；日志管道中断时不得弹出 Electron 错误框。
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const P = require('./paths');

function fail(error) {
  try {
    fs.mkdirSync(P.SHOTS, { recursive: true });
    fs.writeFileSync(path.join(P.SHOTS, 'selftest-fatal.json'), JSON.stringify({
      time: new Date().toISOString(), error: String(error?.stack || error),
    }, null, 2));
  } finally { app.exit(1); }
}

function install() {
  if (!P.SELFTEST) throw new Error('Selftest runtime requires --selftest');
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', error => { if (error.code !== 'EPIPE') fail(error); });
  }
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
}

function log(...args) {
  try { console.log(...args); }
  catch (error) { if (error.code !== 'EPIPE') throw error; }
}

module.exports = { install, log };
