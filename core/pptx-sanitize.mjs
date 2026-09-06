/** Cross-runtime OOXML cleanup used by both Node and browser exports. */

export async function sanitizePptxData(JSZipCtor, data, { outputType = 'nodebuffer', logger = console } = {}) {
  const zip = await JSZipCtor.loadAsync(data);
  let fixedStretch = 0, fixedPicWs = 0, fixedContentTypes = 0;
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (/ppt\/media\/.*\.png$/i.test(path)) {
      const bytes = await file.async('uint8array');
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      if (!isPng) {
        throw new Error(`${path}: PNG 媒体内容无效；拒绝用空白图片掩盖转换失败`);
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
  const contentTypes = zip.file('[Content_Types].xml');
  if (contentTypes) {
    let xml = await contentTypes.async('string');
    xml = xml.replace(/<Override\b[^>]*\bPartName="\/?([^"]+)"[^>]*\/>/g, (match, target) => {
      if (zip.files[target]) return match;
      fixedContentTypes++;
      return '';
    });
    if (fixedContentTypes) zip.file('[Content_Types].xml', xml);
  }
  if (fixedStretch) logger.warn?.(`[sanitize] ${fixedStretch} 处空 <a:stretch/> 已修复`);
  if (fixedPicWs) logger.warn?.(`[sanitize] ${fixedPicWs} 处 <p:pic> 空白节点已清理`);
  if (fixedContentTypes) logger.warn?.(`[sanitize] ${fixedContentTypes} 处悬空 ContentType 声明已移除`);
  const result = await zip.generateAsync({ type: outputType });
  return { data: result, fixes: { stretch: fixedStretch, pictureWhitespace: fixedPicWs, danglingContentTypes: fixedContentTypes } };
}
