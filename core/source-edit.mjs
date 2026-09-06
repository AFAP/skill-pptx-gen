/** Transactional source edits shared by the preview and round-trip tests. */
import { compileDeck } from './compile-deck.mjs';
import { validateDeck } from './dsl-validate.mjs';

export function editDeckText(source, pointer, text, previousDeck) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error('文字没有可回写的源路径');
  const parts = pointer.slice(1).split('/').map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (parts.some(p => ['__proto__', 'prototype', 'constructor'].includes(p))) throw new Error('不安全的源路径');
  const next = structuredClone(source);
  let parent = next;
  for (const part of parts.slice(0, -1)) {
    if (parent == null || !Object.hasOwn(parent, part)) throw new Error(`源路径不存在: ${pointer}`);
    parent = parent[part];
  }
  const key = parts.at(-1);
  if (parent == null || !Object.hasOwn(parent, key)) throw new Error(`源路径不存在: ${pointer}`);
  const old = parent[key];
  let value = String(text);
  if (typeof old === 'number') {
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`${pointer}: 请输入有限数字`);
    value = Number(value);
  } else if (typeof old === 'boolean') {
    if (!['true', 'false'].includes(value)) throw new Error(`${pointer}: 请输入 true 或 false`);
    value = value === 'true';
  } else if (typeof old !== 'string') throw new Error(`${pointer}: 只支持标量文字字段`);
  parent[key] = value;
  const validation = validateDeck(next);
  if (!validation.ok) throw new Error(validation.errors.join('\n'));
  const { deck, theme } = compileDeck(next);
  // Reuse already embedded assets only while their source and dimensions agree.
  deck.slides.forEach((slide, si) => {
    const previous = previousDeck?.slides[si];
    const oldElements = new Map((previous?.elements || []).map(e => [e.id, e]));
    for (const element of slide.elements) {
      const cached = oldElements.get(element.id);
      if (cached && ['path', 'url', 'data', 'svgXml', 'width', 'height'].every(k => cached[k] === element[k])) {
        if (cached._data) element._data = cached._data;
        if (cached._error) element._error = cached._error;
      }
    }
    if (previous?._backgroundSource && previous._backgroundSource === slide.background) {
      slide._backgroundSource = previous._backgroundSource;
      slide.background = previous.background;
      slide._backgroundMedia = previous._backgroundMedia;
      if (previous._backgroundError) slide._backgroundError = previous._backgroundError;
    }
  });
  return { source: next, deck, theme, warnings: validation.warnings };
}
