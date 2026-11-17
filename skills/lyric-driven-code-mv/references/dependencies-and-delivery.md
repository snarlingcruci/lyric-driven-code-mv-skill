# 依赖与交付

## 一种路线，最少依赖

先检查已有 Node、FFmpeg、FFprobe、工程依赖/锁文件及浏览器。版本按当前官方要求选择，不能把本机版本当成通用要求。

| 路线 | 必需 | 按需要增加 |
|---|---|---|
| 内置 starter / 音频候选 | Node、FFmpeg，导出验收用 FFprobe | 无第三方包、API、模型或浏览器下载 |
| 分镜及确定性校验 | Node；RGBA 渲染适配模块 | 无 |
| HTML + Canvas/SVG + HyperFrames | Node/npm、hyperframes、受支持渲染浏览器、本地资源 | 确实使用的 GSAP 等库 |
| React + Remotion | React/React DOM、remotion、@remotion/cli、支持的浏览器，音轨按官方方案 | 类型、字幕、字体等需要的工具 |

Canvas/SVG 是浏览器原生能力；已有浏览器不代表框架要求的版本已配置。`npx`、脚手架或首次渲染可能下载包/浏览器，执行前说明。Remotion 相关包保持兼容版本、授权按官方说明核实。额外 Python 分析、模型、PixiJS/Three.js、真实游戏系统只在任务需要时选用，不为离线候选分析默认安装。

使用目标环境已有对应 skill：HTML 视频先读 hyperframes 路由，React 视频先读 remotion-best-practices，媒体检查可用 ffmpeg；这些个人 skill 缺失时沿用官方契约与已有工具，不要求整套安装。

## 渲染与恢复

每帧由时间求值。HyperFrames 时间线可 seek；Remotion 用当前帧与固定种子；starter 的 `renderFrame(t)` 输出低分辨率 RGBA，Node zlib 编码 PNG，FFmpeg 整数放大后烧入高分辨率 ASS 字幕。`--storyboard` 统一项目参数、时点和音乐状态；仅 `illustrative` 且没有指定音频时合成原创演示节奏，其他状态使用真实音频。

浏览器捕获前等待 `document.fonts.ready` 及实际使用的图片、音频和其他资产完成加载/解码，随后渲染 2–3 帧预热，再开始像素比较或导出。预热解决字体懒加载和首次光栅初始化，页面时钟与上一帧状态仍须排除。验收和导出固定同一浏览器版本、启动参数、视口、设备缩放与字体/资源，记录这一 profile。

**2D Canvas 的逐像素验收与导出**采用固定的软件光栅 profile，例如 Chromium 启动参数：

```js
args: ['--disable-accelerated-2d-canvas', '--disable-gpu']
```

部分 2D 操作首次出现会切换光栅路径，GPU 与软件舍入可让相同画面像素不同；固定 profile 后再判断是否为渲染状态漂移。WebGL、Three.js 等需要 GPU 的路线按框架支持配置并固定实际 profile，不把这组 2D 参数作为所有浏览器工程的要求。

QA CLI 默认每个抽样时间 `--warmup-frames 3`；API `runDeterminismQA` 默认 `warmupFrames:0` 保持兼容，需要预热时设为 2 或 3，0 禁用。预热差异在 `warmupMismatch/warmupStatus` 中保留并提示，正式四种顺序仍一致可通过；正式测量持续不一致仍失败。持有浏览器、连接或管道的适配模块导出 `async cleanup()`，CLI 在成功和失败结束时均调用；直接使用 API 时传 `teardown` 释放自己持有的资源。

| 产线 | 适用与取舍 |
|---|---|
| PNG/截图落盘 | 长片可恢复，占磁盘。starter `--frames-dir work/frames` 保存每帧；`--resume` 核对配置、JSON/音频内容与 PNG，继续缺失帧。改变输入或渲染代码时用新目录 |
| PNG 管道直出 | 减少文件读写，适合短片；中断需重来。starter 默认 `image2pipe`，有背压，不承诺固定吞吐速度 |

浏览器工程可沿用受支持截图入口落盘或将编码帧送 FFmpeg stdin，不要逐帧重载资源。恢复不能只看文件名存在；检查编码/尺寸和渲染配置。不要把截图工具绑定的固定耗时当性能保证。

## 可执行验收

先运行分镜校验与 QA，之后导出。以下在视频工程根目录运行，路径、关键时间按实际工程改；`work/check` 是中间目录。

```powershell
New-Item -ItemType Directory -Path 'work/check' -Force | Out-Null
ffprobe -v error -show_format -show_streams -of json 'outputs/final.mp4'

# 每5秒抽一帧，每张接触表20格；长片自动输出多张。
ffmpeg -i 'outputs/final.mp4' -vf 'fps=1/5,scale=384:-1,tile=5x4' -fps_mode vfr 'work/check/contact_%03d.png'

# 关键帧：每镜首/中/尾、动作峰值、转场开始/中点/结束前后。
ffmpeg -ss 5.55 -i 'outputs/final.mp4' -frames:v 1 'work/check/transition.png'
ffmpeg -i 'outputs/final.mp4' -vf 'select=eq(n\,0)' -frames:v 1 'work/check/first.png'
ffmpeg -i 'outputs/final.mp4' -update 1 'work/check/last.png'

# 完整音视频解码，不输出媒体文件。
ffmpeg -v error -i 'outputs/final.mp4' -f null -
```

很短的代表片段把接触表 fps 提高到 1；长片用 `fps=1/5,tile=5x4` 通看叙事，边界另外精查。准确关键帧可用 `select=eq(n\,帧号)`，避免只按秒估计。FFmpeg 新旧版本的输出帧同步选项可能不同，查看已有版本支持再用。

FFprobe 对照目标核对音视频流、时长、画幅、帧率、像素格式、采样率与声道；容器/编码器尾部小差异按帧率判断。完整解码查技术错误；接触表查叙事、首尾与转场关键帧查穿帮、字幕和摄像机边缘。

```sh
node path/to/skill/scripts/qa.mjs frame.mjs --duration 12 --fps 30 --storyboard storyboard.json --out work/qa.json
```

确定性报告覆盖所选时间的四种求值顺序。默认低分辨率帧检查世界层；高分辨率字幕/后处理另做重复导出或在适配模块中合成后比较。它不能替代播放和音画核对。

具备条件时完整播放，核对歌曲版本、源偏移、动作落点、逐字填充、异常静音/削波与留白；不能播放/试听时如实写检查范围，将待核对区间和内容记录为 `music.pendingChecks` 后交付 `draft`。交付记录包含实际目标、所查帧/落点、技术参数、许可/署名、状态及未解决项，不能用“FFprobe 正常”声称整片语义与音乐同步已通过。

## 官方参考

- [HyperFrames](https://github.com/heygen-com/hyperframes)
- [Remotion Sequence](https://www.remotion.dev/docs/sequence)、[音轨裁剪](https://www.remotion.dev/docs/media/audio)、[固定随机数](https://www.remotion.dev/docs/random)、[授权](https://www.remotion.dev/docs/license)
- [Canvas 像素缩放](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled)
- [FFmpeg / FFprobe](https://ffmpeg.org/documentation.html)
