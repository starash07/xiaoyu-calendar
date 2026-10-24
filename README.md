# 小鱼日程表

一款 Windows 桌面日程工具，包含桌面挂件、月历主界面、日程提醒和系统托盘。

## 主要功能

- 按月查看日程，支持跨天连续日程条。
- 新建、编辑、完成、置顶和删除日程。
- 待确认提醒卡片与日程详情。
- 桌面挂件可自由摆放或钉在桌面。
- 主窗口支持顶部、左侧和右侧吸附收起。
- 可调整字号、颜色、挂件宽度与玻璃外观。
- 所有日程只保存在本机。

## 启动

双击根目录的 `启动日程挂件.cmd`。

首次运行或更换电脑后，如果缺少依赖，启动脚本会自动安装。手动启动方式：

```powershell
cd app
npm ci --include=dev
npm start
```

需要 Windows 10/11 和 Node.js 22.12 或更高版本。

## 数据与图标

- 本机日程和设置：`app/.data/`
- 快捷方式图标：`app/assets/icons/app-icon.ico`
- 托盘图标：`app/assets/icons/tray-icon.png`

请备份 `app/.data/` 后再迁移或清理项目。

## 目录

```text
app/
├─ assets/icons/     应用、快捷方式与托盘图标
├─ main/             Electron 主进程、窗口、数据与托盘
├─ preload/          页面与主进程的安全接口
├─ renderer/         桌面挂件、主界面、设置和共享样式
├─ scripts/          项目检查脚本
├─ package.json      依赖与启动命令
└─ package-lock.json 锁定依赖版本

README.md            项目说明
启动日程挂件.cmd      Windows 启动入口
```

依赖、缓存和本机数据不会提交到 Git。
