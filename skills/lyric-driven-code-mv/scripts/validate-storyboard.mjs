import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EPSILON = 1e-6;

export function validateStoryboard(data) {
  const errors = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  const object = (value, path) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      fail(path, '必须为对象');
      return null;
    }
    return value;
  };
  const array = (value, path) => {
    if (!Array.isArray(value)) {
      fail(path, '必须为数组');
      return [];
    }
    return value;
  };
  const text = (value, path) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      fail(path, '必须为非空字符串');
      return false;
    }
    return true;
  };
  const finite = (value, path) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(path, '必须为有限数');
      return false;
    }
    return true;
  };
  const id = (value, path, seen) => {
    if (!text(value, path)) return;
    if (seen?.has(value)) fail(path, `重复标识 ${value}`);
    seen?.add(value);
  };
  const uniqueStrings = (value, path) => {
    const seen = new Set();
    array(value, path).forEach((entry, i) => id(entry, `${path}[${i}]`, seen));
    return seen;
  };

  if (!object(data, 'storyboard')) return errors;
  if (data.schemaVersion !== 1) fail('schemaVersion', '必须为 1');
  if (data.timebase !== 'clip') fail('timebase', '必须为 clip；所有时间点使用成片秒');

  const project = object(data.project, 'project') ?? {};
  for (const key of ['fps', 'duration']) {
    if (finite(project[key], `project.${key}`) && project[key] <= 0) fail(`project.${key}`, '必须大于 0');
  }
  if (finite(project.sourceOffset, 'project.sourceOffset') && project.sourceOffset < 0) {
    fail('project.sourceOffset', '必须大于或等于 0；仅记录原曲偏移');
  }
  const dimensions = ['width', 'height', 'virtualWidth', 'virtualHeight'];
  for (const key of dimensions) {
    if (!Number.isInteger(project[key]) || project[key] <= 0) fail(`project.${key}`, '必须为正整数');
  }
  if (dimensions.every(key => Number.isInteger(project[key]) && project[key] > 0)) {
    const scaleX = project.width / project.virtualWidth;
    const scaleY = project.height / project.virtualHeight;
    if (!Number.isInteger(scaleX) || !Number.isInteger(scaleY) || scaleX !== scaleY) {
      fail('project', '输出尺寸的两轴必须为虚拟尺寸的相同正整数倍');
    }
  }
  text(project.seed, 'project.seed');
  const audio = object(project.audio, 'project.audio');
  if (audio) {
    text(audio.path, 'project.audio.path');
    if (!['source', 'clip'].includes(audio.timebase)) fail('project.audio.timebase', '必须为 source 或 clip');
  }

  // sourceOffset is metadata: interval checks always use the unshifted clip clock.
  const duration = project.duration;
  const validDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0;
  const interval = (entry, path) => {
    const startValid = finite(entry.start, `${path}.start`);
    const endValid = finite(entry.end, `${path}.end`);
    if (startValid && entry.start < 0) fail(`${path}.start`, '必须大于或等于 0');
    if (endValid && validDuration && entry.end > duration) fail(`${path}.end`, '不得超过成片 duration');
    if (startValid && endValid && entry.start >= entry.end) fail(path, '必须满足 start < end');
  };

  const lyricIds = new Set();
  const lyricsById = new Map();
  array(data.lyrics, 'lyrics').forEach((value, i) => {
    const path = `lyrics[${i}]`;
    const lyric = object(value, path);
    if (!lyric) return;
    id(lyric.id, `${path}.id`, lyricIds);
    interval(lyric, path);
    text(lyric.text, `${path}.text`);
    if (typeof lyric.id === 'string') lyricsById.set(lyric.id, lyric);
  });

  const music = object(data.music, 'music') ?? {};
  if (!['illustrative', 'draft', 'verified'].includes(music.status)) {
    fail('music.status', '必须为 illustrative、draft 或 verified');
  }
  let previousBeat = -Infinity;
  array(music.beats, 'music.beats').forEach((beat, i) => {
    const path = `music.beats[${i}]`;
    if (!finite(beat, path)) return;
    if (beat < 0 || (validDuration && beat >= duration)) fail(path, '必须位于 [0, duration)');
    if (beat <= previousBeat) fail(path, '节拍必须严格递增');
    previousBeat = beat;
  });
  array(music.sections, 'music.sections').forEach((value, i) => {
    const path = `music.sections[${i}]`;
    const section = object(value, path);
    if (!section) return;
    id(section.id, `${path}.id`);
    interval(section, path);
  });

  const actorIds = new Set();
  const costumesByActor = new Map();
  array(data.actors, 'actors').forEach((value, i) => {
    const path = `actors[${i}]`;
    const actor = object(value, path);
    if (!actor) return;
    id(actor.id, `${path}.id`, actorIds);
    const costumes = uniqueStrings(actor.costumes, `${path}.costumes`);
    if (typeof actor.id === 'string') costumesByActor.set(actor.id, costumes);
  });
  const props = uniqueStrings(data.props, 'props');

  const sceneIds = new Set();
  const scenes = array(data.scenes, 'scenes');
  if (scenes.length === 0) fail('scenes', '必须覆盖完整成片，不能为空');
  let previousScene = null;
  scenes.forEach((value, i) => {
    const path = `scenes[${i}]`;
    const scene = object(value, path);
    if (!scene) return;
    id(scene.id, `${path}.id`, sceneIds);
    interval(scene, path);
    const hasSceneInterval = Number.isFinite(scene.start) && Number.isFinite(scene.end);
    for (const key of ['meaning', 'location', 'objective', 'action', 'feedback', 'outcome', 'exitTransition']) {
      text(scene[key], `${path}.${key}`);
    }
    if (Number.isFinite(scene.start)) {
      if (i === 0 && Math.abs(scene.start) > EPSILON) fail(path, '第一个场景必须从 0 开始');
      if (previousScene && Number.isFinite(previousScene.start) && scene.start < previousScene.start) {
        fail(path, '场景必须按时间排列');
      }
      if (previousScene && Number.isFinite(previousScene.end) && Math.abs(scene.start - previousScene.end) > EPSILON) {
        fail(path, '场景之间不得有空洞或重叠（容差 1e-6 秒）');
      }
    }
    if (i === scenes.length - 1 && Number.isFinite(scene.end) && validDuration && Math.abs(scene.end - duration) > EPSILON) {
      fail(path, '最后一个场景必须结束于 duration');
    }
    previousScene = scene;

    array(scene.lyricIds, `${path}.lyricIds`).forEach((ref, j) => {
      const refPath = `${path}.lyricIds[${j}]`;
      if (!text(ref, refPath)) return;
      const lyric = lyricsById.get(ref);
      if (!lyric) fail(refPath, `不存在歌词 ${ref}`);
      else if (hasSceneInterval && Number.isFinite(lyric.start) && Number.isFinite(lyric.end)
        && !(lyric.start < scene.end && scene.start < lyric.end)) {
        fail(refPath, '歌词区间必须与场景区间相交');
      }
    });
    array(scene.actors, `${path}.actors`).forEach((value, j) => {
      const actorPath = `${path}.actors[${j}]`;
      const actor = object(value, actorPath);
      if (!actor) return;
      const hasId = text(actor.id, `${actorPath}.id`);
      const hasCostume = text(actor.costume, `${actorPath}.costume`);
      if (hasId && !costumesByActor.has(actor.id)) fail(`${actorPath}.id`, `不存在角色 ${actor.id}`);
      else if (hasId && hasCostume && !costumesByActor.get(actor.id).has(actor.costume)) {
        fail(`${actorPath}.costume`, `装束 ${actor.costume} 不属于角色 ${actor.id}`);
      }
    });
    array(scene.props, `${path}.props`).forEach((ref, j) => {
      const refPath = `${path}.props[${j}]`;
      if (text(ref, refPath) && !props.has(ref)) fail(refPath, `不存在道具 ${ref}`);
    });
    let previousEvent = -Infinity;
    array(scene.events, `${path}.events`).forEach((value, j) => {
      const eventPath = `${path}.events[${j}]`;
      const event = object(value, eventPath);
      if (!event) return;
      text(event.action, `${eventPath}.action`);
      if (!finite(event.at, `${eventPath}.at`)) return;
      if (hasSceneInterval && !(event.at >= scene.start && event.at < scene.end)) {
        fail(`${eventPath}.at`, '事件必须位于场景 [start, end)');
      }
      if (event.at < previousEvent) fail(`${eventPath}.at`, '事件必须按 at 非递减排列');
      previousEvent = event.at;
    });
  });
  return errors;
}

function main(args) {
  const usage = '用法：node validate-storyboard.mjs <storyboard.json>\n      node validate-storyboard.mjs --help';
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  if (args.length !== 1) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  let source;
  try {
    source = readFileSync(args[0], 'utf8').replace(/^\uFEFF/u, '');
  } catch (error) {
    console.error(`无法读取 JSON 文件：${error.message}`);
    process.exitCode = 1;
    return;
  }
  let data;
  try {
    data = JSON.parse(source);
  } catch (error) {
    console.error(`JSON 格式错误：${error.message}`);
    process.exitCode = 1;
    return;
  }
  const errors = validateStoryboard(data);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('分镜校验通过。');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
