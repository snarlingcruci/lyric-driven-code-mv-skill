# 音频候选与素材授权

## 离线音频分析

在 skill 目录使用已有 Node 和 FFmpeg，不安装包或模型：

```sh
node scripts/analyze-audio.mjs "path with spaces/song.mp3" --start 37.2 --duration 12 --out work/analysis.json
```

默认解码为 8 kHz 单声道 float PCM，可用 `--sample-rate 16000`；`--ffmpeg` 指定现有可执行文件。单次最多 600 秒，超长输入拒绝，整曲较长时分段分析并保留各段偏移。16 kHz 解码 PCM 最多约 38.4 MB，拼接峰值两份约 76.8 MB，另有分析/JSON 内存。

报告 `status:"draft"`、`timebase:"clip"`；`sourceOffset` 保存 `--start`，所有输出时间已是片段秒。

| 输出 | 用途与限制 |
|---|---|
| `energy.envelope` 的 at/rms/normalized | 找强弱与留白；不能断言某个峰值就是某个词 |
| `pauses` 的 start/end/maxRms | 候选低能量区；伴奏可能让人声停顿不明显 |
| `onsets` 的 at/strength | 能量上升候选，可能来自鼓点或其他伴奏 |
| `tempo` 的 bpm/confidence/phaseSeconds/candidates/ambiguities | 节拍网格候选与半速/双速歧义；置信度为未校准启发式评分 |
| `warnings`、`limits` | 证据不足及资源上限 |

网格为 `phaseSeconds + n*60/bpm`，仅取 `[0,duration)` 内候选。静音、恒定音、极弱或过短证据可返回 `bpm:null`，此时 beats 留空；不要填造 BPM。复杂歌曲可能变速，单一 BPM 不能覆盖所有段落。

脚本不识别人声文本、不提供逐词对齐，也不证明试听完成。将选择的方法、误差来源与待核对重音写进分镜 `music.evidence`；实际人工核对后才改 `verified` 并记录人和时间。

## 获取与记录

先确认用途（内部预览、公开发布、商用、改编），再搜索逐曲授权清楚的来源。保存曲目页、许可页、版本/作者及下载日期；下载本地资源后复核文件与版本。作品、录音和含采样/混音的材料可能有不同权利，不能仅凭可下载就认定可发布。

| 来源 | 如何获取和核实 |
|---|---|
| [ccMixter](https://ccmixter.org/) / [dig.ccMixter](https://dig.ccmixter.org/) | 从曲目页选文件，逐曲查看许可和署名；参考其 [署名说明](https://ccmixter.org/how-to-attribute-ccmixter-tracks) |
| [Free Music Archive](https://freemusicarchive.org/) | 曲目页核对作者、许可与下载；先读 [License guide](https://freemusicarchive.org/License_Guide/) |
| [Internet Archive](https://archive.org/) | 核对上传者、曲目页和来源证据；上传站点本身不证明权利。可按其 [Metadata API](https://blog.archive.org/2013/07/04/metadata-api/) 获取条目元数据与文件列表，再核对许可 |
| 原创或用户授权文件 | 记录作者、具体使用范围和授权依据；用户拥有文件不自动表示拥有全部发布权利 |

不要维护未经验证的固定音频直链或假设整站统一许可。Internet Archive 公开元数据入口为 `https://archive.org/metadata/{identifier}`，文件入口为 `https://archive.org/download/{identifier}/{filename}`；用实际元数据提供的文件名并做 URL 编码，不能猜测文件。其他站点优先使用当前官方页面的下载入口，不臆造 API。

截至 2026-11-17，[FreePD 原站](https://freepd.com/)显示已关闭，不能再当作稳定音源推荐。寻找其旧曲目的替代页面时仍要核对具体文件与许可。

## 许可阅读起点

下表仅帮助筛选，发布仍以实际许可、权利与用途为准；优先读 [Creative Commons 官方说明](https://creativecommons.org/share-your-work/) 及具体许可正文。

| 许可要素 | 制作 MV 时关注 |
|---|---|
| BY | 保留标题/作者、来源、许可链接及修改说明；不要暗示原作者背书 |
| NC | 限制商业用途，按实际使用场景核对；不能把“免费上传”直接视为非商业 |
| ND | 音乐与动态影像同步涉及改编；不能直接依赖 ND 发布 MV，需另获许可 |
| SA | 改编的分享条件需沿具体许可核对，保留适用许可 |
| CC0 / 公有领域 | 核对适用材料、来源与可能仍存在的其他权利；不写“任何用途都无条件” |

CC BY-ND 4.0 [许可正文](https://creativecommons.org/licenses/by-nd/4.0/legalcode.en)把音乐与动态影像同步列入 Adapted Material；不要把“歌没有剪辑”作为排除改编的理由。未知、冲突或未满足条件的许可写成待解决项，先交付有明确限制的预览，不作为公开成片发布。

```json
{
  "audio": {
    "path": "assets/track.wav",
    "timebase": "source",
    "license": "CC BY 4.0",
    "credit": "曲目标题 — 作者；本片截取并同步至画面",
    "url": "https://example.org/the-actual-track-page",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "use": "publish"
  }
}
```

上面的 example.org 是待替换示例，不能作为真实授权依据。原创素材可写 `provenance:"original"`，保留 `license,credit,use` 并说明作者和范围，不强制外部链接。普通校验缺项提示；`--delivery` 或 publish/public/commercial 用途缺必要记录会失败。静态校验只能验证记录完整性，不能认定授权有效。

片尾或发布说明可使用：`音乐：《标题》— 作者｜来源：曲目页｜许可：名称 + 链接｜修改：截取/淡入淡出/同步画面`。保存本地资源清单，署名位置与方式按具体许可核对；仓库不打包未经允许的歌曲或参考片。
