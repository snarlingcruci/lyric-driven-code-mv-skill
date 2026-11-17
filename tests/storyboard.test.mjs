import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateStoryboard } from '../skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs';

const script = fileURLToPath(new URL('../skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs', import.meta.url));

function validStoryboard() {
  const scene = (id, start, end, lyricIds, actor) => ({
    id, start, end, lyricIds,
    meaning: '保存共同的记忆', location: '雪地木屋', objective: '保留礼物',
    action: '把礼物放上搁板', feedback: '显示保留徽标', outcome: '礼物成为纪念物',
    actors: [actor], props: ['gift'], events: [{ at: start + 1, action: 'raise-gift', hud: '保留' }],
    exitTransition: 'pixel-wipe',
  });
  return {
    schemaVersion: 1, timebase: 'clip',
    project: {
      fps: 30, duration: 12, sourceOffset: 120, width: 1920, height: 1080,
      virtualWidth: 320, virtualHeight: 180, seed: 'winter-song',
      audio: { path: 'assets/music.wav', timebase: 'source' },
    },
    lyrics: [{ id: 'line-a', start: 1, end: 3, text: '把回忆保留' }, { id: 'line-b', start: 8, end: 12, text: '再次想起你' }],
    music: { status: 'draft', beats: [0, 2, 4, 6, 8, 10], sections: [{ id: 'verse', start: 0, end: 12 }] },
    actors: [{ id: '1p', costumes: ['red-knit', 'winter-coat'] }, { id: '2p', costumes: ['red-knit'] }],
    props: ['gift', 'star'],
    scenes: [scene('keep', 0, 6, ['line-a'], { id: '1p', costume: 'red-knit' }), scene('remember', 6, 12, ['line-b'], { id: '2p', costume: 'red-knit' })],
  };
}

test('accepts a complete clip storyboard while sourceOffset only records the original song offset', () => {
  const data = validStoryboard();
  data.extraNotes = { intentionallyUnknown: true };
  assert.deepEqual(validateStoryboard(data), []);
  data.project.audio.timebase = 'clip';
  assert.deepEqual(validateStoryboard(data), []);
});

test('accepts lyric-free scenes and music sections that do not tile the full clip', () => {
  const data = validStoryboard();
  data.scenes[0].lyricIds = [];
  data.music.sections = [{ id: 'short', start: 2, end: 4 }, { id: 'overlap', start: 3, end: 5 }];
  data.music.beats = [];
  data.music.status = 'illustrative';
  assert.deepEqual(validateStoryboard(data), []);
  data.music.status = 'verified';
  assert.deepEqual(validateStoryboard(data), []);
});

test('accepts a scene seam difference smaller than the 1e-6 coverage tolerance', () => {
  const data = validStoryboard();
  data.scenes[1].start += 5e-7;
  assert.deepEqual(validateStoryboard(data), []);
});

test('accepts simultaneous scene events and an event on the following scene start', () => {
  const data = validStoryboard();
  data.scenes[1].events = [{ at: 6, action: 'enter' }, { at: 6, action: 'show-hud', hud: { count: 0 } }];
  assert.deepEqual(validateStoryboard(data), []);
});

// Each case names a real invariant: removing its check must make this assertion fail.
const invalidCases = [
  ['source-time lyric mixed into a 12-second clip', d => { d.lyrics[0].start = 121; d.lyrics[0].end = 123; }, /lyrics\[0\]/],
  ['source-time beat mixed into a 12-second clip', d => { d.music.beats = [120]; }, /music\.beats\[0\]/],
  ['source-time scene event mixed into a 12-second clip', d => { d.scenes[0].events[0].at = 121; }, /scenes\[0\]\.events\[0\]\.at/],
  ['root source timebase', d => { d.timebase = 'source'; }, /timebase/],
  ['wrong schema version', d => { d.schemaVersion = 2; }, /schemaVersion/],
  ['nonpositive fps', d => { d.project.fps = 0; }, /project\.fps/],
  ['infinite duration', d => { d.project.duration = Infinity; }, /project\.duration/],
  ['numeric-string fps', d => { d.project.fps = '30'; }, /project\.fps/],
  ['negative source offset', d => { d.project.sourceOffset = -1; }, /project\.sourceOffset/],
  ['NaN source offset', d => { d.project.sourceOffset = NaN; }, /project\.sourceOffset/],
  ['noninteger output dimension', d => { d.project.width = 1920.5; }, /project\.width/],
  ['zero virtual dimension', d => { d.project.virtualHeight = 0; }, /project\.virtualHeight/],
  ['noninteger pixel scale', d => { d.project.width = 1919; }, /project/],
  ['different integer scales on the two axes', d => { d.project.height = 900; }, /project/],
  ['blank deterministic seed', d => { d.project.seed = ' '; }, /project\.seed/],
  ['blank audio path', d => { d.project.audio.path = ''; }, /project\.audio\.path/],
  ['invalid audio timebase', d => { d.project.audio.timebase = 'song'; }, /project\.audio\.timebase/],
  ['missing audio object', d => { delete d.project.audio; }, /project\.audio/],
  ['duplicate lyric ids', d => { d.lyrics[1].id = 'line-a'; }, /lyrics\[1\]\.id/],
  ['zero-duration lyric', d => { d.lyrics[0].end = d.lyrics[0].start; }, /lyrics\[0\]/],
  ['negative lyric start', d => { d.lyrics[0].start = -1; }, /lyrics\[0\]\.start/],
  ['blank lyric text', d => { d.lyrics[0].text = ' '; }, /lyrics\[0\]\.text/],
  ['beat on exclusive clip end', d => { d.music.beats.push(12); }, /music\.beats\[6\]/],
  ['duplicate beats', d => { d.music.beats = [0, 2, 2]; }, /music\.beats\[2\]/],
  ['descending beats', d => { d.music.beats = [0, 4, 2]; }, /music\.beats\[2\]/],
  ['negative beat', d => { d.music.beats = [-1, 0]; }, /music\.beats\[0\]/],
  ['nonfinite beat', d => { d.music.beats = [NaN]; }, /music\.beats\[0\]/],
  ['invalid analysis status', d => { d.music.status = 'measured'; }, /music\.status/],
  ['section beyond clip duration', d => { d.music.sections[0].end = 13; }, /music\.sections\[0\]/],
  ['reversed section', d => { d.music.sections[0].start = 5; d.music.sections[0].end = 4; }, /music\.sections\[0\]/],
  ['duplicate actor identities', d => { d.actors[1].id = '1p'; }, /actors\[1\]\.id/],
  ['duplicate costume within an actor', d => { d.actors[0].costumes.push('red-knit'); }, /actors\[0\]\.costumes/],
  ['duplicate root prop', d => { d.props.push('gift'); }, /props/],
  ['unknown actor reference', d => { d.scenes[0].actors[0].id = '3p'; }, /scenes\[0\]\.actors\[0\]\.id/],
  ['costume belonging to a different actor', d => { d.scenes[1].actors[0].costume = 'winter-coat'; }, /scenes\[1\]\.actors\[0\]\.costume/],
  ['unknown prop reference', d => { d.scenes[0].props.push('lantern'); }, /scenes\[0\]\.props\[1\]/],
  ['unknown lyric reference', d => { d.scenes[0].lyricIds = ['missing']; }, /scenes\[0\]\.lyricIds\[0\]/],
  ['lyric reference outside scene interval', d => { d.scenes[0].lyricIds = ['line-b']; }, /scenes\[0\]\.lyricIds\[0\]/],
  ['lyric touching but not intersecting a scene end', d => { d.lyrics[0].start = 6; d.lyrics[0].end = 7; }, /scenes\[0\]\.lyricIds\[0\]/],
  ['duplicate scene ids', d => { d.scenes[1].id = 'keep'; }, /scenes\[1\]\.id/],
  ['initial uncovered clip interval', d => { d.scenes[0].start = 0.01; }, /scenes/],
  ['middle uncovered clip interval', d => { d.scenes[1].start = 6.01; }, /scenes/],
  ['overlapping scene intervals', d => { d.scenes[1].start = 5.99; }, /scenes/],
  ['trailing uncovered clip interval', d => { d.scenes[1].end = 11; d.lyrics[1].end = 11; }, /scenes/],
  ['scenes out of chronological order', d => { d.scenes.reverse(); }, /scenes/],
  ['empty scene list cannot cover a positive clip', d => { d.scenes = []; }, /scenes/],
  ['event at preceding scene exclusive end', d => { d.scenes[0].events.push({ at: 6, action: 'leave' }); }, /scenes\[0\]\.events\[1\]\.at/],
  ['event just before scene start without tolerance relaxation', d => { d.scenes[1].events[0].at = 6 - 1e-8; }, /scenes\[1\]\.events\[0\]\.at/],
  ['events out of chronological order', d => { d.scenes[0].events.push({ at: 0.5, action: 'early' }); }, /scenes\[0\]\.events\[1\]\.at/],
  ['blank event action', d => { d.scenes[0].events[0].action = ''; }, /scenes\[0\]\.events\[0\]\.action/],
  ['malformed nested scene entry', d => { d.scenes[0] = null; }, /scenes\[0\]/],
  ['missing required lyric array', d => { delete d.lyrics; }, /lyrics/],
  ['non-numeric interval object in lyric start', d => { d.lyrics[0].start = { valueOf: null, toString: null }; }, /lyrics\[0\]\.start/],
  ['non-numeric interval object in lyric end', d => { d.lyrics[0].end = { valueOf: null, toString: null }; }, /lyrics\[0\]\.end/],
  ['non-numeric interval object in scene start', d => { d.scenes[0].start = { valueOf: null, toString: null }; d.scenes[0].lyricIds = []; }, /scenes\[0\]\.start/],
  ['non-numeric interval object in scene end', d => { d.scenes[0].end = { valueOf: null, toString: null }; d.scenes[0].lyricIds = []; }, /scenes\[0\]\.end/],
];

for (const field of ['meaning', 'location', 'objective', 'action', 'feedback', 'outcome', 'exitTransition']) {
  invalidCases.push([`blank scene ${field}`, d => { d.scenes[0][field] = ' '; }, new RegExp(`scenes\\[0\\]\\.${field}`)]);
}

for (const [name, mutate, expectedPath] of invalidCases) {
  test(`rejects ${name}`, () => {
    const data = validStoryboard();
    mutate(data);
    const errors = validateStoryboard(data);
    assert.ok(Array.isArray(errors) && errors.every(e => typeof e === 'string'));
    assert.ok(errors.some(e => expectedPath.test(e)), `Expected an error for ${expectedPath}; got ${JSON.stringify(errors)}`);
  });
}

test('rejects non-object root data without throwing', () => {
  for (const value of [null, [], 'text', 1]) {
    assert.ok(validateStoryboard(value).length > 0);
  }
});

function runCli(args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined);
  return result;
}

function temporaryJson(t, content) {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, 'lyric-storyboard-test-'));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(root + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'storyboard.json');
  writeFileSync(path, content, 'utf8');
  return path;
}

test('CLI accepts a valid UTF-8 JSON file with BOM and exits zero', t => {
  const path = temporaryJson(t, '\uFEFF' + JSON.stringify(validStoryboard()));
  const result = runCli([path]);
  assert.equal(result.status, 0, result.stderr);
});

test('CLI exits one and explains a storyboard range error', t => {
  const data = validStoryboard();
  data.music.beats = [120];
  const result = runCli([temporaryJson(t, JSON.stringify(data))]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /music\.beats\[0\]/);
});

test('CLI reports malformed JSON without a JavaScript stack', t => {
  const result = runCli([temporaryJson(t, '{ "project":')]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSON/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('CLI reports malformed time fields as validation errors without a JavaScript stack', t => {
  const data = validStoryboard();
  data.scenes[0].start = { valueOf: null, toString: null };
  data.scenes[0].lyricIds = [];
  const result = runCli([temporaryJson(t, JSON.stringify(data))]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /scenes\[0\]\.start/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('CLI reports unreadable paths without a JavaScript stack', t => {
  const path = temporaryJson(t, '{}') + '.missing';
  const result = runCli([path]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /读取|read/i);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('CLI --help prints usage and exits zero', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /用法|usage/i);
});

test('CLI missing or extra input paths print usage and exit one', () => {
  for (const args of [[], ['one.json', 'two.json']]) {
    const result = runCli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /用法|usage/i);
  }
});
