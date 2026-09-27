import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export const MAX_MESSAGE_BYTES = 50_000;

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    },
    checkbox({ checked }) { return checked ? '☑ ' : '☐ '; },
  },
});

export function markdownMessage(body: string) {
  if (Buffer.byteLength(body) < 1 || Buffer.byteLength(body) > MAX_MESSAGE_BYTES) {
    throw new Error('Send 1..50000 bytes of Markdown; upload larger documents');
  }
  const formatted = sanitizeHtml(markdown.parse(body, { async: false }), {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'em', 'del',
      'blockquote', 'ul', 'ol', 'li', 'a', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img'],
    allowedAttributes: { a: ['href', 'title'], code: ['class'], ol: ['start'], img: ['src', 'alt', 'title'] },
    allowedClasses: { code: ['language-*'] },
    allowedSchemes: ['https', 'http', 'mailto', 'matrix', 'mxc'],
    allowedSchemesByTag: { img: ['mxc'] },
    allowProtocolRelative: false,
    transformTags: {
      img(tagName, attributes) {
        if (attributes.src?.startsWith('mxc://')) return { tagName, attribs: attributes };
        return { tagName: 'a', attribs: { href: attributes.src ?? '' }, text: attributes.alt ?? '' };
      },
    },
  });
  const content = { msgtype: 'm.text', body, format: 'org.matrix.custom.html', formatted_body: formatted };
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_MESSAGE_BYTES) {
    throw new Error('Rendered message exceeds 50000 bytes including Markdown, HTML and JSON; upload larger documents');
  }
  return content;
}
