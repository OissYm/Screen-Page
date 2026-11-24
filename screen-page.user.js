// ==UserScript==
// @name         Screen Page
// @namespace    https://github.com/OissYm/Screen-Page
// @version      1.0.0
// @description  Save the page you are looking at (after JavaScript, with your session) as clean Markdown any AI can read.
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
// ==/UserScript==

(() => {
  'use strict';

  const UI_ID = 'screen-page-ui';
  const JSON_LD_LIMIT = 30000;
  const SKIP = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE',
    'SVG', 'CANVAS', 'OBJECT', 'EMBED', 'MAP', 'DATALIST', 'SOURCE', 'TRACK',
  ]);

  // ---------------------------------------------------------------- helpers

  const styleOf = (el) => el.ownerDocument.defaultView.getComputedStyle(el);

  function visible(el) {
    if (el.getAttribute('aria-hidden') === 'true') return false;
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

  // ------------------------------------------------------- DOM -> Markdown

  function kids(node) {
    let nodes = node.childNodes;
    if (node.shadowRoot) nodes = node.shadowRoot.childNodes;
    else if (node.tagName === 'SLOT') {
      const assigned = node.assignedNodes({ flatten: true });
      if (assigned.length) nodes = assigned;
    }
    let out = '';
    for (const child of nodes) {
      let s = md(child);
      if (!s) continue;
      if (!out || /\s$/.test(out)) s = s.replace(/^ +/, '');
      out += s;
    }
    return out;
  }

  function md(node) {
    if (node.nodeType === 3) return node.data.replace(/​/g, '').replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag) || node.id === UI_ID || !visible(node)) return '';

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

    const inner = kids(node);
    const display = styleOf(node).display;
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
      const body = kids(child).trim().replace(/\n{2,}(?=- |\d+\. )/g, '\n');
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
      '`[x]`/`[ ]` a checkbox, and `<!-- nav -->`-style comments mark page regions.';
    return `${frontMatter()}\n\n${note}\n\n${body}${jsonLd()}\n`;
  }

  // -------------------------------------------------------------- actions

  function fileName() {
    const slug = (document.title || 'page')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .toLowerCase();
    const day = new Date().toISOString().slice(0, 10);
    return [location.hostname.replace(/^www\./, ''), slug || 'page', day].filter(Boolean).join('-') + '.md';
  }

  function toast(message) {
    const el = document.createElement('div');
    el.id = UI_ID;
    el.textContent = message;
    el.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;' +
      'padding:8px 14px;border-radius:8px;background:#111;color:#fff;' +
      'font:14px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    document.documentElement.append(el);
    setTimeout(() => el.remove(), 1800);
  }

  function download() {
    try {
      const url = URL.createObjectURL(new Blob([capture()], { type: 'text/markdown;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName();
      a.style.display = 'none';
      document.documentElement.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('Page saved ✓');
    } catch (err) {
      toast(`Screen Page: ${err.message}`);
    }
  }

  async function copy() {
    try {
      const text = capture();
      if (typeof GM_setClipboard === 'function') GM_setClipboard(text, 'text');
      else if (typeof GM !== 'undefined' && GM.setClipboard) await GM.setClipboard(text);
      else await navigator.clipboard.writeText(text);
      toast('Page copied ✓');
    } catch (err) {
      toast(`Screen Page: ${err.message}`);
    }
  }

  // ----------------------------------------------------------------- menu

  let register = null;
  if (typeof GM_registerMenuCommand === 'function') register = GM_registerMenuCommand;
  else if (typeof GM !== 'undefined' && GM.registerMenuCommand) register = GM.registerMenuCommand.bind(GM);

  if (register) {
    register('Download the page (.md)', download);
    register('Copy the page (Markdown)', copy);
  } else {
    // Managers without a script menu (e.g. Userscripts on iOS): one discreet button.
    const button = document.createElement('button');
    button.id = UI_ID;
    button.textContent = '↓';
    button.title = 'Download the page (.md)';
    button.style.cssText =
      'position:fixed;right:10px;bottom:10px;z-index:2147483647;width:34px;height:34px;' +
      'padding:0;border:0;border-radius:50%;background:#111;color:#fff;opacity:.45;' +
      'font:18px/34px system-ui,sans-serif;cursor:pointer';
    button.addEventListener('click', download);
    document.documentElement.append(button);
  }
})();
