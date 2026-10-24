@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
title 小鱼日程表

rem 始终从脚本所在目录启动，支持换电脑、换盘符和带空格的路径。
pushd "%~dp0app" >nul 2>&1
if errorlevel 1 (
  echo 找不到 app 文件夹，请将此启动文件放在完整的项目目录中。
  pause
  exit /b 1
)
if not exist "package.json" (
  set "launchError=缺少 app\package.json，请重新同步完整项目。"
  goto failed
)

if not exist "node_modules\electron\dist\electron.exe" goto install
if not exist "node_modules\electron\path.txt" goto install
if not exist "node_modules\koffi\package.json" goto install
goto launch

:install
where node.exe >nul 2>&1
if errorlevel 1 goto needNode
where npm.cmd >nul 2>&1
if errorlevel 1 goto needNode
node.exe -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)"
if errorlevel 1 goto needNode
rem Electron 下载默认不读取 Windows 代理；优先沿用环境变量，否则读取系统现有代理。
if defined HTTPS_PROXY goto proxyReady
if defined HTTP_PROXY goto proxyReady
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -NonInteractive -Command "$target = [uri]'https://github.com'; $proxy = [Net.WebRequest]::GetSystemWebProxy().GetProxy($target); if ($proxy.Authority -ne $target.Authority) { $proxy.AbsoluteUri }"`) do set "HTTPS_PROXY=%%P"

:proxyReady
if defined HTTPS_PROXY set "ELECTRON_GET_USE_PROXY=1"
if defined HTTP_PROXY set "ELECTRON_GET_USE_PROXY=1"
echo 首次运行或运行文件缺失，正在安装小鱼日程表所需的依赖。
echo 需要联网下载 Electron，请稍候，完成后会自动启动。
if exist "package-lock.json" (
  call npm.cmd ci --include=dev
) else (
  call npm.cmd install --include=dev
)
if errorlevel 1 goto installFailed
if not exist "node_modules\electron\dist\electron.exe" goto installFailed
if not exist "node_modules\electron\path.txt" goto installFailed
if not exist "node_modules\koffi\package.json" goto installFailed

:launch
rem 避免从开发工具继承此变量后，把 Electron 当成普通 Node.js 运行。
set "ELECTRON_RUN_AS_NODE="
start "" /D "%CD%" "%CD%\node_modules\electron\dist\electron.exe" "%CD%" %*
if errorlevel 1 (
  set "launchError=无法启动 Electron，请查看上方错误信息。"
  goto failed
)
popd
exit /b 0

:needNode
set "launchError=首次运行需要 Node.js 22.12 或更高版本，请从 https://nodejs.org 安装后重新打开本文件。"
goto failed

:installFailed
set "launchError=运行依赖安装未完成，请查看上方错误并检查网络，然后重新打开本文件重试。"

:failed
echo.
echo 启动失败：%launchError%
popd
pause
exit /b 1
