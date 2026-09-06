/** The same scene-to-presentation orchestration in Node and the browser. */
import { applyElement, slideBackground, parseColor, INCH_W, INCH_H } from './dsl-to-pptx.mjs';

export function sceneResourceErrors(deck) {
  const errors = [];
  deck.slides.forEach((slide, si) => {
    if (slide._backgroundError) errors.push(`第${si + 1}页背景: ${slide._backgroundError}`);
    for (const el of slide.elements) {
      const error = el._error || (el.elType === 'image' && !el._data && !el.data && !el.path && !el.url
        ? (el.prompt ? '图片仍只有 prompt，尚未生成实际资源' : '图片缺少 path/url/data') : null);
      if (error) errors.push(`第${si + 1}页 ${el.id || el.elType}: ${error}`);
    }
  });
  return errors;
}

export function presentationFromScene(PptxGenJS, deck, theme, { strict = true, logger = console } = {}) {
  const report = { mode: strict ? 'strict' : 'allow-partial', slides: [], summary: { total: 0, editable: 0, rasterized: 0, skipped: 0, failed: 0 } };
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE_1280', width: INCH_W, height: INCH_H });
  pptx.layout = 'WIDE_1280';
  if (deck.meta?.title) pptx.title = deck.meta.title;
  if (deck.meta?.author) pptx.author = deck.meta.author;
  const fail = (item, message) => {
    item.status = 'failed'; item.message = message; report.summary.failed++;
    if (strict) { const error = new Error(message); error.report = report; throw error; }
    logger.warn?.(message);
  };
  deck.slides.forEach((spec, si) => {
    const slide = pptx.addSlide();
    const row = { slide: si + 1, id: spec.id, elements: [] };
    report.slides.push(row);
    const mediaBackground = spec._backgroundMedia || (typeof spec.background === 'string' && !parseColor(spec.background));
    if (mediaBackground) {
      report.summary.total++;
      row.background = { type: 'image-background', status: 'rasterized', originPath: `/slides/${si}/background` };
      if (spec._backgroundError) fail(row.background, `第${si + 1}页背景: ${spec._backgroundError}`);
      else report.summary.rasterized++;
    }
    const bg = slideBackground(spec._backgroundError ? '#' + theme.background : spec.background, theme);
    if (bg) slide.background = bg;
    for (const el of spec.elements) {
      const item = { id: el.id, type: el.elType, sourcePath: el.sourcePath, originPath: el.originPath, status: ['image', 'image-svg'].includes(el.elType) ? 'rasterized' : 'editable' };
      report.summary.total++;
      row.elements.push(item);
      const resourceError = el._error || (el.elType === 'image' && !el._data && !el.data && !el.path && !el.url ? '图片仍只有 prompt 或缺少资源，尚未生成' : null);
      if (resourceError) { fail(item, `第${si + 1}页 ${el.id || el.elType}: ${resourceError}`); continue; }
      try { applyElement(pptx, slide, el, theme); }
      catch (error) { fail(item, `第${si + 1}页 ${el.id || el.elType}: ${error.message}`); continue; }
      report.summary[item.status]++;
    }
    if (spec.notes || spec.speakerNotes) slide.addNotes(spec.notes || spec.speakerNotes);
  });
  report.summary.skipped = report.summary.total - report.summary.editable - report.summary.rasterized - report.summary.failed;
  return { pptx, theme, report, compiledDeck: deck };
}
