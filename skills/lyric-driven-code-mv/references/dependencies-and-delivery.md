# 依赖与交付

## 一种路线，最少依赖

先检查现有工程与命令：Node、npm、FFmpeg、FFprobe、package.json、锁文件及渲染浏览器。版本按当前官方要求选择并锁定，避免把一次本机检查结果当成通用版本要求。

| 路线 | 必需 | 按需要增加 |
|---|---|---|
| HTML + Canvas/SVG + HyperFrames | Node/npm、hyperframes、其支持的渲染浏览器、本地音频/素材 | 项目未包含而确实要使用的 GSAP 等时间线库 |
| React + Remotion | React/React DOM、remotion、@remotion/cli、支持的浏览器；按当前官方音轨方案使用 @remotion/media | TS/类型包、音频可视化、字幕或字体工具 |
| 分镜及结构校验 | Node；本 skill 脚本仅用内置模块 | 不需要视频框架、Python、API Key |
| 媒体处理与验收 | FFmpeg、FFprobe | 无 |

Canvas/SVG 为浏览器原生能力。已有浏览器不代表渲染框架支持的版本已配置。首次初始化或 `npx` 可能下载 npm 包及浏览器组件，执行前说明。Remotion 家族包保持相同版本，React 组合跟随官方脚手架；商业使用资格按官方授权核实。

要自动分析歌曲时才考虑 librosa/soundfile 或 Whisper/faster-whisper 及模型；自动结果仍需试听核对。需要大量精灵管理时考虑 PixiJS，需要实际 3D 才考虑 Three.js/Blender，需要互动游戏才考虑 Phaser/物理引擎。外部生成服务仅在用户选择素材生成时使用，先说明 Key、额度和费用。

目标环境有对应 skill 时，HTML 视频先读 `hyperframes` 再按所用功能选 core/animation/cli/audio 等；React 视频先读 `remotion-best-practices` 路由。音乐分镜可配合 `music-to-video`，参考片分析可配合 `video-understand`，处理媒体用 `ffmpeg`/`video-edit`。这些 skill 不存在时，直接查官方契约并用环境已有工具完成，不要求安装整套个人 skill。

## 渲染契约

HyperFrames 使用有限时长、可寻址时间线；GSAP 以暂停/可 seek 方式接入，由框架控制时间。Remotion 使用当前帧、interpolate/spring 及固定种子 random。沿用现有工程的受支持渲染入口，保证音频、字体和图片加载完成后捕获帧。

让资源本地化、保存素材来源及使用范围。原作者工具未知时说明所选方案是复现建议。借鉴叙事方法，设计自己的角色、场景和镜头；仓库模板无需打包参考歌曲或视频。

## 成片检查

以下命令在视频工程根目录运行，路径和帧率按工程调整；先创建 `work/check`。校验 JSON 成功并不表示成片通过。

```powershell
New-Item -ItemType Directory -Path "work/check" -Force | Out-Null
ffprobe -v error -show_format -show_streams -of json "outputs/final.mp4"

# 每半秒抽一帧，另补首尾、转场及动作落点。
ffmpeg -i "outputs/final.mp4" -vf "fps=2" "work/check/sample_%04d.png"

# 将 3.5 替换为该片实际关键时刻。
ffmpeg -ss 3.5 -i "outputs/final.mp4" -frames:v 1 "work/check/action.png"

# 导出最后一个视频帧。
ffmpeg -i "outputs/final.mp4" -update 1 "work/check/last.png"

# 完整解码检查。
ffmpeg -v error -i "outputs/final.mp4" -f null -
```

FFprobe 对照目标检查视频/音频流、时长、画幅、帧率、像素格式、采样率及声道；容器/编码器的微小尾部差异按实际帧率判断，不把零误差作为通用条件。检查第一帧与最后一帧，及每个转场前后至少一帧；必要时按帧号准确提取。最终完整播放，核对歌曲版本、源偏移、重要动作落点、字幕、削波/异常静音与叙事余韵。

确定性检查在同一渲染环境重复渲染若干帧，并倒序/随机跳转后比较同帧像素，重点覆盖粒子、HUD 和跨场景状态。音视频流与解码正常只证明媒体技术状态，不证明语义或音乐同步。

验收记录写实际目标、所查帧/落点、完整播放结果、媒体参数与未解决项。素材缺失、音乐尚未核对或只完成分镜时，如实标注交付阶段。

## 官方参考

- HyperFrames 源码与当前项目契约：https://github.com/heygen-com/hyperframes
- Remotion 动画：https://www.remotion.dev/docs/animating-properties
- Remotion Sequence：https://www.remotion.dev/docs/sequence
- 音轨与源裁剪：https://www.remotion.dev/docs/media/audio
- 固定随机数：https://www.remotion.dev/docs/random
- 授权：https://www.remotion.dev/docs/license
- Canvas 精灵表：https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage
- 像素缩放：https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled
- FFmpeg 与 FFprobe：https://ffmpeg.org/documentation.html
