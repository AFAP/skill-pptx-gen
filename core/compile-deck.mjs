/** Compile semantic slides and primitive slides into one resolved primitive deck. */
import { BUILTIN_THEMES, resolveTheme, resolveTokens } from './dsl-to-pptx.mjs';
import { expandConnectors } from './connectors.mjs';
import { expandCreativeElements } from './creative-expand.mjs';
import { expandLayoutSlide, isSemanticSlide } from './layouts.mjs';

export const CURRENT_DSL_VERSION = 3;

function clone(value) {
  return structuredClone(value);
}

function annotatePrimitiveSlide(slide, si) {
  const elements = (slide.elements || []).map((el, ei) => {
    const derivedText = el._sourcePathDerived === true;
    const annotated = {
      ...el,
      id: el.id || `s${si}-raw-${ei}`,
      ...(el.elType === 'text' && !derivedText
        ? { sourcePath: el.sourcePath || `/slides/${si}/elements/${ei}/text` }
        : {}),
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
    return isSemanticSlide(prepared)
      ? expandLayoutSlide(prepared, { slideIndex: si, pageCount, theme })
      : annotatePrimitiveSlide(prepared, si);
  });
  let compiled = {
    dslVersion: source.dslVersion || CURRENT_DSL_VERSION,
    meta: source.meta || {},
    theme: selectedTheme,
    slides,
  };
  if (opts.resolveColors !== false) compiled = resolveTokens(compiled, theme);
  if (opts.expandMacros !== false) expandConnectors(compiled);
  return { deck: compiled, theme };
}
