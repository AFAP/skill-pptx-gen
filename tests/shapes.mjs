/**
 * 形状库几何测试：几何必须可信，否则"新增形状"会变成新的不一致来源。
 *
 * 断言：
 * 1. 每个形状在正方形/非等比包围盒下都能生成有限坐标，且坐标全部落在包围盒内；
 * 2. path/detail 不含 NaN、undefined，闭合形状以 Z 结束；
 * 3. detail 仅在形状表声明时存在，且同样在包围盒内；
 * 4. 形状名与 PptxGenJS ShapeType 的映射完整，没有重复 pptx 名称；
 * 5. exact 标注与几何类别一致（'preset' 才允许被视为两端一致）。
 * 用法：node tests/shapes.mjs
 */
import assert from 'node:assert/strict';
import {
  SHAPE_GEOMETRY, SHAPE_NAMES, buildShape, resolveShape, isShapeElement,
  customPolygonPath, sugarShape,
} from '../core/shape-geometry.mjs';

/** 拆分 path data 为命令序列（本模块只生成 M/L/C/Z 绝对指令） */
function commands(d) {
  const out = [];
  const re = /([MLCZ])([^MLCZ]*)/g;
  let m;
  while ((m = re.exec(d))) {
    out.push({ cmd: m[1], nums: (m[2].match(/-?\d+(?:\.\d+)?/g) || []).map(Number) });
  }
  return out;
}

/**
 * 几何必须落在包围盒内。
 * 三次贝塞尔的**控制点**可以合法地位于包围盒之外（弧段尤其明显），而曲线本身仍在盒内，
 * 因此对曲线上点严格校验、对控制点只做量级合理性校验，避免把正确几何误判为错误。
 */
function assertInBox(d, w, h, label, tol = 0.5) {
  assert.ok(typeof d === 'string' && d.trim().startsWith('M'), `${label}: 必须以 M 开头`);
  assert.ok(!/NaN|undefined|Infinity/.test(d), `${label}: 含非法数值`);
  const onCurve = [];
  const control = [];
  for (const { cmd, nums } of commands(d)) {
    assert.ok(nums.every(Number.isFinite), `${label}: ${cmd} 含非有限坐标`);
    if (cmd === 'M' || cmd === 'L') {
      assert.equal(nums.length, 2, `${label}: ${cmd} 应带 1 个点`);
      onCurve.push([nums[0], nums[1]]);
    } else if (cmd === 'C') {
      assert.equal(nums.length, 6, `${label}: C 应带 3 个点`);
      control.push([nums[0], nums[1]], [nums[2], nums[3]]);
      onCurve.push([nums[4], nums[5]]);
    }
  }
  assert.ok(onCurve.length, `${label}: 没有可校验的曲线上点`);
  for (const [x, y] of onCurve) {
    assert.ok(x >= -tol && x <= w + tol, `${label}: 曲线上点 x=${x} 超出 [0,${w}]`);
    assert.ok(y >= -tol && y <= h + tol, `${label}: 曲线上点 y=${y} 超出 [0,${h}]`);
  }
  for (const [x, y] of control) {
    assert.ok(x >= -w && x <= 2 * w, `${label}: 控制点 x=${x} 量级异常`);
    assert.ok(y >= -h && y <= 2 * h, `${label}: 控制点 y=${y} 量级异常`);
  }
  return onCurve.length;
}

const BOXES = [
  { w: 120, h: 120, label: '120×120' },
  { w: 200, h: 120, label: '200×120' },
  { w: 120, h: 240, label: '120×240' },
];

let checked = 0;
const fidelity = { preset: 0, aspect: 0, approximate: 0 };

for (const name of SHAPE_NAMES) {
  const info = SHAPE_GEOMETRY[name];
  assert.ok(info && typeof info.path === 'function', `${name}: 缺少 path 构造器`);
  assert.ok(['preset', 'aspect', 'approximate'].includes(info.exact), `${name}: exact 标注非法`);
  assert.ok(typeof info.pptx === 'string' && info.pptx, `${name}: 缺少 pptx 名称`);
  fidelity[info.exact] += 1;

  for (const box of BOXES) {
    const built = buildShape({ elType: 'shape-preset', shape: name, width: box.w, height: box.h });
    assert.ok(built, `${name} @${box.label}: 生成失败`);
    assert.equal(built.shape, name);
    assert.equal(built.pptx, info.pptx);
    assert.equal(built.exact, info.exact);
    assertInBox(built.data, box.w, box.h, `${name} @${box.label} path`);

    // 仅弧线/括号类允许开放路径
    const openAllowed = ['arc', 'leftBrace', 'rightBrace'];
    if (!openAllowed.includes(name)) {
      assert.ok(/Z\s*$/.test(built.data.trim()), `${name} @${box.label}: 闭合形状应以 Z 结束`);
    }
    for (const [i, d] of (built.detail || []).entries()) {
      assertInBox(d, box.w, box.h, `${name} @${box.label} detail[${i}]`);
    }
  }
  checked += 1;
}

assert.ok(checked >= 80, `形状数量偏少：${checked}（预期覆盖基础形/箭头/数学/弧/星形/流程图/标注）`);
assert.deepEqual(
  fidelity.preset + fidelity.aspect + fidelity.approximate, checked,
  'exact 分类必须覆盖所有形状',
);
assert.ok(fidelity.preset >= 55, `两端严格一致的形状应占多数，实际 ${fidelity.preset}`);
assert.ok(fidelity.approximate <= 22, `近似形状过多会带来告警噪声，实际 ${fidelity.approximate}`);

// pptx 名称唯一，避免两个 DSL 形状指向同一 preset 造成语义歧义
const pptxNames = SHAPE_NAMES.map(n => SHAPE_GEOMETRY[n].pptx);
assert.equal(new Set(pptxNames).size, pptxNames.length, 'pptx preset 名称出现重复');

// 糖衣类型与 shape-preset 解析一致
assert.equal(resolveShape({ elType: 'shape-preset', shape: 'star5' }), 'star5');
assert.equal(resolveShape({ elType: 'shape-ellipse' }), 'ellipse');
assert.equal(resolveShape({ elType: 'shape-ring' }), 'donut');
assert.equal(resolveShape({ elType: 'shape-wedge' }), 'pie');
assert.equal(resolveShape({ elType: 'shape-arc' }), 'arc');
assert.equal(resolveShape({ elType: 'shape-star', points: 6 }), 'star6');
assert.equal(resolveShape({ elType: 'shape-star', points: 5 }), 'star5');
// 形状表里没有的边数不应退化成别的形状
assert.equal(sugarShape({ elType: 'shape-star', points: 9 }), null);
assert.equal(buildShape({ elType: 'shape-star', points: 9, width: 100, height: 100 }), null);
assert.equal(buildShape({ elType: 'shape-preset', shape: 'not-a-shape', width: 100, height: 100 }), null);
// 缺少尺寸不应静默产出空几何
assert.equal(buildShape({ elType: 'shape-preset', shape: 'rect', width: 0, height: 10 }), null);

for (const t of ['shape-preset', 'shape-ellipse', 'shape-star', 'shape-wedge', 'shape-arc', 'shape-ring']) {
  assert.ok(isShapeElement(t), `${t} 应被识别为形状库元素`);
}
assert.ok(!isShapeElement('shape-rect'), 'shape-rect 由既有实现处理，不进入形状库分支');

// shape-rect / shape-circle 不应被形状库接管（保持既有语义：circle 的 x/y 是圆心）
assert.equal(resolveShape({ elType: 'shape-rect' }), null);
assert.equal(resolveShape({ elType: 'shape-circle' }), null);

// 弧类形状的角度参数必须生效且保持在包围盒内
const pieA = buildShape({ elType: 'shape-preset', shape: 'pie', width: 100, height: 100, angleRange: [0, 90] });
const pieB = buildShape({ elType: 'shape-preset', shape: 'pie', width: 100, height: 100, angleRange: [0, 270] });
assert.notEqual(pieA.data, pieB.data, 'angleRange 必须影响几何');
assert.deepEqual(pieA.angleRange, [0, 90]);
assertInBox(pieA.data, 100, 100, 'pie[0,90]');
assertInBox(pieB.data, 100, 100, 'pie[0,270]');

const block = buildShape({ elType: 'shape-preset', shape: 'blockArc', width: 100, height: 100, angleRange: [180, 360], arcThicknessRatio: 0.3 });
assert.equal(block.arcThicknessRatio, 0.3);
assertInBox(block.data, 100, 100, 'blockArc[180,360]');

// adjust 覆盖默认值
const starDefault = buildShape({ elType: 'shape-preset', shape: 'star5', width: 100, height: 100 });
const starThin = buildShape({ elType: 'shape-preset', shape: 'star5', width: 100, height: 100, adjust: 80000 });
assert.notEqual(starDefault.data, starThin.data, 'adjust 必须影响几何');

// 星形内/外半径比必须按 OOXML 的 50000 满量程解释。
// 锁死这条：star6 = 28868/50000 应精确等于正六角星 {6/2} 的 cos60/cos30，
// 按 100000 误解释会得到一半的值（星形过分尖锐）。
function firstInnerRatio(name, adj) {
  const built = buildShape({ elType: 'shape-preset', shape: name, width: 100, height: 100 });
  const nums = (built.data.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  // M(cx,0) 后第一个 L 是第一个内顶点
  const [x, y] = [nums[2], nums[3]];
  return Math.hypot(x - 50, y - 50) / 50;
}
assert.ok(Math.abs(firstInnerRatio('star6') - Math.cos(Math.PI / 3) / Math.cos(Math.PI / 6)) < 1e-3,
  `star6 内半径比应为 0.5774（正六角星），实际 ${firstInnerRatio('star6').toFixed(4)}`);
assert.ok(Math.abs(firstInnerRatio('star7') - Math.cos(2 * Math.PI / 7) / Math.cos(Math.PI / 7)) < 1e-3,
  `star7 内半径比应为 0.6920（正七角星），实际 ${firstInnerRatio('star7').toFixed(4)}`);
assert.ok(Math.abs(firstInnerRatio('star5') - 19098 / 50000) < 1e-3,
  `star5 内半径比应为 0.38196（经典五角星），实际 ${firstInnerRatio('star5').toFixed(4)}`);
assert.ok(Math.abs(firstInnerRatio('star4') - 12500 / 50000) < 1e-3);

// 立方体轮廓必须是六边形（曾经的多边形会产生缺口，看起来像两个重叠矩形）
const cube = buildShape({ elType: 'shape-preset', shape: 'cube', width: 120, height: 120 });
assert.equal((cube.data.match(/L /g) || []).length, 5, 'cube 轮廓应为 6 个顶点的多边形');
assert.equal(cube.detail.length, 2, 'cube 只需两条内部棱线');

// 自定义多边形（无 preset 对应）同样可用且闭合
const hex = customPolygonPath(100, 100, 6);
assertInBox(hex, 100, 100, 'customPolygon(6)');
assert.ok(/Z\s*$/.test(hex));
const odd = customPolygonPath(100, 60, 9);
assertInBox(odd, 100, 60, 'customPolygon(9)');

// 文档不得与注册表漂移：每个形状名都必须出现在 references/shape-library.md
import { readFileSync } from 'node:fs';
const doc = readFileSync(new URL('../references/shape-library.md', import.meta.url), 'utf8');
const missingInDoc = SHAPE_NAMES.filter(name => !doc.includes('`' + name + '`'));
assert.deepEqual(missingInDoc, [], `shape-library.md 缺少这些形状：${missingInDoc.join(', ')}`);
assert.ok(doc.includes(`全部 ${SHAPE_NAMES.length} 个可用形状名`), `文档里的形状总数应写 ${SHAPE_NAMES.length}`);
// exact 分布也写进文档，避免"悄悄把严格一致的形状标成近似"而不更新说明
assert.ok(doc.includes(`严格一致 ${fidelity.preset} 个`), `文档应写明严格一致 ${fidelity.preset} 个`);
assert.ok(doc.includes(`等比敏感 ${fidelity.aspect} 个`), `文档应写明等比敏感 ${fidelity.aspect} 个`);

console.log(`✅ shape geometry tests passed（${checked} 个形状：严格一致 ${fidelity.preset}，等比敏感 ${fidelity.aspect}，近似 ${fidelity.approximate}）`);
