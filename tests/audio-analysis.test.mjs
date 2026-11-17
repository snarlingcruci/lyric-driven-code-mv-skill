import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../skills/lyric-driven-code-mv/scripts/analyze-audio.mjs', import.meta.url));
const { analyzePcm, decodeAudio, parseArgs } = await import(new URL('../skills/lyric-driven-code-mv/scripts/analyze-audio.mjs', import.meta.url));
const sampleRate = 8000;

// These signals have hand-chosen beat positions, rather than expectations computed by the analyzer.
function pulses(duration = 8, phase = 0.17, period = 0.5, amplitude = 0.8) {
  const samples = new Float32Array(Math.round(duration * sampleRate));
  for (let start = phase; start < duration; start += period) {
    for (let offset = 0; offset < 0.04 * sampleRate; offset++) {
      const index = Math.round(start * sampleRate) + offset;
      if (index < samples.length) samples[index] = amplitude * Math.exp(-offset / (0.012 * sampleRate)) * Math.cos(2 * Math.PI * 600 * offset / sampleRate);
    }
  }
  return samples;
}

function tempDirectory(t) {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, 'lyric audio analysis '));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(root + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function wav(samples) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), 44 + index * 2));
  return buffer;
}

function runCli(args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  return result;
}

test('silence produces a draft energy envelope and pauses but no fabricated BPM or onset', () => {
  assert.equal(typeof analyzePcm, 'function', 'export the pure analysis function');
  const report = analyzePcm(new Float32Array(sampleRate * 4), { sampleRate });
  assert.equal(report.status, 'draft');
  assert.equal(report.timebase, 'clip');
  assert.equal(report.tempo.bpm, null);
  assert.equal(report.tempo.phaseSeconds, null);
  assert.equal(report.tempo.confidence, 0);
  assert.deepEqual(report.onsets, []);
  assert.ok(report.energy.envelope.every(frame => frame.rms === 0 && frame.normalized === 0));
  assert.equal(report.pauses[0].start, 0);
  assert.equal(report.pauses[0].end, 4);
});

test('120 BPM pulses retain their 0.17-second phase instead of forcing a grid to zero', () => {
  const report = analyzePcm(pulses(), { sampleRate });
  assert.ok(Math.abs(report.tempo.bpm - 120) <= 1, JSON.stringify(report.tempo));
  assert.ok(Math.abs(report.tempo.phaseSeconds - 0.17) <= 0.025, JSON.stringify(report.tempo));
  assert.ok(report.tempo.phaseSeconds >= 0 && report.tempo.phaseSeconds < 60 / report.tempo.bpm);
  assert.ok(report.onsets.length >= 14);
  assert.ok(Math.abs(report.onsets[0].at - 0.17) <= 0.025);
  assert.ok(report.tempo.candidates.length > 1);
  assert.ok(report.tempo.candidates.every(candidate => candidate.vote >= 0 && candidate.phaseSeconds >= 0 && candidate.phaseSeconds < 60 / candidate.bpm));
  assert.ok(report.tempo.ambiguities.some(candidate => candidate.relation === 'half' && Math.abs(candidate.bpm - 60) < 1));
});

test('a quiet pulse train below the absolute evidence floor leaves tempo unselected', () => {
  const report = analyzePcm(pulses(8, 0.17, 0.5, 1e-7), { sampleRate });
  assert.equal(report.tempo.bpm, null);
  assert.equal(report.tempo.confidence, 0);
});

test('steady sustained audio is not promoted to beat evidence', () => {
  const samples = Float32Array.from({ length: sampleRate * 6 }, (_, index) => 0.4 * Math.sin(2 * Math.PI * 400 * index / sampleRate));
  const report = analyzePcm(samples, { sampleRate });
  assert.equal(report.tempo.bpm, null);
});

test('insufficient onset count leaves BPM null even when two pulses share an interval', () => {
  const report = analyzePcm(pulses(1.2), { sampleRate });
  assert.equal(report.tempo.bpm, null);
  assert.equal(report.tempo.phaseSeconds, null);
});

test('nonzero source offset is metadata and does not shift the clip envelope, onset, or grid', () => {
  const report = analyzePcm(pulses(), { sampleRate, sourceOffset: 37.2 });
  assert.equal(report.sourceOffset, 37.2);
  assert.equal(report.duration, 8);
  assert.equal(report.energy.envelope[0].at, 0);
  assert.ok(report.onsets.every(onset => onset.at >= 0 && onset.at < 8));
  assert.ok(Math.abs(report.tempo.phaseSeconds - 0.17) <= 0.025);
  assert.ok(report.pauses.every(pause => pause.start >= 0 && pause.end <= 8));
});

test('partial terminal energy frame stays within clip duration and includes its samples', () => {
  const samples = new Float32Array(83).fill(0.5);
  const report = analyzePcm(samples, { sampleRate });
  assert.equal(report.duration, 83 / sampleRate);
  assert.ok(report.energy.envelope.every(frame => frame.at >= 0 && frame.at < report.duration));
  assert.ok(report.energy.envelope.every(frame => Math.abs(frame.rms - 0.5) < 1e-6));
});

test('a fractional-sample duration never rounds a pause end beyond the clip boundary', () => {
  const report = analyzePcm(new Float32Array(3205), { sampleRate: 16000 });
  assert.equal(report.duration, 0.2003125);
  assert.equal(report.pauses[0].end, 0.2003125);
});

test('extreme finite PCM cannot overflow the RMS computation into a bogus report', () => {
  assert.throws(() => analyzePcm(new Float64Array([1e308]), { sampleRate }), /PCM|能量|样本/);
});

test('invalid PCM and analysis options fail clearly before numerical work', () => {
  const valid = pulses();
  for (const samples of [null, [], new Float32Array(), new Float32Array([NaN]), new Float32Array([Infinity])]) {
    assert.throws(() => analyzePcm(samples, { sampleRate }), /PCM|样本|sample/i);
  }
  for (const options of [{ sampleRate: 0 }, { sampleRate: '8000' }, { sourceOffset: -1 }, { sourceOffset: NaN }, { windowSeconds: 0 }, { hopSeconds: Infinity }]) {
    assert.throws(() => analyzePcm(valid, options), /sampleRate|sourceOffset|windowSeconds|hopSeconds/);
  }
});

test('CLI parser rejects duplicate, unknown, missing, nonfinite, and overlong options', () => {
  assert.deepEqual(parseArgs(['song.wav', '--start', '37.2', '--duration', '12', '--out', 'report.json']), { input: 'song.wav', start: 37.2, duration: 12, out: 'report.json', sampleRate: 8000, ffmpegPath: 'ffmpeg' });
  for (const args of [[], ['a', 'b'], ['a', '--start'], ['a', '--start', '-1'], ['a', '--start', 'NaN'], ['a', '--duration', '0'], ['a', '--duration', '601'], ['a', '--start', '0', '--start', '1'], ['a', '--unknown'], ['a', '--sample-rate', '44100']]) {
    assert.throws(() => parseArgs(args), /用法|参数|start|duration|sample-rate|重复|未知/);
  }
});

test('real ffmpeg CLI handles spaces in paths and emits clip timing after an actual nonzero cut', t => {
  const directory = tempDirectory(t);
  const input = join(directory, 'source pulse song.wav');
  const out = join(directory, 'report with spaces.json');
  writeFileSync(input, wav(pulses(10, 0.37)));
  const result = runCli([input, '--start', '2.2', '--duration', '6', '--out', out]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.sourceOffset, 2.2);
  assert.ok(Math.abs(report.duration - 6) < 1 / sampleRate);
  assert.ok(Math.abs(report.onsets[0].at - 0.17) <= 0.025, JSON.stringify(report.onsets.slice(0, 3)));
  assert.ok(Math.abs(report.tempo.bpm - 120) <= 1);
  assert.ok(Math.abs(report.tempo.phaseSeconds - 0.17) <= 0.025);
});

test('decoder byte cap stops ffmpeg and rejects rather than analyzing a silently truncated source', async t => {
  const directory = tempDirectory(t);
  const input = join(directory, 'larger than allowed.wav');
  writeFileSync(input, wav(pulses(2)));
  await assert.rejects(decodeAudio(input, { sampleRate, maxPcmBytes: sampleRate * 4 }), /上限|limit|截取/);
});

test('decoder rejects a nonexistent ffmpeg executable with an actionable error', async t => {
  const directory = tempDirectory(t);
  const input = join(directory, 'valid.wav');
  writeFileSync(input, wav(pulses(1)));
  await assert.rejects(decodeAudio(input, { sampleRate, ffmpegPath: join(directory, 'missing ffmpeg executable') }), /ffmpeg/);
});

test('CLI reports missing inputs and malformed audio without a JavaScript stack', t => {
  const directory = tempDirectory(t);
  const malformed = join(directory, 'bad audio.wav');
  writeFileSync(malformed, 'this is not audio');
  for (const input of [join(directory, 'not found.wav'), malformed]) {
    const result = runCli([input, '--duration', '2']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /读取|音频|ffmpeg/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  }
});

test('CLI refuses an output that would overwrite its source audio', t => {
  const directory = tempDirectory(t);
  const input = join(directory, 'keep source.wav');
  const original = wav(pulses(2));
  writeFileSync(input, original);
  const result = runCli([input, '--duration', '1', '--out', input]);
  assert.equal(result.status, 1);
  assert.deepEqual(readFileSync(input), original);
});

test('CLI help explains draft status and bounded memory without decoding anything', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /draft/);
  assert.match(result.stdout, /600/);
});

test('CLI without --out emits parseable JSON on stdout and draft status for a silent clip', t => {
  const directory = tempDirectory(t);
  const input = join(directory, 'quiet source.wav');
  writeFileSync(input, wav(new Float32Array(sampleRate)));
  const result = runCli([input]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'draft');
  assert.equal(report.tempo.bpm, null);
});

test('CLI rejects a cut beyond EOF instead of emitting an empty tempo report', t => {
  const directory = tempDirectory(t);
  const input = join(directory, 'one second source.wav');
  writeFileSync(input, wav(pulses(1)));
  const result = runCli([input, '--start', '10', '--duration', '2']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PCM|起点/);
  assert.equal(result.stdout, '');
});
