import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownMessage, messageContent, MAX_MESSAGE_BYTES } from '@ctlflow/crossfire-adapter-matrix/message';

test('native file attachments retain their filename, MIME type, size and MXC URL without text formatting', () => {
  const content = { body: 'nifty-october-2026-top-options.csv', info: { mimetype: 'text/csv', size: 7798 },
    msgtype: 'm.file', url: 'mxc://preview.localhost/d6yN6XbDo0kfN668F7ZXhLYKZPpgbdta' };
  const rendered = messageContent(content);
  assert.deepEqual(rendered, content);
  assert.notEqual(rendered, content);
  assert(!('formatted_body' in rendered));
  assert(!('format' in rendered));
});

test('formatted Matrix messages retain the exact original Markdown', () => {
  const body = 'Status: **complete**\r\nUnicode: 日本語 🦀\n';
  const content = markdownMessage(body);
  assert.equal(content.msgtype, 'm.text');
  assert.equal(content.format, 'org.matrix.custom.html');
  assert.equal(content.body, body);
  assert.match(content.formatted_body, /<strong>complete<\/strong>/);
  assert.match(content.formatted_body, /<br \/>/);
  assert.match(content.formatted_body, /日本語 🦀/);
});

test('native edits and mentions retain their fields and render replacement text through the same formatter', () => {
  const content = { msgtype: 'm.text', body: '* corrected **text**', 'm.mentions': { user_ids: ['@peer:local'] },
    'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
    'm.new_content': { msgtype: 'm.text', body: '**corrected** <script>unsafe()</script>' } };
  const rendered = messageContent(content);
  assert.deepEqual(rendered['m.mentions'], content['m.mentions']);
  assert.deepEqual(rendered['m.relates_to'], content['m.relates_to']);
  assert.deepEqual(rendered['m.new_content'], markdownMessage(content['m.new_content'].body));
  assert(!('formatted_body' in content));
  assert.throws(() => messageContent({ ...content, 'm.new_content': { ...content['m.new_content'], formatted_body: '<script>unsafe()</script>' } }), /independently supplied HTML/);
  assert.throws(() => messageContent({ ...content, 'm.new_content': { ...content['m.new_content'], 'm.new_content': {} } }), /one replacement/);
  assert.throws(() => messageContent({ ...content, metadata: 'x'.repeat(MAX_MESSAGE_BYTES) }), /Encoded event/);
});

test('headings, paragraphs, emphasis, strikethrough and escaped punctuation render', () => {
  const body = '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\n'
    + '**bold** *italic* ~~removed~~ \\*literal\\*\n\n---\n';
  const html = markdownMessage(body).formatted_body;
  for (const level of [1, 2, 3, 4, 5, 6]) assert(html.includes(`<h${level}>`));
  for (const fragment of ['<strong>bold</strong>', '<em>italic</em>', '<del>removed</del>', '*literal*', '<hr />']) {
    assert(html.includes(fragment), fragment);
  }
});

test('ordered and nested lists, task states, blockquotes and line breaks survive', () => {
  const html = markdownMessage('3. third\n4. fourth\n\n- outer\n  - inner\n\n'
    + '- [x] finished\n- [ ] pending\n\n> quoted **text**\n\nfirst\nsecond\n').formatted_body;
  for (const fragment of ['<ol start="3">', '<ul>', '<li>inner</li>', '☑ finished', '☐ pending', '<blockquote>', '<br />']) {
    assert(html.includes(fragment), fragment);
  }
  assert(!html.includes('<input'));
});

test('GFM tables retain their headers, data, escapes and inline formatting', () => {
  const html = markdownMessage('| Task | Status |\n| --- | ---: |\n| **Build** | `passed` |\n| A\\|B | 2 |').formatted_body;
  for (const fragment of ['<table>', '<thead>', '<tbody>', '<th>Task</th>', '<strong>Build</strong>', '<code>passed</code>', 'A|B']) {
    assert(html.includes(fragment), fragment);
  }
  assert(!html.includes('style='));
});

test('links, reference links and GFM autolinks retain safe destinations', () => {
  const html = markdownMessage('[docs](https://example.org/docs?q=1&x=2) [mail](mailto:user@example.org) '
    + '[room](matrix:r/room:example.org) [reference][id] https://example.org/plain\n\n[id]: https://example.org/reference').formatted_body;
  for (const destination of ['https://example.org/docs?q=1&amp;x=2', 'mailto:user@example.org',
    'matrix:r/room:example.org', 'https://example.org/reference', 'https://example.org/plain']) {
    assert(html.includes(`href="${destination}"`), destination);
  }
});

for (const language of ['typescript', 'rust', 'csharp', 'bash', 'json', 'unknown-language']) {
  test(`fenced ${language} code preserves its language and literal source`, () => {
    const code = '  first<T>("<&>");\n\tconst text = `value ${literal}`;\n';
    const body = '```' + language + '\n' + code + '```';
    const content = markdownMessage(body);
    assert.equal(content.body, body);
    assert(content.formatted_body.startsWith(`<pre><code class="language-${language}">`));
    assert(content.formatted_body.includes('  first&lt;T&gt;("&lt;&amp;&gt;");'));
    assert(content.formatted_body.includes('\tconst text = `value ${literal}`;'));
    assert(!content.formatted_body.includes('<T>'));
  });
}

test('inline and indented code do not evaluate HTML or Markdown', () => {
  const html = markdownMessage('`<b>**literal**</b>`\n\n    const value = "<&>";\n').formatted_body;
  assert(html.includes('<code>&lt;b&gt;**literal**&lt;/b&gt;</code>'));
  assert(html.includes('<pre><code>const value = "&lt;&amp;&gt;";\n</code></pre>'));
});

for (const body of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>',
  '<svg><script>alert(1)</script></svg>', '<iframe src="https://example.org"></iframe>',
  '<a href="javascript:alert(1)">click</a>', '<style>body { display: none; }</style>']) {
  test(`authored HTML remains visible text: ${body.split('>')[0]}>`, () => {
    const content = markdownMessage(body);
    assert.equal(content.body, body);
    assert(!/<(?:script|img|svg|iframe|a|style)\b/i.test(content.formatted_body));
    assert(content.formatted_body.includes('&lt;'));
  });
}

for (const destination of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java&#x73;cript:alert(1)',
  'vbscript:alert(1)', 'data:text/html,boom', 'file:///etc/passwd', '//example.org/path']) {
  test(`unsafe link destination is not emitted: ${destination}`, () => {
    const content = markdownMessage(`[link](<${destination}>)`);
    assert(!content.formatted_body.includes('href='));
    assert(content.formatted_body.includes('link'));
  });
}

test('code-fence labels cannot inject classes or attributes', () => {
  const html = markdownMessage('```typescript"onmouseover="alert(1)\ntext\n```').formatted_body;
  assert(!html.includes(' onmouseover='));
  assert(html.includes('<pre><code'));
  assert(html.includes('text\n</code>'));
});

test('Matrix media stays inline while remote images become non-loading links', () => {
  const html = markdownMessage('![media](mxc://example.org/image) ![remote](https://example.org/image.png) '
    + '![relative](/image.png) ![unsafe](javascript:alert(1))').formatted_body;
  assert(html.includes('<img src="mxc://example.org/image" alt="media"'));
  assert(html.includes('<a href="https://example.org/image.png">remote</a>'));
  assert(html.includes('<a href="/image.png">relative</a>'));
  assert.equal((html.match(/<img\b/g) ?? []).length, 1);
  assert(!html.includes('href="javascript:'));
});

test('the source limit is measured in UTF-8 bytes, and empty messages reject', () => {
  assert.throws(() => markdownMessage(''), /1\.\.50000 bytes/);
  assert.throws(() => markdownMessage('x'.repeat(MAX_MESSAGE_BYTES + 1)), /1\.\.50000 bytes/);
  assert.throws(() => markdownMessage('🦀'.repeat(MAX_MESSAGE_BYTES / 4 + 1)), /1\.\.50000 bytes/);
});

test('the full encoded message fits at the boundary and rejects the next character', () => {
  const overhead = Buffer.byteLength(JSON.stringify(markdownMessage('x'))) - 2;
  const length = Math.floor((MAX_MESSAGE_BYTES - overhead) / 2);
  const message = markdownMessage('x'.repeat(length));
  const bytes = Buffer.byteLength(JSON.stringify(message));
  assert(bytes <= MAX_MESSAGE_BYTES && bytes >= MAX_MESSAGE_BYTES - 1);
  assert.equal(message.body.length, length);
  assert.throws(() => markdownMessage('x'.repeat(length + 1)), /Rendered message exceeds/);
});

test('HTML and JSON expansion are included in the limit without truncating source', () => {
  for (const body of ['& '.repeat(8000), '\\"\n'.repeat(6000), '- item\n'.repeat(3000)]) {
    assert(Buffer.byteLength(body) < MAX_MESSAGE_BYTES);
    assert.throws(() => markdownMessage(body), /Rendered message exceeds/);
  }
});
