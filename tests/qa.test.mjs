import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSampleTimes, runDeterminismQA } from '../skills/lyric-driven-code-mv/scripts/qa.mjs';

const frame = value => ({ width: 1, height: 1, data: new Uint8ClampedArray([value, 0, 0, 255]) });

test('纯时间求值在重复、逆序和乱序请求中一致', async () => {
  const result = await runDeterminismQA(t => frame(Math.round(t * 10)), { times: [0, 0.5, 1] });
  assert.equal(result.status, 'pass');
  assert.equal(result.renderCount, 12);
  assert.deepEqual(result.failures, []);
});

test('累积上一帧状态会被检测出来', async () => {
  let state = 0;
  const result = await runDeterminismQA(() => frame(++state), { times: [0, 0.5, 1] });
  assert.equal(result.status, 'fail');
  assert.ok(result.failures.some(f => f.order === 'reverse'));
});

test('检查覆盖首尾、镜头边界、转场中点和HUD事件', () => {
  const times = collectSampleTimes({ duration: 12, fps: 30, samples: 2, scenes: [
    { start: 0, end: 6, exit: { type: 'water', dur: 0.9 }, events: [{ at: 3.5, hud: '未抵达' }] },
    { start: 6, end: 12 }
  ] });
  for (const t of [0, 3.5, 5.1, 5.55, 6, 12 - 1 / 30]) {
    assert.ok(times.some(sample => Math.abs(sample - t) < 1e-7), `缺少 ${t}`);
  }
  assert.ok(times.every(t => t >= 0 && t < 12));
});

test('同一像素内容但尺寸不同也会失败', async () => {
  let count = 0;
  const result = await runDeterminismQA(() => ({ width: ++count % 2 ? 1 : 2, height: count % 2 ? 2 : 1, data: new Uint8Array(8) }), { times: [0] });
  assert.equal(result.status, 'fail');
});

test('拒绝损坏的帧和无效抽样参数', async () => {
  await assert.rejects(runDeterminismQA(() => ({ width: 2, height: 2, data: new Uint8Array(4) }), { times: [0] }), /RGBA/);
  await assert.rejects(runDeterminismQA(() => frame(1), { times: [NaN] }), /时间/);
  assert.throws(() => collectSampleTimes({ duration: 0, fps: 30 }), /duration/);
});

test('复用同一帧缓冲时立即计算哈希，不受随后写入影响', async () => {
  const reusable = frame(0);
  const result = await runDeterminismQA(async t => {
    reusable.data[0] = Math.round(t * 10);
    return reusable;
  }, { times: [0, 0.5, 1] });
  assert.equal(result.status, 'pass');
});
