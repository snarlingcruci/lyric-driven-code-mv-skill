import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const positive = (value, name) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须为正有限数`);
};

export function collectSampleTimes({ duration, fps, scenes = [], samples = 16 }) {
  positive(duration, 'duration');
  positive(fps, 'fps');
  if (!Number.isInteger(samples) || samples < 2 || samples > 1000) throw new Error('samples 必须为 2–1000 的整数');
  const last = Math.max(0, duration - 1 / fps);
  const times = new Set([0, last]);
  const add = t => {
    if (Number.isFinite(t) && t >= 0 && t <= last + 1e-8) times.add(Math.min(t, last));
  };
  const around = t => [t - 1 / fps, t, t + 1 / fps].forEach(add);
  for (let i = 0; i < samples; i++) add(last * i / (samples - 1));
  for (const scene of scenes) {
    around(scene.start);
    around(scene.end);
    add((scene.start + scene.end) / 2);
    if (scene.exit && scene.exit.type !== 'cut' && Number.isFinite(scene.exit.dur)) {
      around(scene.end - scene.exit.dur);
      add(scene.end - scene.exit.dur / 2);
    }
    for (const event of scene.events ?? []) around(event.at);
  }
  return [...times].sort((a, b) => a - b);
}

function frameHash(frame) {
  const { width, height, data } = frame ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 16777216) {
    throw new Error('帧宽高必须为正整数，最多 16777216 像素');
  }
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
    throw new Error('renderFrame 必须返回 {width,height,data}，data 为完整 RGBA 字节数组');
  }
  return createHash('sha256').update(`${width}x${height}:`).update(data).digest('hex');
}

function shuffled(values) {
  const copy = [...values];
  let seed = 0x6c797269;
  for (let i = copy.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function runDeterminismQA(renderFrame, { times, frameOptions = {} } = {}) {
  if (typeof renderFrame !== 'function') throw new Error('模块必须导出 renderFrame(t, options)');
  if (!Array.isArray(times) || !times.length || times.length > 10000 || times.some(t => !Number.isFinite(t) || t < 0)) {
    throw new Error('检查时间必须为 1–10000 个非负有限数');
  }
  const ordered = [...new Set(times)].sort((a, b) => a - b);
  const baseline = new Map();
  const failures = [];
  let renderCount = 0;
  const orders = [
    ['forward', ordered], ['repeat', ordered],
    ['reverse', [...ordered].reverse()], ['random', shuffled(ordered)]
  ];
  for (const [order, sequence] of orders) {
    for (const time of sequence) {
      // 立即哈希；允许渲染器复用缓冲，不保留可变帧引用。
      const actualHash = frameHash(await renderFrame(time, frameOptions));
      renderCount++;
      if (order === 'forward') baseline.set(time, actualHash);
      else if (baseline.get(time) !== actualHash) failures.push({ time, order, expectedHash: baseline.get(time), actualHash });
    }
  }
  return {
    schemaVersion: 1, status: failures.length ? 'fail' : 'pass',
    testedFrameCount: ordered.length, renderCount,
    orders: orders.map(([name]) => name),
    frames: ordered.map(time => ({ time, sha256: baseline.get(time) })),
    failures,
    limitation: '仅证明所抽样时间在本次渲染环境中的像素一致性；不证明歌词对齐、授权或成片观感。'
  };
}

async function main(args) {
  if (args.includes('--help')) {
    console.log('用法：node qa.mjs <frame.mjs> --duration 12 --fps 30 [--samples 16] [--storyboard file.json] [--times 0,5.1,6] [--out qa.json]');
    return;
  }
  const modulePath = args.shift();
  if (!modulePath || modulePath.startsWith('--')) throw new Error('缺少渲染模块路径，使用 --help 查看用法');
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--duration', '--fps', '--samples', '--storyboard', '--times', '--out'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`未知参数或缺少值：${key}`);
    }
    if (Object.hasOwn(opts, key)) throw new Error(`重复参数：${key}`);
    opts[key] = args[i + 1];
  }
  const module = await import(pathToFileURL(resolve(modulePath)).href);
  const storyboard = opts['--storyboard'] ? JSON.parse(await readFile(resolve(opts['--storyboard']), 'utf8')) : null;
  const duration = Number(opts['--duration'] ?? storyboard?.project?.duration ?? module.DURATION);
  const fps = Number(opts['--fps'] ?? storyboard?.project?.fps ?? module.FPS ?? 30);
  positive(duration, 'duration');
  positive(fps, 'fps');
  const times = opts['--times'] ? opts['--times'].split(',').map(value => {
    if (!value.trim()) throw new Error('时间列表含空值');
    return Number(value);
  }) : collectSampleTimes({ duration, fps, samples: Number(opts['--samples'] ?? 16), scenes: storyboard?.scenes ?? module.SCENES ?? [] });
  if (times.some(t => t >= duration)) throw new Error('检查时间必须位于 [0,duration)');
  const report = await runDeterminismQA(module.renderFrame, { times });
  report.module = resolve(modulePath);
  report.duration = duration;
  report.fps = fps;
  if (opts['--out']) {
    const output = resolve(opts['--out']);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`确定性检查 ${report.status}：${report.testedFrameCount} 个时间点，${report.renderCount} 次渲染，${report.failures.length} 处不一致`);
  if (report.failures.length) {
    console.error(JSON.stringify(report.failures, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`确定性检查失败：${error.message}`); process.exitCode = 1; });
}
