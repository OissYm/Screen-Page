// ==UserScript==
// @name         Screen Page
// @namespace    https://github.com/OissYm/Screen-Page
// @version      1.1.0
// @description  Save the page you are looking at (after JavaScript, with your session) as clean Markdown or as a full-page PDF image that any AI can read.
// @author       OissYm
// @homepageURL  https://github.com/OissYm/Screen-Page
// @downloadURL  https://raw.githubusercontent.com/OissYm/Screen-Page/HEAD/screen-page.user.js
// @updateURL    https://raw.githubusercontent.com/OissYm/Screen-Page/HEAD/screen-page.user.js
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM.registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      *
// @require      https://raw.githubusercontent.com/OissYm/Screen-Page/HEAD/vendor/modern-screenshot.js
// ==/UserScript==

(() => {
  'use strict';

  const UI_ID = 'screen-page-ui';
  const JSON_LD_LIMIT = 30000;
  const SKIP = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE',
    'CANVAS', 'OBJECT', 'EMBED', 'MAP', 'DATALIST', 'SOURCE', 'TRACK',
  ]);

  // ---------------------------------------------------------------- helpers

  const styleOf = (el) => el.ownerDocument.defaultView.getComputedStyle(el);

  function visible(el) {
    // aria-hidden hides decorative icons (often a ligature name such as
    // "arrow_forward"); anything with real text in it is kept.
    if (el.getAttribute('aria-hidden') === 'true' && !/\S\s+\S/.test(el.textContent)) return false;
    const cs = styleOf(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.visibility !== 'collapse';
  }

  function abs(url) {
    try {
      return new URL(url, document.baseURI).href;
    } catch {
      return '';
    }
  }

  const block = (s) => ((s = s.trim()) ? `\n\n${s}\n\n` : '');

  // Flatten multi-block content to one line (headings, links, table cells).
  const oneLine = (s) =>
    s
      .split(/\n+/)
      .map((l) => l.replace(/^#+\s+/, '').trim())
      .filter(Boolean)
      .join(' — ');

  // Wrap inline content in a marker, keeping surrounding spaces outside it.
  function wrap(inner, mark) {
    const [, lead, core, trail] = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!core || core.includes('\n')) return inner;
    return `${lead}${mark}${core}${mark}${trail}`;
  }

  const label = (el) =>
    (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();

  function isBig(el) {
    const r = el.getBoundingClientRect();
    return r.width >= 100 && r.height >= 100;
  }

  // ------------------------------------------------- selected / highlighted

  const ON_CLASS = /(^|[\s_-])(active|selected|current|checked)($|[\s_-])/i;
  const ON_STATE = /^(active|on|checked|selected)$/i;
  const NO_STATE = new Set(['HTML', 'BODY', 'MAIN', 'INPUT', 'TD', 'TH', 'TR', 'OPTION']);
  const oddCache = new WeakMap();

  function isOn(el) {
    const attr = (name) => el.getAttribute(name);
    return (
      attr('aria-selected') === 'true' ||
      attr('aria-checked') === 'true' ||
      attr('aria-pressed') === 'true' ||
      (attr('aria-current') || 'false') !== 'false' ||
      attr('data-selected') === 'true' ||
      attr('data-active') === 'true' ||
      ON_STATE.test(attr('data-state') || '') ||
      ON_CLASS.test(attr('class') || '')
    );
  }

  // Among 3+ short sibling labels, the one styled differently from all the
  // others (which look identical) is the one the page is pointing at.
  function oddOne(parent) {
    if (oddCache.has(parent)) return oddCache.get(parent);
    let odd = null;
    const sibs = [...parent.children];
    const short = (el) => {
      const t = el.textContent.trim();
      return t.length > 0 && t.length <= 40;
    };
    if (sibs.length >= 3 && sibs.length <= 8 && sibs.every((el) => el.tagName === sibs[0].tagName && short(el)) && !sibs.some(isOn)) {
      const sigs = sibs.map((el) => {
        let leaf = el;
        while (leaf.children.length === 1) leaf = leaf.children[0];
        const a = styleOf(el);
        const b = styleOf(leaf);
        return [a.backgroundColor, a.opacity, b.backgroundColor, b.color, b.fontWeight].join('|');
      });
      const groups = new Map();
      sigs.forEach((sig, i) => groups.set(sig, [...(groups.get(sig) || []), i]));
      if (groups.size === 2) {
        const single = [...groups.values()].filter((g) => g.length === 1);
        if (single.length === 1) odd = sibs[single[0][0]];
      }
    }
    oddCache.set(parent, odd);
    return odd;
  }

  // Mark a short label as selected/highlighted so the active tab, status or
  // value is not lost when colours are.
  function flag(node, out) {
    const text = out.trim();
    if (!text || text.includes('\n') || text.length > 60 || /\((selected|highlighted)\)/.test(text)) return out;
    if (NO_STATE.has(node.tagName)) return out;
    let state = '';
    if (isOn(node)) state = 'selected';
    else if (node.parentElement && oddOne(node.parentElement) === node) state = 'highlighted';
    if (!state) return out;
    const bare = text.replace(/^\*\*([\s\S]*)\*\*$/, '$1');
    return out.replace(text, () => `**${bare}** (${state})`);
  }

  // ------------------------------------------------------- DOM -> Markdown

  function kids(node, parts) {
    let nodes = node.childNodes;
    if (node.shadowRoot) nodes = node.shadowRoot.childNodes;
    else if (node.tagName === 'SLOT') {
      const assigned = node.assignedNodes({ flatten: true });
      if (assigned.length) nodes = assigned;
    } else {
      // Follow the visual order of flex/grid layouts, not the source order.
      const cs = styleOf(node);
      if (/flex|grid/.test(cs.display)) {
        const order = (n) => (n.nodeType === 1 ? parseInt(styleOf(n).order, 10) || 0 : 0);
        nodes = [...nodes];
        if (nodes.some(order)) nodes = nodes.map((n, i) => [order(n), i, n]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((t) => t[2]);
        if (cs.display.includes('flex') && cs.flexDirection.endsWith('reverse')) nodes.reverse();
      }
    }
    let out = '';
    for (const child of nodes) {
      let s = md(child);
      if (!s) continue;
      if (parts && s.trim()) parts.push(s.trim());
      if (!out || /\s$/.test(out)) s = s.replace(/^ +/, '');
      out += s;
    }
    return out;
  }

  function md(node) {
    if (node.nodeType === 3) return node.data.replace(/​/g, '').replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag) || String(node.id).startsWith(UI_ID) || !visible(node)) return '';
    const out = render(node, tag);
    return out && flag(node, out);
  }

  function render(node, tag) {
    switch (tag) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const text = oneLine(kids(node));
        return text ? block(`${'#'.repeat(+tag[1])} ${text}`) : '';
      }
      case 'BR':
        return '\n';
      case 'HR':
        return block('---');
      case 'STRONG': case 'B':
        return wrap(kids(node), '**');
      case 'EM': case 'I':
        return wrap(kids(node), '*');
      case 'DEL': case 'S': case 'STRIKE':
        return wrap(kids(node), '~~');
      case 'CODE': case 'KBD': case 'SAMP': case 'TT':
        return wrap(kids(node), '`');
      case 'DT': case 'SUMMARY':
        return block(wrap(oneLine(kids(node)), '**'));
      case 'A':
        return link(node);
      case 'IMG':
        return image(node);
      case 'PRE':
        return pre(node);
      case 'BLOCKQUOTE': {
        const inner = tidy(kids(node));
        return inner ? block(inner.replace(/^/gm, '> ')) : '';
      }
      case 'UL': case 'OL': case 'MENU':
        return list(node, tag === 'OL');
      case 'TABLE':
        return table(node);
      case 'INPUT': case 'TEXTAREA': case 'SELECT':
        return field(node, tag);
      case 'BUTTON': {
        const text = oneLine(kids(node)) || label(node);
        return text ? ` [${text}] ` : '';
      }
      case 'IFRAME':
        return iframe(node);
      case 'VIDEO': case 'AUDIO': {
        const src = node.currentSrc || node.src || '';
        const kind = tag.toLowerCase();
        return block(src && !src.startsWith('blob:') ? `[${kind}: ${src}]` : `[${kind}]`);
      }
      case 'SVG': {
        // Charts and diagrams: keep their labels and values.
        const texts = [...node.querySelectorAll('text')]
          .map((t) => t.textContent.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 300);
        return texts.length ? block(`[graphic: ${texts.join(' · ')}]`) : '';
      }
      case 'MATH': {
        const tex = node.querySelector('annotation[encoding*="tex" i]');
        if (tex) return `$${tex.textContent.trim()}$`;
        return node.getAttribute('alttext') || node.textContent.replace(/\s+/g, ' ');
      }
      case 'NAV': case 'ASIDE': case 'FOOTER': {
        const inner = kids(node).trim();
        const name = tag.toLowerCase();
        return inner ? `\n\n<!-- ${name} -->\n\n${inner}\n\n<!-- /${name} -->\n\n` : '';
      }
    }

    const parts = [];
    let inner = kids(node, parts);
    const cs = styleOf(node);
    const display = cs.display;
    // A row of short items (value + unit, statuses, tabs) reads as one line.
    if (display.includes('flex') && cs.flexDirection.startsWith('row') && parts.length > 1 &&
        parts.every((part) => !part.includes('\n')) && parts.join('').length <= 200) {
      inner = parts.join(' · ');
    }
    return display.startsWith('inline') || display === 'contents' ? inner : block(inner);
  }

  function link(node) {
    const inner = kids(node);
    const text = oneLine(inner) || label(node);
    if (!text) return '';
    const raw = node.getAttribute('href') || '';
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return inner;
    const out = `[${text}](${abs(raw)})`;
    // A link wrapping whole blocks (a card) must stay a block of its own.
    return inner.includes('\n') ? block(out) : inner.replace(/^(\s*)[\s\S]*?(\s*)$/, `$1${out.replace(/\$/g, '$$$$')}$2`);
  }

  function image(node) {
    const alt = (node.alt || node.title || '').trim().replace(/\s+/g, ' ');
    if (!alt && !isBig(node)) return ''; // icons, avatars, tracking pixels
    const src = node.currentSrc || node.src || node.getAttribute('data-src') || '';
    if (!src || src.startsWith('data:')) return alt ? `[image: ${alt}]` : '';
    return `![${alt}](${abs(src)})`;
  }

  function pre(node) {
    const text = (node.innerText || node.textContent).replace(/\n+$/, '');
    if (!text.trim()) return '';
    const code = node.querySelector('code') || node;
    const lang = (`${node.className} ${code.className}`.match(/\blang(?:uage)?-([\w+#-]+)/) || [])[1] || '';
    const longest = Math.max(2, ...(text.match(/`+/g) || []).map((t) => t.length));
    const fence = '`'.repeat(longest + 1);
    return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
  }

  function list(node, ordered) {
    let n = ordered ? parseInt(node.getAttribute('start'), 10) || 1 : 0;
    const items = [];
    for (const child of node.children) {
      if (child.tagName !== 'LI') {
        const other = md(child).trim();
        if (other) items.push(other);
        continue;
      }
      if (!visible(child)) continue;
      const body = flag(child, kids(child)).trim().replace(/\n{2,}(?=- |\d+\. )/g, '\n');
      if (!body) continue;
      const marker = ordered ? `${n++}. ` : '- ';
      items.push(marker + body.replace(/\n/g, `\n${' '.repeat(marker.length)}`));
    }
    return block(items.join('\n'));
  }

  function table(node) {
    // Layout tables (nested, or a single column) are just containers.
    if (node.querySelector('table')) return block(kids(node));
    const cell = (s) => oneLine(s).replace(/\|/g, '\\|');
    const rows = [...node.rows]
      .filter(visible)
      .map((tr) =>
        [...tr.cells].filter(visible).flatMap((td) => {
          const span = Math.min(Math.max(td.colSpan || 1, 1), 50);
          return [cell(kids(td)), ...Array(span - 1).fill('')];
        })
      )
      .filter((r) => r.some(Boolean));
    const width = Math.max(0, ...rows.map((r) => r.length));
    if (width < 2) return block(kids(node));
    const line = (r) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
    const out = [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)];
    const caption = node.caption && visible(node.caption) ? oneLine(kids(node.caption)) : '';
    return block((caption ? `**${caption}**\n\n` : '') + out.join('\n'));
  }

  function field(node, tag) {
    const type = tag === 'INPUT' ? (node.getAttribute('type') || 'text').toLowerCase() : tag.toLowerCase();
    if (type === 'hidden') return '';
    if (type === 'checkbox' || type === 'radio') return node.checked ? '[x] ' : '[ ] ';
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') {
      return ` [${node.value || node.alt || label(node) || type}] `;
    }
    const name = (node.getAttribute('placeholder') || label(node) || node.getAttribute('name') || type).trim();
    // Never export secrets.
    const secret = type === 'password' || /^cc-/.test(node.getAttribute('autocomplete') || '');
    let value = '';
    if (secret) value = node.value ? '(hidden)' : '';
    else if (tag === 'SELECT') value = [...node.selectedOptions].map((o) => o.textContent.trim()).join(', ');
    else if (type !== 'file') value = (node.value || '').replace(/\s+/g, ' ').trim();
    return ` [${name}: ${value || '___'}] `;
  }

  function iframe(node) {
    let doc = null;
    try {
      doc = node.contentDocument;
    } catch {
      /* cross-origin */
    }
    if (doc && doc.body) return block(kids(doc.body));
    const src = node.src || '';
    if (!/^https?:/.test(src) || !isBig(node)) return ''; // ads, trackers
    const title = (node.title || '').trim();
    return block(`[iframe: ${title ? `${title} — ` : ''}${src}]`);
  }

  // Trim line ends and collapse blank lines, leaving code fences untouched.
  function tidy(s) {
    const out = [];
    let fence = null;
    let blank = 0;
    for (let line of s.split('\n')) {
      const mark = (line.match(/^\s*(`{3,})/) || [])[1];
      if (fence) {
        out.push(line);
        if (line.trim() === fence) fence = null;
        continue;
      }
      if (mark) fence = mark;
      line = line.replace(/\s+$/, '');
      if (line) blank = 0;
      else if (++blank > 1 || !out.length) continue;
      out.push(line);
    }
    return out.join('\n').trim();
  }

  // ------------------------------------------------------------- metadata

  function meta(...names) {
    for (const name of names) {
      const el = document.querySelector(
        `meta[name="${name}" i], meta[property="${name}" i], meta[itemprop="${name}" i]`
      );
      const value = el && (el.getAttribute('content') || '').replace(/\s+/g, ' ').trim();
      if (value) return value;
    }
    return '';
  }

  function frontMatter() {
    const canonical = abs((document.querySelector('link[rel="canonical"]') || {}).href || '');
    const fields = {
      title: document.title.trim() || meta('og:title'),
      url: location.href,
      canonical: canonical && canonical !== location.href ? canonical : '',
      site: meta('og:site_name', 'application-name') || location.hostname,
      author: meta('author', 'article:author', 'twitter:creator'),
      published: meta('article:published_time', 'datePublished', 'date'),
      modified: meta('article:modified_time', 'dateModified'),
      description: meta('description', 'og:description'),
      language: document.documentElement.lang || '',
      image: meta('og:image'),
      captured_at: new Date().toISOString(),
    };
    const lines = Object.entries(fields)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    return `---\n${lines.join('\n')}\n---`;
  }

  function jsonLd() {
    const blocks = [];
    let size = 0;
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const text = JSON.stringify(JSON.parse(el.textContent));
        if ((size += text.length) > JSON_LD_LIMIT) break;
        blocks.push(text);
      } catch {
        /* invalid JSON-LD */
      }
    }
    if (!blocks.length) return '';
    return `\n\n---\n\n## Structured data (JSON-LD)\n\n\`\`\`json\n${blocks.join('\n')}\n\`\`\``;
  }

  function capture() {
    let body = tidy(kids(document.body));
    const title = document.title.trim();
    if (title && !/^# /m.test(body)) body = `# ${title}\n\n${body}`;
    const note =
      '> Snapshot of a web page exactly as rendered in the user\'s browser (after JavaScript, ' +
      'with their session), captured by Screen Page. Everything below is the visible page ' +
      'content in reading order. `[Label]` is a button, `[name: value]` a form field, ' +
      '`[x]`/`[ ]` a checkbox, `[graphic: …]` the labels of a chart, and `<!-- nav -->`-style ' +
      'comments mark page regions. `(selected)` marks the active tab/option; `(highlighted)` ' +
      'marks a label the page styles differently from its neighbours (active status, key value).';
    return `${frontMatter()}\n\n${note}\n\n${body}${jsonLd()}\n`;
  }

  // ------------------------------------------------------------ page prep

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Scroll through the page once so lazy-loaded sections and images exist.
  async function loadAll() {
    const el = document.scrollingElement || document.documentElement;
    const start = el.scrollTop;
    const step = Math.max(200, window.innerHeight);
    const deadline = Date.now() + 8000;
    if (el.scrollHeight <= step + 50) return;
    for (let y = 0; y < el.scrollHeight - step && Date.now() < deadline; y += step) {
      window.scrollTo({ top: y + step, behavior: 'instant' });
      await sleep(120);
    }
    await sleep(300);
    window.scrollTo({ top: start, behavior: 'instant' });
    await sleep(100);
  }

  // ------------------------------------------------------ full-page image

  const PDF_MAX_PAGES = 100;

  // Cross-origin images are fetched through the userscript manager, which is
  // not subject to CORS; everything else uses the renderer's normal fetch.
  function fetchAsDataUrl(url) {
    const request =
      typeof GM_xmlhttpRequest === 'function'
        ? GM_xmlhttpRequest
        : typeof GM !== 'undefined' && GM.xmlHttpRequest
          ? GM.xmlHttpRequest.bind(GM)
          : null;
    let sameOrigin = true;
    try {
      sameOrigin = new URL(url, location.href).origin === location.origin;
    } catch {
      /* keep default */
    }
    if (!request || sameOrigin || !/^https?:/.test(url)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const fail = () => resolve(false);
      try {
        request({
          method: 'GET',
          url,
          responseType: 'blob',
          timeout: 10000,
          onerror: fail,
          ontimeout: fail,
          onload: (res) => {
            if (res.status < 200 || res.status >= 300 || !(res.response instanceof Blob)) return fail();
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = fail;
            reader.readAsDataURL(res.response);
          },
        });
      } catch {
        fail();
      }
    });
  }

  // Minimal PDF writer: one JPEG per page, no dependency.
  function buildPdf(pages, title) {
    const enc = new TextEncoder();
    const parts = [];
    const offsets = [];
    let pos = 0;
    const push = (data) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      parts.push(bytes);
      pos += bytes.length;
    };
    const obj = (n, dict, stream) => {
      offsets[n] = pos;
      push(`${n} 0 obj\n${dict}\n`);
      if (stream) {
        push('stream\n');
        push(stream);
        push('\nendstream\n');
      }
      push('endobj\n');
    };
    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
    pages.forEach((p, i) => {
      const n = 3 + i * 3;
      const content = enc.encode(`q ${p.pw} 0 0 ${p.ph} 0 0 cm /Im0 Do Q`);
      obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.pw} ${p.ph}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
      obj(n + 1, `<< /Length ${content.length} >>`, content);
      obj(
        n + 2,
        `<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`,
        p.jpeg
      );
    });
    const info = 3 + pages.length * 3;
    const safe = title.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '');
    obj(info, `<< /Title (${safe}) /Creator (Screen Page) >>`);
    const xref = pos;
    push(`xref\n0 ${info + 1}\n0000000000 65535 f \n`);
    for (let n = 1; n <= info; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${info + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  // Render the whole document once as a vector image, then cut it into
  // screen-sized pages: a single very tall picture is unreadable for an AI.
  async function capturePdf() {
    const renderer = globalThis.modernScreenshot || window.modernScreenshot;
    if (!renderer) throw new Error('renderer not loaded, reinstall the script');

    const root = document.documentElement;
    const body = document.body;
    const width = Math.max(root.scrollWidth, root.clientWidth);
    const height = Math.max(root.scrollHeight, body.scrollHeight, root.clientHeight);
    const opaque = (c) => c && c !== 'transparent' && !/,\s*0\)$/.test(c);
    const background = [styleOf(root).backgroundColor, styleOf(body).backgroundColor].find(opaque) || '#fff';

    const svg = await renderer.domToSvg(root, {
      width,
      height,
      backgroundColor: background,
      timeout: 15000,
      filter: (n) => !String(n.id || '').startsWith(UI_ID),
      fetchFn: fetchAsDataUrl,
    });
    const img = new Image();
    img.src = svg;
    await img.decode();

    const scale = Math.min(2, Math.max(1, 1600 / width));
    const sliceH = Math.round(width * (width < 700 ? 2 : 1.414));
    const overlap = 24; // so a line cut by a page break is whole on the next page
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const draw = (y, h) => {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(h * scale);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, -y * scale);
      ctx.drawImage(img, 0, 0, width, height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    // WebKit paints images embedded in an SVG only after a few attempts.
    for (let i = 0; i < 3; i++) {
      draw(0, Math.min(sliceH, height));
      await sleep(100);
    }

    const pages = [];
    let truncated = false;
    for (let y = 0; y < height; y += sliceH - overlap) {
      if (pages.length === PDF_MAX_PAGES) {
        truncated = true;
        break;
      }
      const h = Math.min(sliceH, height - y);
      draw(y, h);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('could not encode the image');
      pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height, pw: width, ph: h });
      if (y + h >= height) break;
    }
    return { pdf: buildPdf(pages, location.href), pages: pages.length, truncated };
  }

  // -------------------------------------------------------------- actions

  function fileName(ext) {
    const slug = (document.title || 'page')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .toLowerCase();
    const day = new Date().toISOString().slice(0, 10);
    return [location.hostname.replace(/^www\./, ''), slug || 'page', day].filter(Boolean).join('-') + ext;
  }

  function toast(message, sticky) {
    const old = document.getElementById(UI_ID + '-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = UI_ID + '-toast';
    el.textContent = message;
    el.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;' +
      'padding:8px 14px;border-radius:8px;background:#111;color:#fff;' +
      'font:14px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    document.documentElement.append(el);
    if (!sticky) setTimeout(() => el.remove(), 2200);
  }

  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.documentElement.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  let busy = false;
  async function run(label, job) {
    if (busy) return;
    busy = true;
    try {
      toast(label, true);
      await loadAll();
      toast(await job());
    } catch (err) {
      toast(`Screen Page: ${(err && err.message) || err}`);
    } finally {
      busy = false;
    }
  }

  const downloadMd = () =>
    run('Reading the page…', () => {
      save(new Blob([capture()], { type: 'text/markdown;charset=utf-8' }), fileName('.md'));
      return 'Page saved ✓';
    });

  const downloadPdf = () =>
    run('Capturing the page…', async () => {
      const { pdf, pages, truncated } = await capturePdf();
      save(pdf, fileName('.pdf'));
      return truncated ? `Saved the first ${pages} pages ✓` : `Page saved (${pages} p.) ✓`;
    });

  const copyMd = () =>
    run('Reading the page…', async () => {
      const text = capture();
      if (typeof GM_setClipboard === 'function') GM_setClipboard(text, 'text');
      else if (typeof GM !== 'undefined' && GM.setClipboard) await GM.setClipboard(text);
      else await navigator.clipboard.writeText(text);
      return 'Page copied ✓';
    });

  // ----------------------------------------------------------------- menu

  const COMMANDS = [
    ['Download the page (.md)', downloadMd],
    ['Download the page as image (.pdf)', downloadPdf],
    ['Copy the page (Markdown)', copyMd],
  ];

  let register = null;
  if (typeof GM_registerMenuCommand === 'function') register = GM_registerMenuCommand;
  else if (typeof GM !== 'undefined' && GM.registerMenuCommand) register = GM.registerMenuCommand.bind(GM);

  if (register) {
    for (const [name, action] of COMMANDS) register(name, action);
  } else {
    // Managers without a script menu (e.g. Userscripts on iOS): one discreet
    // button that opens the same three commands.
    const box = document.createElement('div');
    box.id = UI_ID;
    box.style.cssText =
      'position:fixed;right:10px;bottom:10px;z-index:2147483647;display:flex;' +
      'flex-direction:column;align-items:flex-end;gap:6px;font:14px/1.2 system-ui,sans-serif';
    const base = 'border:0;background:#111;color:#fff;cursor:pointer;font:inherit;';
    const items = COMMANDS.map(([name, action]) => {
      const item = document.createElement('button');
      item.textContent = name;
      item.style.cssText = `${base}display:none;padding:9px 12px;border-radius:8px`;
      item.addEventListener('click', () => {
        toggle(false);
        action();
      });
      return item;
    });
    const main = document.createElement('button');
    main.textContent = '↓';
    main.title = 'Screen Page';
    main.style.cssText = `${base}width:34px;height:34px;padding:0;border-radius:50%;opacity:.45;font-size:18px`;
    const toggle = (open) => {
      for (const item of items) item.style.display = open ? 'block' : 'none';
      main.style.opacity = open ? '1' : '.45';
    };
    main.addEventListener('click', () => toggle(items[0].style.display === 'none'));
    box.append(...items, main);
    document.documentElement.append(box);
  }
})();
