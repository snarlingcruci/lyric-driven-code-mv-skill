# 时间与分镜

## 一套成片坐标

源音频从 `sourceOffset` 秒截取；歌词、节拍和事件统一成片秒：

```js
const t = frame / fps;
const sourceTime = sourceOffset + t;
const clipTime = annotatedSourceTime - sourceOffset;
```

只在数据入口换算一次。源片段 `[37.2,49.2)` 中句子 `[38,41)` 转为 `[0.8,3.8)`；重复出现的句子分配新 ID。已经剪好的音频记录 `audio.timebase="clip"` 并从零播放；源文件用 `"source"` 并裁掉 `sourceOffset`，避免重复偏移。分析脚本输出已是 clip 秒，不能再减偏移。

所有区间用 `[start,end)`。截断跨片段边界的歌词及事件，保留必要前置状态。让 `duration=durationFrames/fps`；最后一帧时间为 `(durationFrames-1)/fps`。嵌套场景的 `local=t-scene.start`，Remotion Sequence 内的帧已是局部帧，不能再减场景起点。

## 从含义到事件

先写一句“人物想要什么，因什么受阻或改变”，再设计可见演出。

| 含义 | 目标与行动 | 反馈与结果 |
|---|---|---|
| 珍惜纪念物 | 抱起礼物，选择保留，摆上搁板 | 完整礼物留下，保留标记出现 |
| 无法抵达 | 放出纸船，漂向远方，遇到阻碍 | 船停住，路线断裂，仍有距离 |
| 付出与消耗 | 攀升、奔跑、跨过风雪 | 距离增大，体力改变；变化对应动作 |
| 回忆变冷 | 触摸照片，结冰，再尝试解冻 | 图标失色、裂纹、温度格变化 |
| 重新联系 | 两地相望，光锥跨屏，同步举灯 | 连线完成后才共同动作 |

让动作准备稍早开始，峰值对准需要强调的音乐点。缓慢观察、句尾停留和间奏可以继续推进地点、记忆与关系。第一次送纸船失败，第二次揭示另一岸也在等待，可增加信息且保留遗憾；副歌不必全部变成成功。

## JSON 约定

`schemaVersion:1` 保持兼容，可增加工程特有字段。

| 字段 | 内容 |
|---|---|
| `schemaVersion`, `timebase` | `1`、`"clip"` |
| `project` | `fps,duration,sourceOffset,width,height,virtualWidth,virtualHeight,seed,audio` |
| `project.audio` | `path,timebase,provenance?,license,credit,url?,licenseUrl?,use`，授权说明见音频参考 |
| `lyrics[]` | `id,start,end,text`，可加 `zh,en`；有意跨镜可加 `allowSceneSplit:true,splitReason` |
| `music` | `status,beats[],sections[]:{id,start,end},evidence?,presentationNotice?,pendingChecks?` |
| `music.evidence` | `method,limitations,reviewer?,reviewedAt?`；最后两项用于人工核对 |
| `music.pendingChecks[]` | `{start,end,check}`：成片秒区间与具体未确认内容；草稿交付时必需非空 |
| `actors[]`、`props[]` | 稳定人物 ID 与 `costumes[]`；道具 ID 列表 |
| `scenes[]` | `id,start,end,meaning,location,objective,action,feedback,outcome,lyricIds,actors,props,events,exit` |
| `scene.actors[]` | `{id,costume}` 引用根人物表 |
| `scene.events[]` | `{at,action,hud?,sync?,lyricIds?,meaning?,support?}`；`at` 为成片秒，位于镜头内且升序 |
| `scene.exit` | `{type,dur,origin?,target?}`；类型为 cut/dissolve/ripple/water |

主场景连续覆盖 `[0,duration)`，不重叠、不留洞。角色装束明确指定；道具拥有、消耗与保留另记状态并核对。`scene.lyricIds` 引用与镜头相交的歌词；留白镜头可为空。

starter 的 `--storyboard` 直接读取项目配置、歌词、场景与 `exit`，绘图函数通过 `SCENE_RENDERERS[scene.id]` 注册。自带 `send/receive` 画法按镜头局部时长求值；新增 ID 需实现对应画法，JSON 只定义分镜而不生成美术。字幕只从当前 JSON 的 `text/zh/en` 读取；源音频路径与配置覆盖规则见 starter 说明。

`exitTransition` 自由文本仍接受，用于旧工程的叙事说明；新工程采用结构化 `exit` 确定时序。`cut` 的 `dur` 为 0，其他转场满足 `0 < dur < end-start`。`origin` 是两个 `[0,1]` 归一化坐标。`target` 默认为下一镜，也可明确写下一镜 ID；末镜非 cut 必须 `target:"background"`。

starter 当前实现通用分镜规范的执行子集：末镜仅支持 `exit:{type:"cut",dur:0}`。末镜 `target:"background"` 转场需由现有框架或自定义渲染适配实现；通用分镜校验与 starter 执行校验分别检查规范有效性和模板支持范围。

## 出口转场与预卷

```json
{ "exit": { "type": "water", "dur": 0.9, "origin": [0.55, 0.62] } }
```

前镜 `[0,6)` 时，转场窗口为 `[5.1,6)`。窗口中前镜继续按当前 `local=t-start` 求值，下一镜固定 `local=0` 预卷，再按遮罩合成。到 `t=6` 切入下一镜并从零正常播放。末镜淡至背景时只揭示项目定义的背景，不虚构下一镜。

转场占前镜尾段，不另加镜头时长，也不延长总片长。将结果动作安排在转场之前或确保遮罩期间仍可读。水面/地平线等跨镜元素通过相同世界坐标或明确遮罩对齐，重点查看转场中点与边界，避免双地平线。

## 语义提示的边界

- 句子被镜头边界切开会提示；有意拆镜时写 `allowSceneSplit:true` 与具体 `splitReason`，字幕层保持连续。不能由提示直接推断叙事一定错误。
- 仅 `event.sync:"beat"` 检查最近 `beats[]` 的距离，默认容差 80 ms。歌词起句或缓慢动作不必都踩拍；节拍表为空时提示证据不足。调用 `analyzeStoryboard` 的 `beatToleranceMs` 参数可调整容差。
- HUD 可由事件/镜头的 `lyricIds` 支撑，间奏可由 `event.meaning` 或 `support` 解释因果。`event.lyricIds` 必须与本镜相交，并由 `scene.lyricIds` 支持或在事件 `at` 时有效；预示动作可添加镜头级引用。引用可定位不等于含义已经正确。
- 普通模式返回提示；`--strict` 将全部警告升为失败。这是结构检查的退出码策略，草稿可以通过，状态仍为 `draft`。`--delivery` 检查许可记录与音乐证据，`audio.use` 为 publish/public/commercial 时也启用同样检查；两者通过均不证明许可有效或实际音画已经核对。

音乐状态遵循 SKILL.md 三档规则。`draft` 可以有空 beats；交付检查要求方法、限制与非空 `music.pendingChecks`。每项满足 `0 <= start < end <= duration`，`check` 写明尚未确认的句起止、节拍相位或动作落点；仅“待核对”或 `pending` 等占位文本会失败。例如：

```json
"pendingChecks": [
  { "start": 6.3, "end": 8.5, "check": "确认重复句尾音与伸手动作峰值的对应关系；目前只有机器时点" }
]
```

清单在普通模式可省略，保持旧分镜兼容；提供时仍校验字段和区间。校验器能确认可定位的记录，具体描述是否完整需在核听时判断。`verified` 必须有人工核对记录。均分逐字点亮属于视觉填充；离线起音检测不是歌词识别或对齐。

## 确定性求值

```js
const local = t - shot.start;
const progress = Math.max(0, Math.min(1, (t - actionStart) / actionDuration));
const sprite = Math.floor(Math.max(0, local) * spriteFps) % frames.length;
const x = Math.round(x0 + (x1 - x0) * progress);
const state = events.filter(e => e.at <= t).reduce(applyEvent, initialState());
```

位置、镜头、数值、粒子和遮罩都由时间求值，随机初值固定种子；物理可预模拟保存轨迹。`renderFrame(t,options)` 返回 `{width,height,data}`，data 为 RGBA 字节数组；同一时间与 options 应给出相同像素。资源先准备好，不能使用运行中的页面时钟或上一帧累积状态。

```sh
node scripts/qa.mjs path/to/frame.mjs --duration 12 --fps 30 --storyboard path/to/storyboard.json --out work/qa.json
```

脚本自动覆盖首尾、每镜首/中/尾、转场前/中/后及事件周围，用正序、重复、逆序和固定乱序比较 SHA-256。`--times 0,5.1,5.55,6` 可专查落点。其他框架提供一个导出相同 RGBA 契约的适配模块；浏览器 profile、资源准备及预热见 [渲染与恢复](dependencies-and-delivery.md#渲染与恢复)。报告只检查所抽样时间在当前环境的确定性。
