/**
 * ppt-gen Node 适配层：纯转换逻辑在 core/dsl-to-pptx.mjs（浏览器端预览页共用同一份）。
 * 本文件只包含 Node 专有能力：图片/背景预取（fs/fetch → base64 data URI）、体积守卫、构建编排。
 */

export * from './dsl-to-pptx.mjs';

import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { parseColor } from './dsl-to-pptx.mjs';
import { compileDeck } from './compile-deck.mjs';
import { sanitizePptxData } from './pptx-sanitize.mjs';
import { presentationFromScene } from './presentation.mjs';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const MAX_IMAGE_MB = 5; // 单图体积守卫：超出告警（防止 pptx 静默膨胀到几十 MB）

/**
 * 修复 pptxgenjs 产出的已知 OOXML 不合规点；同一修复器也嵌入浏览器导出：
 * 1. 检查 image-svg 的 PNG 回退槽：无效媒体中止导出，不能伪装为空白图
 * 2. 图片 sizing cover/contain 生成空的 <a:stretch/>——OOXML 要求必须有 <a:fillRect/> 子元素，
 *    否则 PowerPoint 直接拒绝打开整个文件
 * 3. <p:pic> 元素内部带缩进空白文本节点——OOXML 严格序列不允许，PowerPoint 拒绝加载
 */
export async function sanitizePptxBuffer(buffer, logger = console) {
  return (await sanitizePptxData(JSZip, buffer, { outputType: 'nodebuffer', logger })).data;
}

async function fetchAsDataUri(src, baseDir) {
  let buf, mime;
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    mime = res.headers.get('content-type')?.split(';')[0] || 'image/png';
  } else {
    const filePath = src.startsWith('file:') ? fileURLToPath(src) : (baseDir ? resolve(baseDir, src) : src);
    buf = await readFile(filePath);
    mime = MIME[extname(filePath).toLowerCase()] || 'image/png';
  }
  return { buf, mime };
}

/**
 * 预取 deck 中的图片与图片背景为 base64 data URI。
 * 处理：elements[].elType=image 的 path/url；elType=image-svg 的 svgXml（Node 端经 sharp 栅格化为 PNG）；
 * slide.background 为图片 URL/本地路径。
 */
export async function prefetchImages(deck, { baseDir = '', logger = console, svgMode = 'node' } = {}) {
  const tasks = [];
  const attach = async (el, src) => {
    if (!src || typeof src !== 'string' || src.startsWith('data:')) return;
    if (parseColor(src)) return; // 是颜色值而非图片
    try {
      const { buf, mime } = await fetchAsDataUri(src, baseDir);
      if (buf.length > MAX_IMAGE_MB * 1024 * 1024) {
        logger.warn(`[image] ${src.slice(0, 80)} 体积 ${(buf.length / 1048576).toFixed(1)}MB 超过 ${MAX_IMAGE_MB}MB，建议压缩`);
      }
      el._data = `data:${mime};base64,${buf.toString('base64')}`;
    } catch (err) {
      logger.warn(`[image] ${src.slice(0, 80)} → ${err.message}（已记录为转换失败）`);
      el._error = err.message;
    }
  };

  // SVG → PNG 栅格化（pptxgenjs 的 SVG 支持是纯浏览器功能，Node 端必须预栅格化）
  let rasterizeSvg = null;
  if (svgMode === 'node' && deck.slides.some(s => s.elements?.some(e => e.elType === 'image-svg'))) try {
    const sharp = (await import('sharp')).default;
    rasterizeSvg = async (svgXml, w, h) => {
      const scale = 2; // 2 倍分辨率保证清晰
      const png = await sharp(Buffer.from(svgXml, 'utf-8'), { density: 300 })
        .resize(Math.max(1, Math.round((w || 300) * scale)), Math.max(1, Math.round((h || 300) * scale)), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer();
      return 'data:image/png;base64,' + png.toString('base64');
    };
  } catch {
    logger.warn('[image-svg] 未安装 sharp，Node 端 SVG 元素会记录为转换失败（浏览器端导出不受影响）。安装：npm i sharp');
  }

  for (const slide of deck.slides || []) {
    for (const el of slide.elements || []) {
      if (el.elType === 'image' && !el._data && (el.path || el.url)) {
        tasks.push(attach(el, el.path || el.url));
      } else if (el.elType === 'image-svg' && el.svgXml && rasterizeSvg) {
        tasks.push(
          rasterizeSvg(el.svgXml, el.width, el.height)
            .then(data => { el._data = data; })
            .catch(err => { logger.warn(`[image-svg] 栅格化失败: ${err.message}（已记录为转换失败）`); el._error = err.message; })
        );
      } else if (svgMode === 'node' && el.elType === 'image-svg' && el.svgXml && !rasterizeSvg) {
        el._error = 'sharp 未安装';
      }
    }
    // 图片背景（字符串且不是颜色）：包一层载体对象以复用 attach
    if (typeof slide.background === 'string' && !parseColor(slide.background)) {
      const carrier = { path: slide.background };
      slide._backgroundSource = slide.background;
      slide._backgroundMedia = true;
      tasks.push(attach(carrier, slide.background).then(() => {
        if (carrier._data) slide.background = carrier._data;
        if (carrier._error) slide._backgroundError = carrier._error;
      }));
    }
  }
  await Promise.all(tasks);
}

/**
 * 由 deck JSON 构建 PptxGenJS 实例。
 * @param {object} PptxGenJS pptxgenjs 模块（import 后传入，便于 CJS/ESM 兼容）
 * @param {object} deck { meta?, theme?, slides: [{ elements: [], notes?, background? }] }
 * @param {object} opts { prefetch: bool, baseDir, logger }
 */
export async function buildPresentation(PptxGenJS, deck, opts = {}) {
  const logger = opts.logger || console;
  const strict = opts.strict !== false;
  const { deck: resolved, theme } = compileDeck(deck);
  if (opts.prefetch !== false) await prefetchImages(resolved, { baseDir: opts.baseDir, logger });

  return presentationFromScene(PptxGenJS, resolved, theme, { strict, logger });
}
