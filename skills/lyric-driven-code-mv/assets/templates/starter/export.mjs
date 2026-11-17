#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { renderFrame, WIDTH, HEIGHT, DURATION, DEFAULT_SEED, CAPTIONS } from './frame.mjs';
import { encodePNG, inspectPNG } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HELP = `用法：node export.mjs [参数]
无需 npm 包；需要已有 Node.js、ffmpeg（libx264/libass）和 ffprobe。
默认：12 秒 / 30 fps / 384×216 像素网格 → 1920×1080，原创合成节奏与高分辨率双语字幕。

  --out PATH          MP4 输出路径（默认当前目录 paper-boat-demo.mp4）
  --width N           最终输出宽度，正偶数（默认1920）
  --height N          最终输出高度，正偶数（默认1080）
  --fps N             1–120 的整数（默认30）
  --seed TEXT         固定种子（默认 paper-boat-original-v1）
  --frames-dir PATH   保存PNG、配置、节奏WAV及ASS；有此参数仍会编码MP4
  --frames-only       只生成上面的文件，须配 --frames-dir
  --resume            验证配置/每帧尺寸/PNG完整性后复用，须配 --frames-dir
  --ffmpeg PATH       ffmpeg 可执行文件（默认 ffmpeg）
  --ffprobe PATH      ffprobe 可执行文件（默认 ffprobe）
  --font TEXT         已安装字体名称（Windows默认 Microsoft YaHei）
  --preview           启动共享纯帧模块的本地Canvas预览，Ctrl+C停止
  --port N            预览端口（默认8765）
  --help              显示帮助

例：node export.mjs --out demo.mp4
    node export.mjs --out check.mp4 --width 640 --height 360 --fps 10
    node export.mjs --frames-dir frames --frames-only
    node export.mjs --frames-dir frames --resume --out demo.mp4
音轨仅用于演示节奏，不对应真实歌曲或真实歌词时间。已有框架工程请沿用原工程，按 README 适配 renderFrame。
`;

export function parseArgs(argv) {
  const c = { out: resolve('paper-boat-demo.mp4'), width: 1920, height: 1080, fps: 30, seed: DEFAULT_SEED, framesDir: null, resume: false, framesOnly: false, ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', font: process.platform === 'win32' ? 'Microsoft YaHei' : 'sans-serif', preview: false, port: 8765, help: false };
  const flags = { '--help': 'help', '--resume': 'resume', '--frames-only': 'framesOnly', '--preview': 'preview' };
  const options = { '--out': 'out', '--width': 'width', '--height': 'height', '--fps': 'fps', '--seed': 'seed', '--frames-dir': 'framesDir', '--ffmpeg': 'ffmpeg', '--ffprobe': 'ffprobe', '--font': 'font', '--port': 'port' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags[arg]) { c[flags[arg]] = true; continue; }
    const key = options[arg]; if (!key) throw new Error(`未知参数：${arg}`);
    const value = argv[++i]; if (value === undefined || value.startsWith('--') || !value.trim()) throw new Error(`${arg} 缺少值`);
    c[key] = ['width', 'height', 'fps', 'port'].includes(key) ? Number(value) : value;
  }
  if (c.help) return c;
  if (!Number.isInteger(c.fps) || c.fps < 1 || c.fps > 120) throw new Error('fps 须为 1–120 的整数');
  for (const key of ['width', 'height']) if (!Number.isInteger(c[key]) || c[key] < 16 || c[key] > 7680 || c[key] % 2) throw new Error(`输出尺寸 ${key} 须为 16–7680 的偶数`);
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw new Error('port 须为1–65535的整数');
  if ((c.resume || c.framesOnly) && !c.framesDir) throw new Error('--resume / --frames-only 须配 --frames-dir');
  if (extname(c.out).toLowerCase() !== '.mp4') throw new Error('--out 须使用 .mp4 扩展名');
  if (/[,\r\n]/.test(c.font)) throw new Error('字体名称不能含逗号或换行');
  c.out = resolve(c.out); if (c.framesDir) c.framesDir = resolve(c.framesDir);
  // image2pipe 编码使用素材目录作为 cwd；先固定显式相对可执行路径。
  for (const key of ['ffmpeg', 'ffprobe']) if (/[\\/]/.test(c[key])) c[key] = resolve(c[key]);
  return c;
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const frameName = i => `frame-${String(i).padStart(6, '0')}.png`;

async function renderConfig(c) {
  const sourceHash = digest(Buffer.concat(await Promise.all(['frame.mjs', 'png.mjs', 'export.mjs'].map(file => readFile(join(here, file))))));
  const config = { version: 1, duration: DURATION, fps: c.fps, frameWidth: WIDTH, frameHeight: HEIGHT, outputWidth: c.width, outputHeight: c.height, seed: c.seed, font: c.font, sourceHash };
  return { config, fingerprint: digest(JSON.stringify(config)), frameCount: DURATION * c.fps, frames: {} };
}

async function atomicWrite(path, data) {
  const temporary = `${path}.writing`; await writeFile(temporary, data); await rename(temporary, path);
}

/** 断点恢复不把目录存在当作完成；配置及每个已有 PNG 均重新校验。 */
export async function prepareFrames(c, log = console.log) {
  if (!c.framesDir) throw new Error('prepareFrames 需要 frames-dir');
  await mkdir(c.framesDir, { recursive: true });
  const manifest = await renderConfig(c), manifestPath = join(c.framesDir, 'render-config.json');
  const names = await readdir(c.framesDir);
  if (c.resume) {
    let existing; try { existing = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { throw new Error('恢复失败：找不到有效 render-config.json，请使用新的帧目录'); }
    if (existing.fingerprint !== manifest.fingerprint || JSON.stringify(existing.config) !== JSON.stringify(manifest.config) || existing.frameCount !== manifest.frameCount) throw new Error('恢复失败：配置/源码与帧目录不一致，请使用新目录');
    // 旧记录没有可信逐帧指纹时，下面逐帧重算；不会静默接受已有图片。
    if (existing.frames && typeof existing.frames === 'object' && !Array.isArray(existing.frames)) manifest.frames = existing.frames;
    if (names.some(n => /^frame-\d{6}\.png$/.test(n) && Number(n.slice(6, 12)) >= manifest.frameCount)) throw new Error('恢复失败：帧目录中有超出当前配置的帧');
  } else {
    if (names.some(n => /^frame-\d{6}\.png$/.test(n) || n === 'render-config.json')) throw new Error('帧目录已有导出，请使用 --resume 或新目录');
    await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
  }
  const known = new Set(names);
  for (let i = 0; i < manifest.frameCount; i++) {
    const path = join(c.framesDir, frameName(i));
    let reusable = false;
    if (c.resume && known.has(frameName(i))) {
      const bytes = await readFile(path), dimensions = inspectPNG(bytes), record = manifest.frames[i];
      if (dimensions.width !== WIDTH || dimensions.height !== HEIGHT) throw new Error(`恢复失败：${frameName(i)} 帧尺寸不符`);
      if (record !== undefined) {
        if (!record || record.index !== i || record.name !== frameName(i) || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')) throw new Error(`恢复失败：${frameName(i)} 帧指纹记录错误`);
        if (digest(bytes) !== record.sha256) throw new Error(`恢复失败：${frameName(i)} 帧哈希不符，可能错置或已被修改`);
        reusable = true;
      }
    }
    if (!reusable) {
      const bytes = encodePNG(renderFrame(i / c.fps, { seed: c.seed }));
      await atomicWrite(path, bytes);
      manifest.frames[i] = { index: i, name: frameName(i), sha256: digest(bytes) };
      // 图片先落盘，再原子更新可信记录；中断窗口内无记录的图片会重算。
      await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
    }
    if (i % (c.fps * 2) === 0 || i + 1 === manifest.frameCount) log(`像素帧 ${i + 1}/${manifest.frameCount}`);
  }
  return manifest;
}

/** 原创、无歌词的代码合成节奏，不仿制歌曲，不调用 TTS 或外部音源。 */
export function synthesizeWAV() {
  const rate = 48000, samples = DURATION * rate, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  const notes = [261.6256, 329.6276, 391.9954, 329.6276, 293.6648, 349.2282, 440, 391.9954];
  for (let i = 0; i < samples; i++) {
    const t = i / rate, beat = Math.floor(t * 2), local = t % 0.5, note = notes[(beat + (t >= 6 ? 2 : 0)) % notes.length];
    const melody = Math.sin(2 * Math.PI * note * t) * Math.exp(-local * 7) * 0.13;
    const kick = Math.sin(2 * Math.PI * (68 * local + 30 * (1 - Math.exp(-local * 18)) / 18)) * Math.exp(-local * 24) * 0.16;
    const chime = Math.sin(2 * Math.PI * note * 2 * t) * Math.exp(-local * 12) * 0.05;
    const fade = Math.min(1, t / 0.04, (DURATION - t) / 0.35), sample = (melody + kick + chime) * fade;
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2);
  }
  return wav;
}

function assTime(t) { const cs = Math.round(t * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; }
const assText = text => text.replace(/[{}]/g, '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\N');

export function createASS(c) {
  const size = Math.round(c.height * 0.041), enSize = Math.round(c.height * 0.029), margin = Math.round(c.height * 0.07), x = Math.round(c.width / 2), y = c.height - margin;
  const introSize = Math.round(c.height * 0.025);
  const lines = [
    '[Script Info]', 'Title: 未抵达的灯 · 原创12秒模板', 'ScriptType: v4.00+', `PlayResX: ${c.width}`, `PlayResY: ${c.height}`, 'ScaledBorderAndShadow: yes', 'WrapStyle: 2', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${c.font},${size},&H00F4F5ED,&H00FFFFFF,&H90131B29,&H90131B29,0,0,0,0,100,100,0,0,3,${Math.max(4, Math.round(c.height * 0.009))},0,2,${Math.round(c.width * 0.08)},${Math.round(c.width * 0.08)},${margin},1`,
    `Style: Notice,${c.font},${introSize},&H00E5DEC4,&H00FFFFFF,&H90131B29,&H90131B29,0,0,0,0,100,100,0,0,3,${Math.max(3, Math.round(c.height * 0.006))},0,8,${Math.round(c.width * 0.08)},${Math.round(c.width * 0.08)},${Math.round(c.height * 0.06)},1`, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 1,0:00:00.00,0:00:02.20,Notice,,0,0,0,,演示时点 · 原创合成节奏`,
  ];
  for (const cue of CAPTIONS) lines.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,{\\an2\\pos(${x},${y})}${assText(cue.zh)}\\N{\\fs${enSize}}${assText(cue.en)}`);
  return lines.join('\n') + '\n';
}

function commandOutput(binary, args, label) {
  const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${label} 不可用：${result.error?.message ?? result.stderr?.trim() ?? `退出 ${result.status}`}`);
  return result.stdout + result.stderr;
}

export function preflight(c) {
  const filters = commandOutput(c.ffmpeg, ['-hide_banner', '-filters'], 'ffmpeg');
  if (!/\bass\s+V->V/.test(filters)) throw new Error('ffmpeg 缺少 libass 字幕过滤器；请使用已有完整版本');
  const encoders = commandOutput(c.ffmpeg, ['-hide_banner', '-encoders'], 'ffmpeg');
  if (!/\blibx264\b/.test(encoders) || !/\baac\b/.test(encoders)) throw new Error('ffmpeg 缺少 libx264 或 AAC 编码器');
  commandOutput(c.ffprobe, ['-version'], 'ffprobe');
}

async function pipeFrames(c, assets, temporaryOut, log) {
  const args = ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'image2pipe', '-framerate', String(c.fps), '-vcodec', 'png', '-i', 'pipe:0', '-i', 'demo-beat.wav', '-vf', `scale=${c.width}:${c.height}:flags=neighbor,ass=filename=subtitles.ass`, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-t', String(DURATION), '-movflags', '+faststart', temporaryOut];
  const child = spawn(c.ffmpeg, args, { cwd: assets, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '', spawnError = null, pipeError = null;
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-16000); });
  child.on('error', error => { spawnError = error; }); child.stdin.on('error', error => { pipeError = error; });
  const finished = new Promise(resolveResult => child.once('close', (code, signal) => resolveResult({ code, signal })));
  try {
    for (let i = 0; i < DURATION * c.fps; i++) {
      if (spawnError || pipeError || child.exitCode !== null) throw spawnError ?? pipeError ?? new Error('ffmpeg 提前结束');
      const png = c.framesDir ? await readFile(join(c.framesDir, frameName(i))) : encodePNG(renderFrame(i / c.fps, { seed: c.seed }));
      if (!child.stdin.write(png)) await once(child.stdin, 'drain');
      if (i % (c.fps * 2) === 0 || i + 1 === DURATION * c.fps) log(`PNG管道 ${i + 1}/${DURATION * c.fps}`);
    }
    child.stdin.end();
    const status = await finished;
    if (status.code !== 0 || spawnError || pipeError) throw new Error(`ffmpeg 编码失败（${status.code ?? status.signal}）：${stderr.trim() || spawnError?.message || pipeError?.message}`);
    if (/Glyph .*not found|failed to find any fallback|fontselect.*failed/i.test(stderr)) throw new Error(`系统字体缺少字幕字符：${stderr.trim()}。请用 --font 指定已有中文字体；模板不会下载字体。`);
  } catch (error) {
    child.stdin.destroy(); if (child.exitCode === null) child.kill(); await finished;
    throw new Error(`PNG导出失败：${error.message}${stderr ? `\n${stderr.trim()}` : ''}`);
  }
}

export async function verifyOutput(c, path) {
  const raw = commandOutput(c.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], 'ffprobe');
  let info; try { info = JSON.parse(raw); } catch { throw new Error('ffprobe 返回了无效JSON'); }
  const video = info.streams?.find(s => s.codec_type === 'video'), audio = info.streams?.find(s => s.codec_type === 'audio');
  if (!video || !audio || video.width !== c.width || video.height !== c.height || video.codec_name !== 'h264' || audio.codec_name !== 'aac' || video.pix_fmt !== 'yuv420p' || Math.abs(Number(info.format?.duration) - DURATION) > 1 / c.fps + 0.02) throw new Error('成片验收失败：时长、尺寸或音视频流不匹配');
  commandOutput(c.ffmpeg, ['-v', 'error', '-i', path, '-f', 'null', '-'], 'ffmpeg 全片解码');
  return info;
}

export async function exportVideo(c, log = console.log) {
  preflight(c);
  let temporaryAssets = null, temporaryOut = null;
  try {
    if (c.framesDir) await prepareFrames(c, log);
    if (!c.framesOnly) await mkdir(dirname(c.out), { recursive: true });
    const assets = c.framesDir ?? (temporaryAssets = await mkdtemp(join(dirname(c.out), '.pixel-mv-assets-')));
    await atomicWrite(join(assets, 'demo-beat.wav'), synthesizeWAV());
    await atomicWrite(join(assets, 'subtitles.ass'), createASS(c));
    if (c.framesOnly) { log(`已生成可恢复帧目录：${c.framesDir}`); return null; }
    temporaryOut = join(dirname(c.out), `.rendering-${process.pid}-${basename(c.out)}`);
    await pipeFrames(c, assets, temporaryOut, log);
    const info = await verifyOutput(c, temporaryOut);
    if ((await stat(temporaryOut)).size < 1) throw new Error('编码结果为空');
    await rename(temporaryOut, c.out); temporaryOut = null;
    log(`完成：${c.out}\n已核对12秒、${c.width}×${c.height}、H.264/AAC及全片解码。交付前仍需抽帧查看叙事和字幕。`);
    return info;
  } finally {
    if (temporaryOut) await rm(temporaryOut, { force: true });
    if (temporaryAssets) await rm(temporaryAssets, { recursive: true, force: true });
  }
}

function preview(c) {
  const files = new Map([['/', ['preview.html', 'text/html; charset=utf-8']], ['/preview.html', ['preview.html', 'text/html; charset=utf-8']], ['/frame.mjs', ['frame.mjs', 'text/javascript; charset=utf-8']]]);
  const server = createServer(async (req, res) => {
    const route = files.get(new URL(req.url, 'http://127.0.0.1').pathname);
    if (!route) { res.writeHead(404); res.end('不存在'); return; }
    try { const body = await readFile(join(here, route[0])); res.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store' }); res.end(body); }
    catch { res.writeHead(500); res.end('读取失败'); }
  });
  server.on('error', error => { console.error(`预览服务失败：${error.message}`); process.exitCode = 1; });
  server.listen(c.port, '127.0.0.1', () => console.log(`预览：http://127.0.0.1:${c.port} （Ctrl+C停止；不自动打开浏览器）`));
}

async function main() {
  try { const c = parseArgs(process.argv.slice(2)); if (c.help) console.log(HELP); else if (c.preview) preview(c); else await exportVideo(c); }
  catch (error) { console.error(`导出失败：${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
