/** Word previews share the installed DOCX converter; generated content cannot execute in the app. */
export async function renderWordPreview(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  const document = new DOMParser().parseFromString(result.value, 'text/html');
  const allowedTags = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE',
    'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'A', 'STRONG', 'B', 'EM',
    'I', 'U', 'S', 'SUB', 'SUP', 'BR', 'HR', 'SPAN', 'DIV', 'IMG', 'BLOCKQUOTE', 'PRE', 'CODE',
  ]);
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    if (!allowedTags.has(element.tagName)) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const safeImage = element.tagName === 'IMG' && attribute.name === 'src'
        && /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(attribute.value);
      const safeSpan = ['TD', 'TH'].includes(element.tagName)
        && ['colspan', 'rowspan'].includes(attribute.name) && /^[1-9]\d{0,2}$/.test(attribute.value);
      const safeAlt = element.tagName === 'IMG' && attribute.name === 'alt';
      if (!safeImage && !safeSpan && !safeAlt) element.removeAttribute(attribute.name);
    }
    if (element.tagName === 'IMG' && !element.hasAttribute('src')) element.remove();
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>body{margin:0;padding:24px;color:#172033;background:#fff;font:15px/1.7 system-ui,sans-serif;overflow-wrap:anywhere}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ccd2db;padding:6px 10px}img{max-width:100%;height:auto}pre{white-space:pre-wrap}h1,h2,h3{line-height:1.3}</style>
</head><body>${document.body.innerHTML}</body></html>`;
}
