# 歌词驱动代码 MV Skill

将歌曲的含义变成角色任务、道具、状态反馈和结果，再用音乐时间线控制动画落点。适用于像素游戏风代码音乐视频，支持 HTML/Canvas/SVG/HyperFrames 和用户选定的 React/Remotion 工程。

此 skill 整理自《圣诞星》代码音乐 MV 分析报告中的通用方法。参考作者为墨菲音乐MV，参考页面为 [圣诞星—周杰伦](https://www.douyin.com/video/7708745047155654650)。实现路线属于复现建议，未取得原作者源码或证实其框架。仓库提供原创示例，不附带歌曲、参考视频、截图或完整歌词。

## 内容

- [SKILL.md](skills/lyric-driven-code-mv/SKILL.md)：工作流程与完成标准。
- `references/`：歌词分镜和时间坐标、像素叙事、依赖与成片检查。
- [storyboard-example.json](skills/lyric-driven-code-mv/assets/storyboard-example.json)：原创 12 秒分镜，展示重复句如何增加信息。
- [validate-storyboard.mjs](skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs)：零第三方依赖的结构校验器。

## 安装

把 `skills/lyric-driven-code-mv` 整个目录复制到 Codex 的 skills 目录。Windows 默认可使用下面命令；如设置了 CODEX_HOME，会采用该位置。已有同名 skill 时先检查再手动合并。

```powershell
$taskSkillRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $env:USERPROFILE '.codex/skills' }
New-Item -ItemType Directory -Path $taskSkillRoot -Force | Out-Null
$taskSkillTarget = Join-Path $taskSkillRoot 'lyric-driven-code-mv'
if (Test-Path -LiteralPath $taskSkillTarget) { throw '同名 skill 已存在，请先检查内容再合并。' }
Copy-Item -LiteralPath './skills/lyric-driven-code-mv' -Destination $taskSkillTarget -Recurse
```

安装 skill 本身不安装视频框架。制作视频时才选择一条路线，先检查已有环境，并说明新增包或浏览器下载。

## 调用

```text
使用 $lyric-driven-code-mv。
歌曲：我提供的本地音频；歌词：我提供的校对文本。
范围：原曲 37.2–49.2 秒，横屏 1920×1080，30 fps。
用 React + Remotion，先做 12 秒代表片段。
先给出歌词时间、目标→行动→反馈→结果分镜与最少依赖；
随后实现可任意跳播的动画，导出并完成媒体及画面验收。
```

仅需报告、分镜或调整已有工程时，可直接指定对应范围。示例 JSON 的音乐时点标记为 illustrative，换歌后需要试听核对。

## 校验

在仓库根目录运行（仅需要 Node）：

```powershell
node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs skills/lyric-driven-code-mv/assets/storyboard-example.json
node --test
```

校验器检查时间、镜头覆盖、角色/装束/道具引用及整数像素缩放；语义、真实音乐同步和成片质量需要按 skill 完整预览与验收。本仓库为 skill 包及分镜示例，视频渲染项目在使用时按选定框架创建。
