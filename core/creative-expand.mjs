/**
 * Low-token creative composition macros.
 *
 * These constructs only exist in source decks. They are expanded into the existing
 * primitive scene before token resolution, validation, Konva preview and PPTX export,
 * so both renderers continue to consume one canonical representation.
 */

export const COMPOSITION_TYPES = ['group', 'repeat'];

function ptr(...parts) {
  return '/' + parts.map(p => String(p).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
}

function classNames(value) {
  if (Array.isArray(value)) return value.flatMap(classNames);
  if (typeof value !== 'string') return [];
  return value.split(/\s+/).map(v => v.trim()).filter(Boolean);
}

function applyStyleClasses(raw, styleClasses, defaults = {}) {
  const merged = { ...defaults };
  for (const name of classNames(raw?.styleClass)) {
    const spec = styleClasses?.[name];
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error(`未知 styleClass: ${name}`);
    Object.assign(merged, spec);
  }
  Object.assign(merged, raw || {});
  delete merged.styleClass;
  return merged;
}

function lookup(data, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  let value = data;
  for (const part of parts) {
    if (value == null || typeof value !== 'object' || !(part in value)) return undefined;
    value = value[part];
  }
  return value;
}

function interpolate(value, vars) {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (exact) {
      const found = lookup(vars, exact[1]);
      return found === undefined ? value : structuredClone(found);
    }
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
      const found = lookup(vars, key);
      return found === undefined ? match : String(found);
    });
  }
  if (Array.isArray(value)) return value.map(item => interpolate(item, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, vars)]));
  }
  return value;
}

function scalePoint(point, scale, offsetX, offsetY, local) {
  const out = { ...point };
  if (Number.isFinite(out.x)) out.x = out.x * scale + (local ? 0 : offsetX);
  if (Number.isFinite(out.y)) out.y = out.y * scale + (local ? 0 : offsetY);
  if (out.controlPoint) out.controlPoint = scalePoint(out.controlPoint, scale, offsetX, offsetY, local);
  if (out.curve && typeof out.curve === 'object') {
    out.curve = { ...out.curve };
    for (const key of ['x1', 'x2', 'wR', 'hR']) {
      if (Number.isFinite(out.curve[key])) out.curve[key] *= scale;
    }
    for (const key of ['y1', 'y2']) {
      if (Number.isFinite(out.curve[key])) out.curve[key] *= scale;
    }
    if (!local) {
      for (const key of ['x1', 'x2']) if (Number.isFinite(out.curve[key])) out.curve[key] += offsetX;
      for (const key of ['y1', 'y2']) if (Number.isFinite(out.curve[key])) out.curve[key] += offsetY;
    }
  }
  return out;
}

function transformPrimitive(el, ctx) {
  const out = { ...el };
  const { offsetX, offsetY, scale, opacity } = ctx;
  const localPath = out.elType === 'shape-path' || out.elType === 'curve-quadratic';
  if (Number.isFinite(out.x)) out.x = offsetX + out.x * scale;
  else if (localPath && offsetX !== 0) out.x = offsetX;
  if (Number.isFinite(out.y)) out.y = offsetY + out.y * scale;
  else if (localPath && offsetY !== 0) out.y = offsetY;
  for (const key of ['width', 'height', 'radius', 'rOuter', 'rInner']) {
    if (Number.isFinite(out[key])) out[key] *= scale;
  }
  for (const key of ['x1', 'x2', 'cx']) if (Number.isFinite(out[key])) out[key] = offsetX + out[key] * scale;
  for (const key of ['y1', 'y2', 'cy']) if (Number.isFinite(out[key])) out[key] = offsetY + out[key] * scale;
  if (Array.isArray(out.pointArr)) {
    out.pointArr = out.pointArr.map(point => scalePoint(point, scale, offsetX, offsetY, localPath));
  }
  for (const key of ['fontSize', 'strokeWidth', 'lineWidth', 'cornerRadius', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'padding', 'letterSpacing']) {
    if (Number.isFinite(out[key]) && scale !== 1) out[key] *= scale;
  }
  if (out.anchor && typeof out.anchor === 'object') {
    out.anchor = { ...out.anchor };
    for (const key of ['gap', 'dx', 'dy']) if (Number.isFinite(out.anchor[key])) out.anchor[key] *= scale;
    if (!Number.isFinite(out.x)) out.x = offsetX;
    if (!Number.isFinite(out.y)) out.y = offsetY;
  }
  if (opacity !== 1) out.opacity = (out.opacity ?? 1) * opacity;
  return out;
}

function prefixedId(id, prefix, fallback) {
  if (id) return prefix ? `${prefix}-${id}` : id;
  return prefix ? `${prefix}-${fallback}` : fallback;
}

function rewriteAnchor(anchor, prefix) {
  if (!anchor || typeof anchor !== 'object' || !anchor.to) return anchor;
  const absolute = String(anchor.to).startsWith('#');
  const raw = absolute ? String(anchor.to).slice(1) : String(anchor.to);
  return { ...anchor, to: !absolute && prefix ? `${prefix}-${raw}` : raw };
}

function exactBindingPath(text, bindingBase, vars) {
  if (!bindingBase || typeof text !== 'string') return undefined;
  const match = text.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
  if (!match || ['index', 'number'].includes(match[1])) return undefined;
  if (match[1] === 'value' && (vars.item == null || typeof vars.item !== 'object' || Array.isArray(vars.item))) return bindingBase;
  if (match[1] === 'item') return bindingBase;
  const itemPath = match[1].startsWith('item.') ? match[1].slice(5) : match[1];
  if (lookup(vars.item, itemPath) === undefined) return undefined;
  return `${bindingBase}/${itemPath.split('.').map(p => p.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function boundsOf(el) {
  const width = el.radius != null ? el.radius * 2 : el.width;
  const height = el.radius != null ? el.radius * 2 : (el.height ?? width);
  if (![width, height].every(Number.isFinite)) return null;
  if (el.elType === 'shape-circle') return { x: el.x - width / 2, y: el.y - height / 2, width, height };
  if (![el.x, el.y].every(Number.isFinite)) return null;
  return { x: el.x, y: el.y, width, height };
}

function placeBounds(el, x, y) {
  if (el.elType === 'shape-circle') {
    const width = el.radius != null ? el.radius * 2 : el.width;
    const height = el.radius != null ? el.radius * 2 : (el.height ?? width);
    el.x = x + width / 2;
    el.y = y + height / 2;
  } else {
    el.x = x;
    el.y = y;
  }
}

function resolveAnchors(elements) {
  const placed = new Map();
  for (const el of elements) {
    if (el.anchor) {
      const target = placed.get(el.anchor.to);
      const self = boundsOf(el);
      if (!target) throw new Error(`anchor.to 引用了尚未出现的元素: ${el.anchor.to}`);
      if (!self) throw new Error(`带 anchor 的元素 ${el.id || el.elType} 缺少 width/height`);
      const edge = el.anchor.edge || 'right';
      const gap = el.anchor.gap ?? 0;
      const align = el.anchor.align || 'center';
      let x = self.x, y = self.y;
      const alignedY = () => align === 'top' ? target.y : align === 'bottom' ? target.y + target.height - self.height : target.y + (target.height - self.height) / 2;
      const alignedX = () => align === 'left' ? target.x : align === 'right' ? target.x + target.width - self.width : target.x + (target.width - self.width) / 2;
      if (edge === 'right') { x = target.x + target.width + gap; y = alignedY(); }
      else if (edge === 'left') { x = target.x - self.width - gap; y = alignedY(); }
      else if (edge === 'bottom') { x = alignedX(); y = target.y + target.height + gap; }
      else if (edge === 'top') { x = alignedX(); y = target.y - self.height - gap; }
      else if (edge === 'center') { x = target.x + (target.width - self.width) / 2; y = target.y + (target.height - self.height) / 2; }
      else throw new Error(`anchor.edge 无法识别: ${edge}`);
      placeBounds(el, x + (el.anchor.dx || 0), y + (el.anchor.dy || 0));
      delete el.anchor;
    }
    if (el.id) {
      const bounds = boundsOf(el);
      if (bounds) placed.set(el.id, bounds);
    }
  }
  return elements;
}

/** Expand group/repeat/styleClass/anchor into plain primitive elements. */
export function expandCreativeElements(elements, { styleClasses = {}, slideIndex = 0 } = {}) {
  if (!Array.isArray(elements)) return [];
  let autoId = 0;

  const expandNode = (raw, ctx, options = {}) => {
    const sourceText = raw?.text;
    const interpolated = options.vars ? interpolate(raw, options.vars) : structuredClone(raw);
    const el = applyStyleClasses(interpolated, styleClasses, ctx.defaults);
    if (!el || typeof el !== 'object') throw new Error('组合元素必须是对象');

    if (el.elType === 'group') {
      if (!Array.isArray(el.elements) || !el.elements.length) throw new Error(`group ${el.id || ''} 缺少 elements`);
      const ownScale = el.scale ?? 1;
      if (!Number.isFinite(ownScale) || ownScale <= 0) throw new Error(`group ${el.id || ''} 的 scale 必须 > 0`);
      const groupId = el.id || `group${autoId++}`;
      const prefix = prefixedId(groupId, ctx.prefix, groupId);
      const next = {
        ...ctx,
        offsetX: ctx.offsetX + (el.x || 0) * ctx.scale,
        offsetY: ctx.offsetY + (el.y || 0) * ctx.scale,
        scale: ctx.scale * ownScale,
        opacity: ctx.opacity * (el.opacity ?? 1),
        prefix,
        defaults: { ...ctx.defaults, ...(el.defaults || {}) },
      };
      return el.elements.flatMap((child, index) => expandNode(child, next, {
        ...options,
        sourcePathBase: options.sourcePathBase ? `${options.sourcePathBase}/elements/${index}` : undefined,
      }));
    }

    if (el.elType === 'repeat') {
      const items = el.items;
      const template = Array.isArray(el.template) ? el.template : (el.template ? [el.template] : []);
      if (!Array.isArray(items) || !items.length) throw new Error(`repeat ${el.id || ''} 缺少 items`);
      if (!template.length) throw new Error(`repeat ${el.id || ''} 缺少 template`);
      const columns = el.columns == null ? null : Number(el.columns);
      if (columns != null && (!Number.isInteger(columns) || columns < 1)) throw new Error(`repeat ${el.id || ''} 的 columns 必须是正整数`);
      const ownScale = el.scale ?? 1;
      if (!Number.isFinite(ownScale) || ownScale <= 0) throw new Error(`repeat ${el.id || ''} 的 scale 必须 > 0`);
      const repeatId = el.id || `repeat${autoId++}`;
      const basePrefix = prefixedId(repeatId, ctx.prefix, repeatId);
      return items.flatMap((item, index) => {
        const col = columns == null ? index : index % columns;
        const row = columns == null ? index : Math.floor(index / columns);
        const next = {
          ...ctx,
          offsetX: ctx.offsetX + ((el.x || 0) + col * (el.stepX || 0)) * ctx.scale,
          offsetY: ctx.offsetY + ((el.y || 0) + row * (el.stepY || 0)) * ctx.scale,
          scale: ctx.scale * ownScale,
          opacity: ctx.opacity * (el.opacity ?? 1),
          prefix: `${basePrefix}-${index}`,
          defaults: { ...ctx.defaults, ...(el.defaults || {}) },
        };
        const vars = { item, index, number: index + 1, ...(item && typeof item === 'object' && !Array.isArray(item) ? item : { value: item }) };
        const bindingBase = options.sourcePathBase ? `${options.sourcePathBase}/items/${index}` : undefined;
        return template.flatMap((child, childIndex) => expandNode(child, next, {
          vars,
          bindingBase,
          suppressAutoSourcePath: true,
          sourcePathBase: options.sourcePathBase ? `${options.sourcePathBase}/template/${childIndex}` : undefined,
        }));
      });
    }

    if (!el.elType) throw new Error('元素缺少 elType');
    if (el.id || ctx.prefix) el.id = prefixedId(el.id, ctx.prefix, `item${autoId++}`);
    if (el.anchor) el.anchor = rewriteAnchor(el.anchor, ctx.prefix);
    if (el.elType === 'text' && !el.sourcePath) {
      const bound = exactBindingPath(sourceText, options.bindingBase, options.vars || {});
      if (bound) el.sourcePath = bound;
      // repeat 中的固定、拼接或 index/number 文本没有唯一可安全回写的源字段。
      // 用内部标记阻止 compile-deck 为它伪造展开后数组索引；标记在编译阶段移除。
      else if (options.suppressAutoSourcePath) el._sourcePathDerived = true;
      else if (!options.suppressAutoSourcePath && options.sourcePathBase) el.sourcePath = `${options.sourcePathBase}/text`;
    }
    return [transformPrimitive(el, ctx)];
  };

  const root = { offsetX: 0, offsetY: 0, scale: 1, opacity: 1, prefix: '', defaults: {} };
  const expanded = elements.flatMap((element, index) => expandNode(element, root, {
    sourcePathBase: ptr('slides', slideIndex, 'elements', index),
  }));
  return resolveAnchors(expanded);
}
