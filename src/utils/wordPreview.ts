import type { IElement } from '@hufe921/canvas-editor';

/** A4 at 96 dpi with Word's default margins; the converter sizes tables and images for the same page the viewer draws. */
export const WORD_PREVIEW_PAGE = {
  width: 794,
  height: 1123,
  margins: [96, 120, 96, 120] as [number, number, number, number],
};

const INNER_WIDTH = WORD_PREVIEW_PAGE.width - WORD_PREVIEW_PAGE.margins[1] - WORD_PREVIEW_PAGE.margins[3];
const INNER_HEIGHT = WORD_PREVIEW_PAGE.height - WORD_PREVIEW_PAGE.margins[0] - WORD_PREVIEW_PAGE.margins[2];
const TABLE_CELL_PADDING = 10;

const ALLOWED_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE',
  'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'STRONG', 'B', 'EM',
  'I', 'U', 'S', 'SUB', 'SUP', 'BR', 'HR', 'SPAN', 'DIV', 'IMG', 'BLOCKQUOTE', 'PRE', 'CODE',
]);
const SAFE_IMAGE_SRC = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;

/**
 * canvas-editor parses HTML by mounting it in the live page, so only bare structure may reach it:
 * links become plain text and every attribute except inline image data and cell spans is dropped.
 */
export function sanitizeWordHtml(html: string): Document {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const link of Array.from(parsed.body.querySelectorAll('a'))) {
    link.replaceWith(...Array.from(link.childNodes));
  }
  for (const element of Array.from(parsed.body.querySelectorAll('*'))) {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const safeImage = element.tagName === 'IMG' && attribute.name === 'src' && SAFE_IMAGE_SRC.test(attribute.value);
      const safeSpan = ['TD', 'TH'].includes(element.tagName)
        && ['colspan', 'rowspan'].includes(attribute.name) && /^[1-9]\d{0,2}$/.test(attribute.value);
      if (!safeImage && !safeSpan) element.removeAttribute(attribute.name);
    }
    if (element.tagName === 'IMG' && !element.hasAttribute('src')) element.remove();
  }
  return parsed;
}

function availableImageWidth(image: Element): number {
  const cell = image.closest('td,th') as HTMLTableCellElement | null;
  if (!cell) return INNER_WIDTH;
  const firstRow = cell.closest('table')?.querySelector('tr');
  const columns = Array.from(firstRow?.children ?? [])
    .reduce((sum, td) => sum + ((td as HTMLTableCellElement).colSpan || 1), 0) || 1;
  return Math.max(16, Math.floor(INNER_WIDTH / columns) * (cell.colSpan || 1) - TABLE_CELL_PADDING);
}

/** canvas-editor keeps an image only if it already has a laid-out size, and does not shrink it to the page. */
async function fitImages(body: HTMLElement): Promise<void> {
  await Promise.all(Array.from(body.querySelectorAll('img')).map(async (image) => {
    const probe = new Image();
    probe.src = image.getAttribute('src') ?? '';
    try {
      await probe.decode();
    } catch {
      image.remove();
      return;
    }
    if (!probe.naturalWidth || !probe.naturalHeight) {
      image.remove();
      return;
    }
    const ratio = Math.min(1, availableImageWidth(image) / probe.naturalWidth, INNER_HEIGHT / probe.naturalHeight);
    const width = Math.max(1, Math.round(probe.naturalWidth * ratio));
    const height = Math.max(1, Math.round(probe.naturalHeight * ratio));
    image.setAttribute('width', String(width));
    image.setAttribute('height', String(height));
    image.setAttribute('style', `width:${width}px;height:${height}px`);
  }));
}

/**
 * Colour and size in the parsed list come from the host page's CSS (mammoth emits neither);
 * dropping them lets canvas-editor apply its defaults and heading sizes.
 */
function stripHostStyles(elements: IElement[]): void {
  for (const element of elements) {
    delete element.color;
    delete element.size;
    delete element.highlight;
    if (!element.bold) delete element.bold;
    if (!element.italic) delete element.italic;
    if (element.valueList) stripHostStyles(element.valueList);
    element.trList?.forEach(tr => tr.tdList.forEach(td => stripHostStyles(td.value)));
  }
}

/** DOCX → canvas-editor elements for read-only paged preview; legacy DOC arrives here already converted by the backend. */
export async function buildWordPreviewElements(buffer: ArrayBuffer): Promise<IElement[]> {
  const [mammoth, { getElementListByHTML }] = await Promise.all([
    import('mammoth'),
    import('@hufe921/canvas-editor'),
  ]);
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  const parsed = sanitizeWordHtml(result.value);
  await fitImages(parsed.body);
  const elements = getElementListByHTML(parsed.body.innerHTML, { innerWidth: INNER_WIDTH });
  stripHostStyles(elements);
  return elements;
}
