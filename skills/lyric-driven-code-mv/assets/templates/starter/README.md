# 12 秒像素 MV 最小工程

这是原创技术演示《未抵达的灯》，用于检验纯帧、像素摄像机、转场、字幕与导出。双语句子是演示文案，时间是演示时点；`demo-beat.wav` 由代码原创合成，只演示节奏，不对应任何真实歌曲或歌词。开头会烧入“演示时点 · 原创合成节奏”。

不需要 npm 包、API Key、账号、外部服务或下载字体。需要本机已有 Node.js、ffmpeg（含 libx264、AAC、libass）和 ffprobe。模板不会安装软件。现有 HyperFrames、Remotion、Canvas 或其他框架工程应沿用原工程；通过纯帧接口适配所需能力，不强制替换框架。

目录是扁平结构，方便网页上传或复制：`frame.mjs` 共享纯帧、`png.mjs` 内置 PNG 编码、`export.mjs` 导出与本地预览、`preview.html` 浏览器预览、此说明。不要把生成的 MP4、WAV 或 PNG 上传到 skill 仓库。

## 运行

在此模板目录中执行：

```powershell
node export.mjs --help
node export.mjs --out C:\你的输出目录\check.mp4 --width 640 --height 360 --fps 10
node export.mjs --out C:\你的输出目录\paper-boat-demo.mp4
node export.mjs --preview
```

最后一条仅启动 `http://127.0.0.1:8765`，自行打开即可预览，Ctrl+C 停止；不会自动启动浏览器。不要直接用 `file://` 打开 HTML，浏览器可能阻止模块导入。预览不带声音。

默认 384×216 像素场景，以最近邻放大至 1920×1080，30 fps，360 帧，12 秒。小尺寸功能检查使用 640×360；正式像素稿建议输出网格的整数倍（如 1920×1080），避免不同宽度的像素列。导出先把 PNG 写入 ffmpeg `image2pipe`，不用把所有帧落盘；字幕在放大后由 ASS 绘制，音轨为 48 kHz 原创 WAV，最终编码 H.264 / yuv420p + AAC。文件编码及验收全部成功后才替换 `--out`。

保留 PNG、中断后恢复：

```powershell
node export.mjs --frames-dir C:\你的输出目录\frames --frames-only
node export.mjs --frames-dir C:\你的输出目录\frames --resume --out C:\你的输出目录\paper-boat-demo.mp4
```

恢复时参数必须与首次一致，包括 fps、输出尺寸、seed、字体及源码；示例默认参数正好一致。保存的 `render-config.json` 对配置与源码做 SHA-256 指纹，并保存每帧索引、文件名和 PNG 字节 SHA-256。恢复逐帧核对可信哈希、PNG 签名、CRC、解压行和 384×216 尺寸，拒绝同尺寸错置、混用或损坏。缺失帧会重算，已有可信帧复用；旧目录或中断留下的图片若没有逐帧可信指纹会重新生成，不会静默复用。目录已存在不会被视为“已经完成”，更改参数应使用新目录。临时 WAV/ASS 与临时 MP4 在输出路径旁生成并清理；帧目录模式会保留演示 WAV、ASS、PNG 与配置供恢复。

## 纯帧与摄像机

```javascript
import { renderFrame, FB, renderTimelineFrame } from './frame.mjs';
const { width, height, data } = renderFrame(5.55);
// data: Uint8ClampedArray，按行RGBA8，长度 width*height*4。
// 可选：renderFrame(t, { seed, width, height, camera: {x,y,zoom} })。
const fb = new FB().setCam(192, 108, 1);
fb.rect(-192, -108, 768, 432, [19, 30, 51]);
// X(x)、Y(y) 及 rect/line/circle/poly 共享世界→屏幕整数取整。
```

`renderFrame(t)` 仅由绝对秒数、显式 seed 与可选配置决定。每帧重新建立缓冲；随机量按 seed+索引计算，不使用累积 PRNG、帧间缓存、`Date.now()` 或“上一帧状态”。乱序 seek 与先后渲染必须得到相同 RGBA。导出取 `i/fps`，`i=0..359`；`t=12` 只供预览保持最终状态，不额外导出一帧。负时间裁到 0，超出结尾裁到 12，NaN/Infinity 拒绝。

世界矩形留边为 `[-192,576]×[-108,324]`，保证模板规定的摄像机范围：中心 x=120–264、y=70–146、zoom=0.75–1.25。FB 初始透明；世界真正覆盖视野四边，测试能够发现留边不足。自定义镜头越过该范围前，应重新计算世界留边；不要靠黑色清屏隐藏空洞。角色、纸船、灯、倒影与星空都走 FB 的同一摄像机变换。

`renderScene` 会拒绝超出此摄像机范围的配置。底层 `FB.setCam` 也拒绝非有限坐标、绝对值超过1000000的中心及0.01–64之外的 zoom；图元坐标与半径同样有限并有上限。直线先裁剪再步进，圆只遍历落在视口内的范围，避免极端缩放或巨大半径造成无界循环。

已有工程可把自己的场景接给 `renderTimelineFrame(t, drawScene, options)`。`drawScene(index, local, options)` 返回同尺寸 RGBA；若原框架已能乱序求值、转场和输出，就保留其实现，并按下面时窗契约验收。

## 接入真实歌曲

当前 `export.mjs` 只合成上述示例音轨，时间线与像素画法也来自本模板；它不会读取 storyboard JSON，因此只修改 JSON 不会改变导出的影片。接入真实歌曲时，需要同时修改 `export.mjs` 的 WAV 生成或 ffmpeg 音频输入、`frame.mjs` 的 `SCENES` / `CAPTIONS` / 场景画法，以及 `createASS` 和预览中的开头演示提示，再与 storyboard JSON 的音轨路径、片段时间、歌词、事件和转场保持同步。真实音轨应为所选片段的已授权素材；依据已核对的时点更新演示提示，不把本示例合成节奏冒充实测结果。已有框架的音轨和字幕入口优先继续使用原工程。

## 两镜与转场

0–6 秒：左岸人物目标是送灯到对岸，推船后松手；水流拐弯但船继续移动，结果到达河心。6–12 秒：右岸人物想等船抵达并伸手，船在触岸前被弯流推回；人物改用自己的岸灯回应，最终纸船仍停在两岸之间。第二次“送一盏小灯到对岸”新增目标受阻及隔岸回应，不能只重复第一镜动作。

```javascript
exit: { type: 'ripple', dur: 0.9, origin: [0.55, 0.62] }
// type 可为 dissolve / ripple / water / cut；cut 的 dur 必须为0。
```

前镜出镜窗口严格为 `[end-dur,end)`，本例 `[5.1,6)`。在窗口内前镜仍以当前位置 `local=t-start` 求值；下一镜固定 `local=0` 作为静态预卷。转场占前镜尾部，不能额外增加 0.9 秒，也不能令下一镜动作偷跑。6 秒时切换至下一镜第0秒，12秒结束。进度≤0完整前镜，≥1完整后镜；末镜是 `cut,dur:0`，没有不存在的第三镜，也没有未解释的黑场。`origin` 为视口归一化坐标，ripple 从指定点扩散；water 从上向下带波纹，dissolve 做混合。

## 字幕与验收

中文与英文文案保存在 `CAPTIONS`。导出 ASS 的 `PlayResX/Y` 等于最终输出尺寸，最近邻放大画面后才加字幕。底部双语字幕保留约7%下边距、8%左右安全区，带暗板；演示提示在上部安全区。不要先在384网格画中文后一起放大。

Windows 默认使用已有 `Microsoft YaHei`；可通过 `--font "已有字体名称"` 指定本机字体。浏览器与 ffmpeg 的字体选择和排版可能随系统变化，模板不下载字体。导出检测到缺字会失败并提示换用已安装字体，交付字幕以成片为准。

导出自动用 ffprobe 核对时长、尺寸、H.264/AAC及像素格式，并用 ffmpeg 解码全片。交付前仍需抽帧看开头提示、转场边界、第二镜动作、最终未抵达状态以及字幕暗板。

```powershell
ffprobe -v error -show_format -show_streams -of json C:\你的输出目录\paper-boat-demo.mp4
ffmpeg -v error -i C:\你的输出目录\paper-boat-demo.mp4 -f null -
ffmpeg -y -ss 5.55 -i C:\你的输出目录\paper-boat-demo.mp4 -frames:v 1 C:\你的输出目录\transition.png
ffmpeg -y -ss 11.9 -i C:\你的输出目录\paper-boat-demo.mp4 -frames:v 1 C:\你的输出目录\ending.png
```
