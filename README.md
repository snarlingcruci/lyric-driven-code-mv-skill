# 歌词驱动代码 MV Skill

将歌词含义变成角色任务、道具、状态反馈和结果，再用音乐时间线控制强调。支持像素游戏风代码 MV，沿用 HTML/Canvas/SVG/HyperFrames 或用户选择的 React/Remotion 工程；没有工程时可从内置的 12 秒最小模板开始。

整理自《圣诞星》代码音乐 MV 分析报告的通用方法。参考作者为墨菲音乐MV，参考页面为 [圣诞星—周杰伦](https://www.douyin.com/video/7708745047155654650)。未取得作者源码或证实框架，路线属于实现建议。仓库只提供原创示例，不附带参考歌曲、视频、截图或完整歌词。

## 改进内容

- `illustrative / draft / verified` 交付规则，不能试听时可以交付写清方法与误差的草稿。
- Node 内置模块 + FFmpeg 的离线能量、停顿、起音、BPM/相位候选分析。
- 自包含 12 秒纸船与两岸灯光模板：纯帧、摄像机留边、结构化转场、高分辨率字幕、本地原创节奏、MP4 导出及 PNG 恢复。
- 兼容旧格式的分镜校验，新增跨镜歌词、显式踩拍、HUD 支撑、音乐证据与授权记录提示。
- 重复/逆序/乱序像素 QA，接触表与关键帧验收命令。

## 安装

复制整个 `skills/lyric-driven-code-mv` 目录到 Codex 的 skills 目录，模板与脚本都随安装保留。Windows 可用：

```powershell
$taskSkillRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $env:USERPROFILE '.codex/skills' }
New-Item -ItemType Directory -Path $taskSkillRoot -Force | Out-Null
$taskSkillTarget = Join-Path $taskSkillRoot 'lyric-driven-code-mv'
if (Test-Path -LiteralPath $taskSkillTarget) { throw '同名 skill 已存在，请先检查内容再合并。' }
Copy-Item -LiteralPath './skills/lyric-driven-code-mv' -Destination $taskSkillTarget -Recurse
```

安装 skill 不安装视频框架或模型。最小模板只用已有 Node、FFmpeg、FFprobe；选择其他框架、安装依赖/字体或使用 API 前先说明。

## 先跑通 12 秒

在仓库根目录运行：

```powershell
New-Item -ItemType Directory -Path 'work' -Force | Out-Null
Copy-Item -LiteralPath 'skills/lyric-driven-code-mv/assets/templates/starter' -Destination 'work/my-mv' -Recurse
node work/my-mv/export.mjs --out work/demo.mp4
node skills/lyric-driven-code-mv/scripts/qa.mjs work/my-mv/frame.mjs --duration 12 --fps 30 --out work/qa.json
```

默认输出 1920×1080、30 fps；开头标注“演示时点 · 原创合成节奏”。预览与恢复导出说明见 [starter README](skills/lyric-driven-code-mv/assets/templates/starter/README.md)。这是独立演示，CLI 不读取分镜 JSON，也不提供真实音轨参数。制作真实歌曲时按该说明改音轨输入、`SCENES/CAPTIONS`、场景画法和演示提示，并与分镜 JSON 保持同步后核对落点。

## 调用与检查

```text
使用 $lyric-driven-code-mv。
音频与校对歌词由我提供，截取原曲37.2–49.2秒。
横屏1920×1080、30fps，先做12秒代表片段。
沿用现有工程；无工程则复制starter。
先给出歌词时间、目标→行动→反馈→结果分镜；
实现任意跳播，导出并附上音乐证据状态与验收记录。
```

```powershell
node skills/lyric-driven-code-mv/scripts/analyze-audio.mjs 'path/to/song.wav' --start 37.2 --duration 12 --out work/analysis.json
node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs skills/lyric-driven-code-mv/assets/storyboard-example.json --delivery
node --test
```

分镜结构校验与像素一致性不证明授权有效、逐词对齐或已经试听。使用说明见 [SKILL.md](skills/lyric-driven-code-mv/SKILL.md)、[时间与分镜](skills/lyric-driven-code-mv/references/storyboard-and-timing.md)、[像素/字幕](skills/lyric-driven-code-mv/references/pixel-game-visuals.md)、[音频/授权](skills/lyric-driven-code-mv/references/audio-and-rights.md)、[依赖/验收](skills/lyric-driven-code-mv/references/dependencies-and-delivery.md)。
