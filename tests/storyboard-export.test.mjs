import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = new URL('../skills/lyric-driven-code-mv/assets/templates/starter/', import.meta.url);
const source = JSON.parse(await readFile(new URL('../skills/lyric-driven-code-mv/assets/storyboard-example.json', import.meta.url), 'utf8'));
const fixture = () => {
  const data = structuredClone(source);
  Object.assign(data.project, { duration: 4, fps: 4, width: 768, height: 432 });
  data.scenes[0].end = 1.5; data.scenes[0].exit = { type: 'dissolve', dur: 0.5 };
  data.scenes[1].start = 1.5; data.scenes[1].end = 4;
  data.lyrics = [{ id: 'new-line', start: 0.2, end: 1.2, text: '新的分镜字幕', en: 'A new cue.' }];
  return data;
};
const setup = async (t, data = fixture()) => {
  const root = await mkdtemp(join(tmpdir(), 'mv-storyboard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'storyboard.json'); await writeFile(path, JSON.stringify(data));
  return { root, path, data };
};

test('JSON改变实际边界、转场、字幕与项目时长，拒绝CLI冲突和未知画法', async t => {
  const { path, data } = await setup(t);
  const exporter = await import(new URL('export.mjs', base));
  const frame = await import(new URL('frame.mjs', base));
  const c = await exporter.loadProject(exporter.parseArgs(['--storyboard', path]));
  assert.deepEqual([c.duration, c.fps, c.width, c.height], [4, 4, 768, 432]);
  const state = frame.resolveTimeline(1.25, c.timeline);
  assert.deepEqual([state.index, state.nextIndex, state.progress], [0, 1, 0.5]);
  assert.equal(frame.resolveTimeline(1.5, c.timeline).local, 0);
  assert.equal(frame.resolveTimeline(99, c.timeline).local, 2.5);
  const ass = exporter.createASS(c);
  assert.match(ass, /新的分镜字幕/); assert.match(ass, /A new cue/);
  assert.doesNotMatch(ass, /送一盏小灯到对岸/);
  const hash = f => createHash('sha256').update(f.data).digest('hex');
  assert.notEqual(hash(frame.renderFrame(2, { timeline: c.timeline })), hash(frame.renderFrame(2)));
  await assert.rejects(() => exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--fps', '30'])), /冲突/);
  data.scenes[0].id = 'no-draw-handler'; await writeFile(path, JSON.stringify(data));
  await assert.rejects(() => exporter.loadProject(exporter.parseArgs(['--storyboard', path])), /画法|镜头/);
});

test('draft自动全时段标识，真实歌曲必须输入音轨，恢复拒绝更换JSON或音频内容', async t => {
  const data = fixture(); data.music.status = 'draft'; data.project.audio.timebase = 'source'; data.project.sourceOffset = 2;
  const { root, path } = await setup(t, data);
  const exporter = await import(new URL('export.mjs', base));
  await assert.rejects(() => exporter.loadProject(exporter.parseArgs(['--storyboard', path])), /音轨|音频/);
  const audio = join(root, 'song.wav'); await writeFile(audio, exporter.synthesizeWAV());
  const c = await exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--audio', audio, '--frames-dir', join(root, 'frames')]));
  assert.equal(c.audioStart, 2); assert.match(exporter.createASS(c), /待核对落点/);
  assert.match(exporter.createASS(c), /0:00:04\.00,Notice/);
  await exporter.prepareFrames(c, () => {});
  const manifest = JSON.parse(await readFile(join(root, 'frames', 'render-config.json'), 'utf8'));
  assert.equal(manifest.frameCount, 16);
  data.lyrics[0].text = '修改后的字幕'; await writeFile(path, JSON.stringify(data));
  const changed = await exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--audio', audio, '--frames-dir', join(root, 'frames'), '--resume']));
  await assert.rejects(() => exporter.prepareFrames(changed, () => {}), /配置|源码/);
  await writeFile(path, JSON.stringify(fixture()));
  await writeFile(audio, Buffer.from('different audio bytes'));
  const changedAudio = await exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--audio', audio, '--frames-dir', join(root, 'frames'), '--resume']));
  await assert.rejects(() => exporter.prepareFrames(changedAudio, () => {}), /配置|源码/);
});

test('真实音轨按sourceOffset裁剪且JSON决定输出音视频时长', async t => {
  const { requireMediaTools } = await import('./media-tools.mjs');
  const tools = requireMediaTools(t, ['ffmpeg', 'ffprobe']); if (!tools) return;
  const data = fixture(); data.music.status = 'draft'; data.project.audio.timebase = 'source'; data.project.sourceOffset = 2;
  const { root, path } = await setup(t, data);
  const audio = join(root, 'source.wav');
  const generated = spawnSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=if(lt(t\\,2)\\,0\\,0.2*sin(2*PI*440*t)):s=48000:d=8', '-y', audio], { windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const exporter = await import(new URL('export.mjs', base));
  const c = exporter.parseArgs(['--storyboard', path, '--audio', audio, '--out', join(root, 'actual.mp4'), '--ffmpeg', tools.ffmpeg, '--ffprobe', tools.ffprobe]);
  const result = await exporter.exportVideo(c, () => {});
  assert.ok(Math.abs(Number(result.format.duration) - 4) < 0.04);
  assert.equal(result.streams.find(s => s.codec_type === 'video').nb_frames, '16');
  const pcm = spawnSync(tools.ffmpeg, ['-v', 'error', '-i', c.out, '-t', '0.25', '-f', 'f32le', '-ac', '1', 'pipe:1'], { windowsHide: true });
  assert.equal(pcm.status, 0);
  let energy = 0; for (let i = 0; i + 4 <= pcm.stdout.length; i += 4) energy += pcm.stdout.readFloatLE(i) ** 2;
  assert.ok(energy / (pcm.stdout.length / 4) > 0.005, '裁剪后第一拍应来自原曲2秒后的有声区');
  data.project.sourceOffset = 7.5; await writeFile(path, JSON.stringify(data));
  await assert.rejects(() => exporter.exportVideo(c, () => {}), /短|长度|时长/);
});
