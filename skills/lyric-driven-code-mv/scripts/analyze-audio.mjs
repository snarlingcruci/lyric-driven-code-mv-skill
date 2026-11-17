import { spawn } from 'node:child_process';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_SECONDS = 600;
const ABSOLUTE_RMS_FLOOR = 1e-5;
const round = value => Math.round(value * 1e6) / 1e6;
const clamp01 = value => Math.max(0, Math.min(1, value));

function finiteOption(value, name, { positive = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    throw new Error(`${name} 必须为${positive ? '正' : '非负'}有限数。`);
  }
}

function validateRate(sampleRate) {
  if (![8000, 16000].includes(sampleRate)) throw new Error('sampleRate 必须为 8000 或 16000。');
}

function validateBpmOptions({ bpm, bpmSource, bpmEvidence }) {
  if (bpm === undefined) {
    if (bpmSource !== undefined || bpmEvidence !== undefined) throw new Error('BPM 来源或依据需要同时提供 --bpm / bpm。');
    return;
  }
  finiteOption(bpm, 'BPM / bpm', { positive: true });
  if (bpm > 400) throw new Error('BPM / bpm 不得超过 400。');
  if (bpmSource !== undefined && !['user-provided', 'metadata'].includes(bpmSource)) throw new Error('BPM 来源 bpmSource 必须为 user-provided 或 metadata。');
  if (bpmEvidence !== undefined && (typeof bpmEvidence !== 'string' || !bpmEvidence.trim())) throw new Error('BPM 依据 bpmEvidence 必须为非空文字。');
  if (bpmSource === 'metadata' && !bpmEvidence?.trim()) throw new Error('metadata BPM 必须提供 --bpm-evidence / bpmEvidence，记录曲目页或元数据依据。');
}

function phaseFit(onsets, bpm) {
  const period = 60 / bpm;
  let x = 0, y = 0, totalStrength = 0;
  for (const onset of onsets) {
    const angle = 2 * Math.PI * onset.at / period;
    x += Math.cos(angle) * onset.strength;
    y += Math.sin(angle) * onset.strength;
    totalStrength += onset.strength;
  }
  const alignment = totalStrength ? Math.hypot(x, y) / totalStrength : 0;
  let phase = Math.atan2(y, x) * period / (2 * Math.PI);
  phase = ((phase % period) + period) % period;
  return { alignment: round(alignment), phaseSeconds: Math.min(round(phase), period - Number.EPSILON) };
}

function periodicityAt(novelty, lag) {
  let cross = 0, leftPower = 0, rightPower = 0, leftSum = 0, rightSum = 0;
  const count = novelty.length - lag;
  if (count <= 1) return { autocorrelation: 0, periodicity: 0 };
  for (let i = lag; i < novelty.length; i++) {
    const left = novelty[i], right = novelty[i - lag];
    cross += left * right;
    leftPower += left * left;
    rightPower += right * right;
    leftSum += left;
    rightSum += right;
  }
  const autocorrelation = leftPower && rightPower ? clamp01(cross / Math.sqrt(leftPower * rightPower)) : 0;
  // Positive-only novelty has a noise baseline: remove its mean before accepting periodic evidence.
  const centeredLeft = Math.max(0, leftPower - leftSum * leftSum / count);
  const centeredRight = Math.max(0, rightPower - rightSum * rightSum / count);
  const periodicity = centeredLeft && centeredRight ? clamp01((cross - leftSum * rightSum / count) / Math.sqrt(centeredLeft * centeredRight)) : 0;
  return { autocorrelation: round(autocorrelation), periodicity: round(periodicity) };
}

function estimateTempo(onsets, novelty, hopSeconds, duration, peakRms, options) {
  const source = options.bpm === undefined ? 'audio-analysis' : options.bpmSource ?? 'user-provided';
  const evidence = {
    method: options.bpm === undefined ? '起音间隔投票、±3% 邻近候选聚类、包络自相关与相位拟合。' : '采用已提供的 BPM，仅用片段起音拟合相位。',
    bpm: options.bpmEvidence?.trim() ?? (options.bpm === undefined ? '离线音频候选；没有外部 BPM 依据。' : `用户提供 ${options.bpm} BPM。`),
    limitations: '启发式证据未经真实歌曲标定；BPM 来源不证明拍号、歌词对齐或人工核对，半速/双速与弱拍仍需听辨。',
  };
  const empty = reason => ({ bpm: null, status: 'unavailable', source, confidence: 0, periodSeconds: null, phaseSeconds: null, candidates: [], clusters: [], ambiguities: [], evidence, ...(options.bpm === undefined ? {} : { requestedBpm: options.bpm }), reason });
  if (peakRms < ABSOLUTE_RMS_FLOOR) return empty('静音或能量低于绝对证据阈值。');
  if (onsets.length < 5 || duration < 3) return empty('片段过短或起音候选不足 5 个。');

  const correlations = new Map();
  const fit = bpm => {
    const lag = Math.round(60 / bpm / hopSeconds);
    if (!correlations.has(lag)) correlations.set(lag, periodicityAt(novelty, lag));
    return { bpm, ...phaseFit(onsets, bpm), ...correlations.get(lag) };
  };
  const usableSignal = candidate => onsets.length / (duration * candidate.bpm / 60) >= 0.2 && candidate.periodicity >= 0.05;
  const selected = (candidate, candidates, clusters, confidence, status, reason) => ({
    bpm: candidate.bpm, status, source, confidence: round(confidence),
    periodSeconds: 60 / candidate.bpm, phaseSeconds: candidate.phaseSeconds,
    alignment: candidate.alignment, autocorrelation: candidate.autocorrelation, periodicity: candidate.periodicity,
    candidates, clusters, evidence,
    ambiguities: [{ bpm: candidate.bpm / 2, relation: 'half' }, { bpm: candidate.bpm * 2, relation: 'double' }], reason,
  });
  if (options.bpm !== undefined) {
    const candidate = fit(options.bpm);
    const covered = onsets.length / (duration * candidate.bpm / 60) >= 0.2;
    // A known grid can be phased from sparse downbeats even when intervening beats have no onset.
    if (!covered || (candidate.periodicity < 0.05 && candidate.alignment < 0.3)) return empty('已记录提供的 BPM，但音频没有足够的周期或相位证据；不生成任意起点网格。');
    const confidence = clamp01(0.65 * candidate.alignment + 0.35 * candidate.periodicity);
    return selected(candidate, [candidate], [], confidence, confidence >= 0.6 ? 'estimated' : 'low-confidence', 'BPM 来自所记录的外部依据；相位为机器拟合，仍需人工核对。');
  }

  // Short-distance onset pairs vote for plausible subdivisions. This cannot decide a musical metre.
  const bins = new Map();
  for (let i = 1; i < onsets.length; i++) {
    for (let distance = 1; distance <= 8 && i - distance >= 0; distance++) {
      const previous = onsets[i - distance];
      const interval = onsets[i].at - previous.at;
      if (interval < 0.1 || interval > 4) continue;
      for (let subdivisions = 1; subdivisions <= 8; subdivisions++) {
        const bpm = 60 * subdivisions / interval;
        if (bpm < 45 || bpm > 200) continue;
        const key = Math.round(bpm * 2) / 2;
        const bin = bins.get(key) ?? { bpm: key, weight: 0, intervalVotes: 0 };
        bin.weight += Math.sqrt(previous.strength * onsets[i].strength) / (distance * subdivisions);
        bin.intervalVotes++;
        bins.set(key, bin);
      }
    }
  }
  if (!bins.size) return empty('起音间隔没有形成可用的 45–200 BPM 候选。');

  const maxWeight = Math.max(...Array.from(bins.values(), bin => bin.weight));
  const candidates = [];
  for (const bin of bins.values()) {
    const candidate = fit(bin.bpm);
    const vote = bin.weight / maxWeight;
    const score = 0.55 * vote + 0.25 * candidate.autocorrelation + 0.2 * candidate.alignment;
    candidates.push({ ...candidate, vote: round(vote), intervalVotes: bin.intervalVotes, score });
  }
  candidates.sort((a, b) => b.score - a.score || b.vote - a.vote || a.bpm - b.bpm);
  const publicCandidates = candidates.slice(0, 8).map(({ score, ...candidate }) => candidate);

  // Use fixed anchors rather than transitive chaining, which could collapse unrelated BPMs into one cluster.
  const unassigned = new Set(candidates);
  const groups = [];
  for (const anchor of candidates) {
    if (!unassigned.has(anchor)) continue;
    const members = candidates.filter(candidate => unassigned.has(candidate) && Math.abs(candidate.bpm - anchor.bpm) / anchor.bpm <= 0.03);
    members.forEach(candidate => unassigned.delete(candidate));
    const range = { min: Math.min(...members.map(candidate => candidate.bpm)), max: Math.max(...members.map(candidate => candidate.bpm)) };
    const weight = members.reduce((sum, candidate) => sum + candidate.vote, 0);
    let refined = fit(anchor.bpm);
    // Refit inside the supported range to avoid phase drift caused by the 0.5 BPM voting bins.
    for (let tenth = Math.ceil(range.min * 10); tenth <= Math.floor(range.max * 10); tenth++) {
      const candidate = fit(tenth / 10);
      if (candidate.alignment > refined.alignment) refined = candidate;
    }
    groups.push({ ...refined, range, anchorBpm: anchor.bpm, weight, intervalVotes: members.reduce((sum, candidate) => sum + candidate.intervalVotes, 0), members: members.map(({ score, ...candidate }) => candidate) });
  }
  const maxClusterWeight = Math.max(...groups.map(group => group.weight));
  const clusters = groups.map(({ weight, ...group }) => {
    const vote = round(weight / maxClusterWeight);
    return { ...group, vote, score: 0.55 * vote + 0.25 * group.autocorrelation + 0.2 * group.alignment };
  }).sort((a, b) => b.score - a.score || a.bpm - b.bpm);
  const publicClusters = clusters.slice(0, 8).map(({ score, ...cluster }) => cluster);
  const best = clusters.find(candidate => usableSignal(candidate) && candidate.autocorrelation >= 0.15 && candidate.intervalVotes >= 8 && candidate.vote >= 0.2);
  if (!best) return { ...empty('候选投票或去均值周期一致性不足；请人工听辨。'), candidates: publicCandidates, clusters: publicClusters };
  const confidence = clamp01(0.45 * best.alignment + 0.35 * best.autocorrelation + 0.2 * best.vote);
  const strong = best.alignment >= 0.6 && best.autocorrelation >= 0.2 && confidence >= 0.6;
  return selected(best, publicCandidates, publicClusters, strong ? confidence : Math.min(0.59, confidence), strong ? 'estimated' : 'low-confidence', strong ? '邻近候选的周期与相位共同支持网格；仍需人工核对半速/双速。' : '间隔投票与周期证据支持候选，但相位或自相关偏弱；网格仅供 draft 分镜试排与人工复核。');
}

/** Analyze already-cut mono PCM. sourceOffset is metadata; every returned time uses the clip clock. */
export function analyzePcm(samples, options = {}) {
  const { sampleRate = 8000, sourceOffset = 0, windowSeconds = 0.02, hopSeconds = 0.01 } = options;
  validateBpmOptions(options);
  validateRate(sampleRate);
  finiteOption(sourceOffset, 'sourceOffset');
  finiteOption(windowSeconds, 'windowSeconds', { positive: true });
  finiteOption(hopSeconds, 'hopSeconds', { positive: true });
  if (windowSeconds > 1 || hopSeconds > windowSeconds || windowSeconds * sampleRate < 1 || hopSeconds * sampleRate < 1) {
    throw new Error('windowSeconds/hopSeconds 必须至少含一个样本，且 0 < hopSeconds <= windowSeconds <= 1。');
  }
  if (!(samples instanceof Float32Array || samples instanceof Float64Array) || samples.length === 0) throw new Error('PCM 必须为非空 Float32Array 或 Float64Array 样本。');
  if (samples.length > sampleRate * MAX_SECONDS) throw new Error(`PCM 超过 ${MAX_SECONDS} 秒上限；请先截取需要分析的片段。`);
  let totalPower = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error('PCM 样本不得含 NaN 或 Infinity。');
    totalPower += sample * sample;
  }
  if (!Number.isFinite(totalPower)) throw new Error('PCM 样本能量超出可计算范围。');
  const duration = samples.length / sampleRate;
  const windowSamples = Math.round(windowSeconds * sampleRate);
  const hopSamples = Math.round(hopSeconds * sampleRate);
  const actualHop = hopSamples / sampleRate;
  const actualWindow = windowSamples / sampleRate;
  const envelope = [];
  let peakRms = 0;
  for (let start = 0; start < samples.length; start += hopSamples) {
    const end = Math.min(start + windowSamples, samples.length);
    let power = 0;
    for (let index = start; index < end; index++) power += samples[index] * samples[index];
    const rms = Math.sqrt(power / (end - start));
    peakRms = Math.max(peakRms, rms);
    envelope.push({ at: start / sampleRate, rms });
  }
  const novelty = envelope.map((frame, index) => Math.max(0, frame.rms - (index ? envelope[index - 1].rms : 0)));
  const onsets = [];
  const onsetThreshold = Math.max(ABSOLUTE_RMS_FLOOR, peakRms * 0.1);
  for (let i = 0; i < novelty.length; i++) {
    if (novelty[i] < onsetThreshold || novelty[i] < (novelty[i - 1] ?? 0) || novelty[i] <= (novelty[i + 1] ?? 0)) continue;
    const at = Math.min(envelope[i].at + actualWindow / 2, duration - 1 / sampleRate);
    const candidate = { at: round(at), strength: round(novelty[i] / peakRms) };
    const last = onsets.at(-1);
    if (last && candidate.at - last.at < 0.08) {
      if (candidate.strength > last.strength) onsets[onsets.length - 1] = candidate;
    } else onsets.push(candidate);
  }

  const pauses = [];
  const pauseThreshold = Math.max(ABSOLUTE_RMS_FLOOR, peakRms * 0.1);
  let pauseStart = null;
  let pauseMaxRms = 0;
  for (let i = 0; i <= envelope.length; i++) {
    const frame = envelope[i];
    if (frame && frame.rms <= pauseThreshold) {
      pauseStart ??= frame.at;
      pauseMaxRms = Math.max(pauseMaxRms, frame.rms);
    } else if (pauseStart !== null) {
      const end = frame?.at ?? duration;
      if (end - pauseStart >= 0.15) pauses.push({ start: pauseStart, end, maxRms: round(pauseMaxRms) });
      pauseStart = null;
      pauseMaxRms = 0;
    }
  }
  const tempo = estimateTempo(onsets, novelty, actualHop, duration, peakRms, options);
  const beats = [];
  if (tempo.bpm !== null) {
    for (let n = 0; ; n++) {
      const at = round(tempo.phaseSeconds + n * tempo.periodSeconds);
      if (at >= duration) break;
      beats.push(at);
    }
  }
  return {
    schemaVersion: 1,
    status: 'draft',
    timebase: 'clip',
    sourceOffset,
    duration,
    sampleRate,
    energy: {
      windowSeconds: actualWindow,
      hopSeconds: actualHop,
      peakRms: round(peakRms),
      meanRms: round(Math.sqrt(totalPower / samples.length)),
      envelope: envelope.map(frame => ({ at: frame.at, rms: round(frame.rms), normalized: peakRms ? round(frame.rms / peakRms) : 0 })),
    },
    pauses,
    onsets,
    tempo,
    beats,
    warnings: [
      '全部结果为 draft 机器推定，不代表听辨歌词、演唱词时间或 verified 节拍。',
      '低能量停顿可能只属于伴奏；能量起音可能来自打击乐或混音，不能用于断言歌词边界。',
      '半速/双速、切分音、拖音、变速、弱拍、短片段与单声道降采样均可能改变 BPM/相位候选。',
      'tempo.confidence 为未经真实歌曲标定的启发式一致性评分，不是检测正确的概率。',
      `时间精度受 ${actualWindow} 秒 RMS 窗和 ${actualHop} 秒步长限制；起音时点使用窗口中心估计。`,
    ],
    limits: { maxDecodedSeconds: MAX_SECONDS, maxPcmBytes: sampleRate * MAX_SECONDS * 4 },
  };
}

/** Decode with bounded async stdout consumption: no shell, API, dependency download, or unbounded output. */
export async function decodeAudio(input, options = {}) {
  const { sampleRate = 8000, start = 0, duration, ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg', maxPcmBytes = sampleRate * MAX_SECONDS * 4, timeoutMs = 120000 } = options;
  validateRate(sampleRate);
  finiteOption(start, 'start');
  if (duration !== undefined) {
    finiteOption(duration, 'duration', { positive: true });
    if (duration > MAX_SECONDS) throw new Error(`duration 超过 ${MAX_SECONDS} 秒上限。`);
  }
  if (!Number.isInteger(maxPcmBytes) || maxPcmBytes < 4 || maxPcmBytes > sampleRate * MAX_SECONDS * 4) throw new Error('maxPcmBytes 必须为不超过默认 PCM 上限的正整数。');
  finiteOption(timeoutMs, 'timeoutMs', { positive: true });
  if (typeof input !== 'string' || !input.trim()) throw new Error('无法读取音频：输入路径不能为空。');
  if (typeof ffmpegPath !== 'string' || !ffmpegPath.trim()) throw new Error('ffmpeg 路径不能为空。');
  const inputPath = resolve(input);
  try {
    if (!(await stat(inputPath)).isFile()) throw new Error('不是普通文件');
    await access(inputPath, constants.R_OK);
  } catch (error) {
    throw new Error(`无法读取音频 ${inputPath}：${error.message}`);
  }
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(start), '-i', inputPath];
  if (duration !== undefined) args.push('-t', String(duration));
  args.push('-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(sampleRate), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1');
  const child = spawn(ffmpegPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let spawnError;
  let streamError;
  let stderr = '';
  child.once('error', error => { spawnError = error; });
  child.stderr.on('data', chunk => { if (stderr.length < 65536) stderr = (stderr + chunk.toString('utf8')).slice(0, 65536); });
  const closed = new Promise(resolveClose => child.once('close', (code, signal) => resolveClose({ code, signal })));
  const timer = setTimeout(() => {
    streamError = new Error('ffmpeg 解码超时；请缩短片段或检查音频。');
    child.kill();
  }, timeoutMs);
  timer.unref();
  const sampleChunks = [];
  let bytes = 0;
  let sampleCount = 0;
  let pending = Buffer.alloc(0);
  try {
    // Async iteration obeys Readable backpressure. Each chunk is released after conversion.
    for await (const chunk of child.stdout) {
      bytes += chunk.length;
      if (bytes > maxPcmBytes) throw new Error(`音频解码超过 ${maxPcmBytes} 字节 PCM 上限；请用 --start 和 --duration 截取不超过 ${MAX_SECONDS} 秒的片段。`);
      const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const completeBytes = data.length - data.length % 4;
      const samples = new Float32Array(completeBytes / 4);
      for (let i = 0; i < samples.length; i++) samples[i] = data.readFloatLE(i * 4);
      sampleChunks.push(samples);
      sampleCount += samples.length;
      pending = Buffer.from(data.subarray(completeBytes));
    }
  } catch (error) {
    streamError ??= error;
    child.kill();
  }
  const result = await closed;
  clearTimeout(timer);
  if (spawnError) throw new Error(`无法启动 ffmpeg：${spawnError.message}。请确认本机 ffmpeg 在 PATH 中，或指定 --ffmpeg 路径。`);
  if (streamError) throw streamError;
  if (result.code !== 0) throw new Error(`ffmpeg 音频解码失败（退出 ${result.code ?? result.signal}）：${stderr.trim() || '没有可用错误输出。'}`);
  if (pending.length || sampleCount === 0) throw new Error('ffmpeg 未输出完整 PCM 样本；检查音频流及截取起点是否超出源文件。');
  // At most two PCM copies coexist here: <=76.8 MB at 16 kHz / 600 s, plus report data.
  const samples = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of sampleChunks) { samples.set(chunk, offset); offset += chunk.length; }
  return samples;
}

export function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const parsed = { input: undefined, start: 0, duration: undefined, out: undefined, sampleRate: 8000, ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg' };
  const names = { '--start': 'start', '--duration': 'duration', '--out': 'out', '--sample-rate': 'sampleRate', '--ffmpeg': 'ffmpegPath', '--bpm': 'bpm', '--bpm-source': 'bpmSource', '--bpm-evidence': 'bpmEvidence' };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument.startsWith('--')) {
      const name = names[argument];
      if (!name) throw new Error(`未知参数 ${argument}。`);
      if (seen.has(name)) throw new Error(`重复参数 ${argument}。`);
      seen.add(name);
      const value = args[++i];
      if (value === undefined || value.startsWith('--') || !value.trim()) throw new Error(`参数 ${argument} 缺少值。`);
      parsed[name] = ['start', 'duration', 'sampleRate', 'bpm'].includes(name) ? Number(value) : value;
    } else if (parsed.input === undefined) parsed.input = argument;
    else throw new Error('用法需要且仅需要一个音频输入路径。');
  }
  if (!parsed.input?.trim()) throw new Error('用法需要一个音频输入路径。');
  finiteOption(parsed.start, 'start');
  if (parsed.duration !== undefined) {
    finiteOption(parsed.duration, 'duration', { positive: true });
    if (parsed.duration > MAX_SECONDS) throw new Error(`duration 不得超过 ${MAX_SECONDS} 秒。`);
  }
  if (![8000, 16000].includes(parsed.sampleRate)) throw new Error('参数 --sample-rate 必须为 8000 或 16000。');
  validateBpmOptions(parsed);
  return parsed;
}

const usage = `用法：node analyze-audio.mjs <audio> [--start 秒] [--duration 秒] [--out report.json]
      [--sample-rate 8000|16000] [--ffmpeg 可执行文件路径]
      [--bpm 已知BPM] [--bpm-source user-provided|metadata] [--bpm-evidence 来源依据]
示例：node analyze-audio.mjs "song with spaces.mp3" --start 37.2 --duration 12 --out report.json
已知速度：--bpm 110；曲目元数据：--bpm 110 --bpm-source metadata --bpm-evidence "曲目页URL及110 BPM记录"
仅用本机 ffmpeg 与 Node 内置模块。默认 8 kHz 单声道 float PCM。
--ffmpeg 优先于 FFMPEG_PATH；未指定时使用 PATH。显式无效路径会失败。
全部结果为 draft 机器候选，不能声称听辨歌词或 verified 节拍。
所有时点为成片秒；sourceOffset 保存 --start。网格：phaseSeconds + n * 60 / bpm。
一次最多分析 600 秒；超长输入会拒绝，请指定片段。PCM 上限为 38.4 MB（16 kHz），
拼接时最多两份 PCM 约 76.8 MB，另有包络及 JSON 内存；短片段更适合人工校对。`;

async function main(args) {
  try {
    const options = parseArgs(args);
    if (options.help) { console.log(usage); return; }
    const inputPath = resolve(options.input);
    if (options.out) {
      const outputPath = resolve(options.out);
      const normalize = path => process.platform === 'win32' ? path.toLowerCase() : path;
      if (normalize(inputPath) === normalize(outputPath)) throw new Error('报告输出不能覆盖源音频。');
    }
    const samples = await decodeAudio(inputPath, options);
    const report = analyzePcm(samples, { sampleRate: options.sampleRate, sourceOffset: options.start, bpm: options.bpm, bpmSource: options.bpmSource, bpmEvidence: options.bpmEvidence });
    const json = JSON.stringify(report, null, 2) + '\n';
    if (options.out) {
      const outputPath = resolve(options.out);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, json, 'utf8');
      console.log(`已保存 draft 音频候选报告：${outputPath}`);
    } else {
      await new Promise((resolveWrite, rejectWrite) => process.stdout.write(json, error => error ? rejectWrite(error) : resolveWrite()));
    }
  } catch (error) {
    console.error(`音频分析失败：${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
