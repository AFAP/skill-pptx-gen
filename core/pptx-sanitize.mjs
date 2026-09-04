/** Cross-runtime OOXML cleanup used by both Node and browser exports. */

const BLANK_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export async function sanitizePptxData(JSZipCtor, data, { outputType = 'nodebuffer', logger = console } = {}) {
  const zip = await JSZipCtor.loadAsync(data);
  let fixedMedia = 0, fixedStretch = 0, fixedPicWs = 0;
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (/ppt\/media\/.*\.png$/i.test(path)) {
      const bytes = await file.async('uint8array');
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      if (!isPng) {
        zip.file(path, BLANK_PNG_B64, { base64: true });
        fixedMedia++;
      }
    }
    if (/ppt\/slides\/slide\d+\.xml$/i.test(path)) {
      let xml = await file.async('string');
      let changed = false;
      if (xml.includes('<a:stretch/>')) {
        xml = xml.replaceAll('<a:stretch/>', '<a:stretch><a:fillRect/></a:stretch>');
        fixedStretch++;
        changed = true;
      }
      if (/<p:pic>\s/.test(xml)) {
        xml = xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/g, m => m.replace(/>\s+</g, '><'));
        fixedPicWs++;
        changed = true;
      }
      if (changed) zip.file(path, xml);
    }
  }
  if (fixedMedia) logger.warn?.(`[sanitize] ${fixedMedia} 处伪 PNG 已替换为占位图`);
  if (fixedStretch) logger.warn?.(`[sanitize] ${fixedStretch} 处空 <a:stretch/> 已修复`);
  if (fixedPicWs) logger.warn?.(`[sanitize] ${fixedPicWs} 处 <p:pic> 空白节点已清理`);
  const result = await zip.generateAsync({ type: outputType });
  return { data: result, fixes: { media: fixedMedia, stretch: fixedStretch, pictureWhitespace: fixedPicWs } };
}

