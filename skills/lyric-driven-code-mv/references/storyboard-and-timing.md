# 时间与分镜

## 一套成片坐标

源音频从 `sourceOffset` 秒截取。动画与所有歌词、节拍、事件使用成片秒：

```js
const t = frame / fps;
const sourceTime = sourceOffset + t;
const clipTime = annotatedSourceTime - sourceOffset;
```

换算在数据入口进行一次；保留原曲标注作为来源信息，渲染读成片字段。例：源片段 `[37.2,49.2)`，原曲句子 `[38,41)` 转为成片 `[0.8,3.8)`。同一句在 `[45,48)` 再出现，转为 `[7.8,10.8)`，使用新的句 ID。

区间使用 `[start,end)`。截断跨越片段边界的歌词及事件，保留必要的前置状态。总帧数由目标时间和帧率确定，并让 `duration = durationFrames / fps`；最后一帧是 `(durationFrames-1)/fps`。输入音频若已经剪好，记录 `audio.timebase="clip"` 并从零播放；源音频记录 `"source"` 并裁掉 `sourceOffset`，避免二次偏移。

嵌套场景的相对时间为 `local = t - scene.start`。Remotion 的 Sequence 内 `useCurrentFrame()` 返回局部帧；需要全局事件时间时加回 Sequence 起始帧。不要再减一次镜头起点。

## 从含义到事件

先写一句“人物想要什么，因什么受阻或改变”，再设计可见演出。

| 含义 | 目标与行动 | 反馈与结果 |
|---|---|---|
| 珍惜纪念物 | 抱起礼物，选择保留，摆上搁板 | 完整礼物留下，保留标记出现 |
| 无法抵达 | 放出纸船，漂向远方，遇到阻碍 | 船停住，路线断裂，仍有距离 |
| 付出与消耗 | 攀升、奔跑、跨过风雪 | 距离增大，体力改变；变化对应动作 |
| 回忆变冷 | 触摸照片，画面结冰，再尝试解冻 | 图标失色、裂纹、温度格逐步改变 |
| 重新联系 | 两地望向彼此，光锥跨屏，再同步举灯 | 连线完成有明确时点；完成后才执行共同动作 |

重要落点可以是道具落架、脚落地、失败字样出现、能量发动或连线完成。让动作准备稍早开始、峰值落在已核对的重音上。缓慢观察和句尾停留也要有时间；无歌词镜头允许继续推进地点、记忆和关系。

重复意象增加后果：第一次送出纸船失败；第二次切到另一岸，看到仍搁浅的船与远处灯光，信息改变而未抵达的结果保留。不要因为进入副歌就强行把所有任务改成成功。

## JSON 约定

以下是本 skill 模板及校验器的格式，可增加项目特有字段。

| 字段 | 内容 |
|---|---|
| `schemaVersion`, `timebase` | `1`、`"clip"` |
| `project` | `fps`、`duration`、`sourceOffset`、输出及虚拟尺寸、非空 `seed`、`audio:{path,timebase}` |
| `lyrics[]` | 唯一 `id`、`start`、`end`、校对的 `text`；重复句使用独立 ID |
| `music` | `status` 为 illustrative/draft/verified；`beats[]` 成片秒；`sections[]:{id,start,end}` |
| `actors[]` | 稳定身份 `id`，可用 `costumes[]` |
| `props[]` | 道具 ID 列表；同种道具需要单独追踪时分配不同 ID |
| `scenes[]` | 唯一 ID、时间、`meaning/location/objective/action/feedback/outcome`、歌词引用、人物/装束、道具、事件、出口转场 |
| `scene.actors[]` | `{id,costume}` 引用根人物表 |
| `scene.events[]` | `{at,action,hud?}`；`at` 是成片秒且位于该镜头内；事件升序排列 |
| `scene.lyricIds[]` | 有交集的句 ID；留白镜头可用空数组 |

主场景按时间覆盖 `[0,duration)`，不重叠、不留洞。跨镜遮罩作为出口转场/覆盖层实现，不通过重叠两个主镜头表达。角色服装在场景里明确指定，换装增加到人物装束表；道具拥有、消耗、保留等连续性另记项目状态并人工核对。

模板允许 beats 为空；没有听辨时保留 `draft`。结构校验会接受 `illustrative`，但发布成片前需要人工确认真实音乐落点。转录与节拍检测可能受伴奏、拖音和半速/双速 BPM 影响。均分逐字点亮属于视觉设计，不等于真实演唱词时间。

## 确定性求值

```js
const clamp01 = x => Math.max(0, Math.min(1, x));
const local = t - shot.start;
const progress = clamp01((t - actionStart) / actionDuration);
const sprite = Math.floor(Math.max(0, local) * spriteFps) % frames.length;
const x = Math.round(x0 + (x1 - x0) * progress);
const snowY = ((seededY + speed * t) % height + height) % height;

// 每次都从相同初态归约整个已发生事件前缀。
const state = events.filter(e => e.at <= t).reduce(applyEvent, initialState());
```

`applyEvent` 为项目定义的纯状态变换；镜头结束后仍要保留的物件写入全局时间数据。位置、镜头、数值、粒子和遮罩均从时间求值，固定种子生成初值。物理动作可以预模拟保存轨迹。用顺序、倒序及随机顺序请求同一批帧，比较同帧像素；自行运行的页面时钟及累积上一帧状态会破坏这个条件。
