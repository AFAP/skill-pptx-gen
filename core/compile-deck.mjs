/** Compile semantic slides and primitive slides into one resolved primitive deck. */
import { BUILTIN_THEMES, resolveTheme, resolveTokens } from './dsl-to-pptx.mjs';
import { expandConnectors, pointsToSvgPath } from './connectors.mjs';
import { normalizeShapePaths } from './shape-path.mjs';
import { expandCreativeElements } from './creative-expand.mjs';
import { expandLayoutSlide, isSemanticSlide } from './layouts.mjs';

export const CURRENT_DSL_VERSION = 3;

function clone(value) {
  return structuredClone(value);
}

function annotatePrimitiveSlide(slide, si) {
  const elements = (slide.elements || []).map((el, ei) => {
    const annotated = {
      ...el,
      id: el.id || `s${si}-raw-${ei}`,
    };
    delete annotated._sourcePathDerived;
    return annotated;
  });
  return { ...slide, id: slide.id || `slide-${si + 1}`, elements };
}

/**
 * @param {object} deck source deck (semantic or primitive)
 * @param {object} opts resolveColors/expandMacros default true
 */
export function compileDeck(deck, opts = {}) {
  if (!deck || typeof deck !== 'object' || Array.isArray(deck)) throw new Error('deck 必须是对象');
  if (!Array.isArray(deck.slides) || !deck.slides.length) throw new Error('deck.slides 必须是非空数组');
  const source = clone(deck);
  if (source.dslVersion != null && (!Number.isInteger(source.dslVersion) || source.dslVersion < 1 || source.dslVersion > CURRENT_DSL_VERSION)) throw new Error(`不支持的 dslVersion: ${source.dslVersion}`);
  const selectedTheme = source.theme ?? source.style ?? 'navy-report';
  if (typeof selectedTheme === 'string' && !BUILTIN_THEMES[selectedTheme]) throw new Error(`未知样式/主题: ${selectedTheme}`);
  if (selectedTheme && typeof selectedTheme === 'object' && selectedTheme.extends && !BUILTIN_THEMES[selectedTheme.extends]) throw new Error(`未知 theme.extends: ${selectedTheme.extends}`);
  const theme = resolveTheme(selectedTheme);
  const pageCount = source.slides.length;
  const slides = source.slides.map((slide, si) => {
    const prepared = {
      ...slide,
      elements: expandCreativeElements(slide.elements || [], { styleClasses: source.styleClasses || {}, slideIndex: si }),
    };
    const result = isSemanticSlide(prepared)
      ? expandLayoutSlide(prepared, { slideIndex: si, pageCount, theme })
      : annotatePrimitiveSlide(prepared, si);
    for (const el of result.elements) {
      delete el._sourcePathDerived;
      // Only real, scalar source fields may be edited. Generated defaults stay read-only.
      if (el.sourcePath) {
        const parts = el.sourcePath.slice(1).split('/').map(v => v.replaceAll('~1', '/').replaceAll('~0', '~'));
        const value = parts.reduce((v, key) => v != null && Object.hasOwn(v, key) ? v[key] : undefined, source);
        if (!['string', 'number', 'boolean'].includes(typeof value)) delete el.sourcePath;
      }
      el.originPath ||= el.sourcePath || `/slides/${si}`;
    }
    return result;
  });
  let compiled = {
    dslVersion: source.dslVersion || CURRENT_DSL_VERSION,
    meta: source.meta || {},
    theme: selectedTheme,
    slides,
  };
  if (opts.resolveColors !== false) compiled = resolveTokens(compiled, theme);
  if (opts.expandMacros !== false) expandConnectors(compiled);
  if (opts.normalizeShapePaths !== false) normalizeShapePaths(compiled);
  for (const slide of compiled.slides) for (const el of slide.elements) {
    if (el.elType === 'shape-path' && Array.isArray(el.pointArr)) el.data = pointsToSvgPath(el.pointArr) + (el.closePath !== false ? ' Z' : '');
    if (el.elType === 'text') {
      el.fontSize ??= 18;
      el.fontFamily ||= theme.fontFamily;
      el.lineHeight ??= 1.25;
      el.padding ??= 0;
      el.fill ??= '#' + theme.text;
      el.verticalAlign ||= el.valign || 'top';
    }
  }
  return { deck: compiled, theme };
}
