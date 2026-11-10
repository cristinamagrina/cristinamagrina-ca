#!/usr/bin/env node
'use strict';
/*
 * Static site builder for cristinamagrina.ca and cristinamagrina.es.
 * No dependencies: only Node's standard library (Node 18+).
 *
 *   node build.js [ca|es|all]            build into dist/<site>
 *   node build.js check [ca|es|all]      build, then verify every internal link
 *   node build.js serve <ca|es> [port]   build, then preview with Cloudflare-style URLs
 *
 * Layout (see README.md):
 *   shared/            layout.html, partials/head.html, assets/, pages/<locale>/ (pages used by every site)
 *   sites/<id>/        site.json, partials/<locale>/{header,footer}.html, pages/<locale>/, assets/, static/
 * A page in sites/<id>/pages/<locale>/ overrides a shared page with the same name.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const posix = path.posix;
const flags = new Set(process.argv.filter(a => a.startsWith('--')));
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));

// ------------------------------------------------------------------ helpers
const readText = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const exists = f => fs.existsSync(f);
function listFiles(dir, base = dir, out = []) {
  if (!exists(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}
function writeOut(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}
function copyTree(srcDir, dstDir) {
  for (const rel of listFiles(srcDir)) {
    const dst = path.join(dstDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(srcDir, rel), dst);   // byte-for-byte (images, fonts, etc.)
  }
}
function siteIds() {
  return fs.readdirSync(path.join(ROOT, 'sites'), { withFileTypes: true })
    .filter(e => e.isDirectory() && exists(path.join(ROOT, 'sites', e.name, 'site.json')))
    .map(e => e.name);
}
function fail(msg) { console.error('ERROR: ' + msg); process.exit(1); }

// ------------------------------------------------------------------ site + pages
function loadSite(id) {
  const dir = path.join(ROOT, 'sites', id);
  const site = JSON.parse(readText(path.join(dir, 'site.json')));
  site.id = id;
  site.dir = dir;
  if (flags.has('--no-clean-urls')) site.cleanUrls = false;
  return site;
}

function parsePage(text, file) {
  const m = /^<!--meta\n([\s\S]*?)\n-->\n/.exec(text);
  if (!m) fail(`${file}: missing <!--meta ... --> block at the top of the file`);
  let meta;
  try { meta = JSON.parse(m[1]); } catch (e) { fail(`${file}: invalid JSON in meta block (${e.message})`); }
  const rest = text.slice(m[0].length);
  if (meta.raw) return { meta, raw: rest };
  const i = rest.indexOf('<main');
  if (i < 0) fail(`${file}: no <main> element found`);
  const extras = rest.slice(0, i);                 // extra <head> lines (JSON-LD, robots...)
  const content = rest.slice(i).replace(/\n+$/, '');
  for (const k of ['title', 'description']) if (typeof meta[k] !== 'string') fail(`${file}: meta.${k} is required`);
  return { meta, extras, content };
}

function collectPages(site) {
  const pages = new Map();            // "locale:id" -> page
  const sources = [path.join(ROOT, 'shared', 'pages'), path.join(site.dir, 'pages')];
  sources.forEach((srcRoot, i) => {
    for (const locale of Object.keys(site.locales)) {
      const base = path.join(srcRoot, locale);
      for (const rel of listFiles(base).filter(f => f.endsWith('.html'))) {
        const id = rel.replace(/\.html$/, '');
        const file = path.join(base, rel);
        const page = parsePage(readText(file), path.relative(ROOT, file));
        pages.set(`${locale}:${id}`, { locale, id, shared: i === 0, file, ...page });
      }
    }
  });
  return pages;
}

// ------------------------------------------------------------------ URLs
const outPath = (site, locale, id) => posix.join(site.locales[locale].dir, id + '.html');
function urlOf(site, locale, id) {
  const p = outPath(site, locale, id);
  if (p === 'index.html' || p.endsWith('/index.html')) return site.origin + '/' + p.slice(0, -'index.html'.length);
  return site.origin + '/' + (site.cleanUrls ? p.slice(0, -'.html'.length) : p);
}

// ------------------------------------------------------------------ templating
const TOKEN = /\{\{(cur:[^}]+|[A-Za-z][\w]*)\}\}/g;
function fillTokens(doc, vars, where) {
  return doc.replace(TOKEN, (m, name) => {
    if (name.startsWith('cur:')) {
      return name.slice(4).split(',').map(s => s.trim()).includes(vars.current) ? ' aria-current="page"' : '';
    }
    if (!(name in vars)) fail(`${where}: unknown template token {{${name}}}`);
    return vars[name];
  });
}

function buildSite(id) {
  const site = loadSite(id);
  const out = path.join(DIST, id);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const layout = readText(path.join(ROOT, 'shared', 'layout.html'));
  const headTpl = readText(path.join(ROOT, 'shared', 'partials', 'head.html'));
  const partial = (locale, name) => {
    const f = path.join(site.dir, 'partials', locale, name + '.html');
    if (!exists(f)) fail(`missing partial ${path.relative(ROOT, f)}`);
    return readText(f);
  };
  const locales = Object.keys(site.locales);
  const pages = collectPages(site);
  const sharedUsed = [];
  let count = 0;

  for (const page of pages.values()) {
    const { locale, id: pid, meta } = page;
    const rel = outPath(site, locale, pid);
    if (page.raw !== undefined) { writeOut(path.join(out, rel), page.raw); count++; continue; }
    if (page.shared) sharedUsed.push(`${locale}:${pid}`);

    // "absolute": true -> root-absolute links (needed for 404 pages, which are served at any URL depth)
    const idDepth = pid.split('/').length - 1;
    const loc0 = site.locales[locale];
    const rootPrefix = meta.absolute ? '/' : '../'.repeat(rel.split('/').length - 1);
    const basePrefix = meta.absolute ? '/' + (loc0.dir ? loc0.dir + '/' : '') : '../'.repeat(idDepth);

    // language toggle target (sites have exactly two locales)
    const other = locales.find(l => l !== locale);
    const cid = (meta.counterparts && meta.counterparts[other]) || pid;
    let target = pages.get(`${other}:${cid}`) ? outPath(site, other, cid) : null;
    if (!target) {
      console.warn(`  warn: ${locale}:${pid} has no ${other} counterpart; language toggle points to the ${other} home page`);
      target = outPath(site, other, 'index');
    }
    const toggle = meta.absolute ? '/' + target : posix.relative(posix.dirname(rel), target);

    // hreflang alternates. A locale may declare "hreflang" (e.g. "es-ES") and "lang" (<html lang>) in
    // site.json; both default to the locale key, which keeps the .ca output unchanged.
    const hl = l => site.locales[l].hreflang || l;
    let hreflang = '';
    for (const l of locales) {
      const lid = l === locale ? pid : ((l !== locale && meta.counterparts && meta.counterparts[l]) || pid);
      if (pages.has(`${l}:${lid}`)) hreflang += `  <link rel="alternate" hreflang="${hl(l)}" href="${urlOf(site, l, lid)}">\n`;
    }
    const defId = site.defaultLocale === locale ? pid : ((meta.counterparts && meta.counterparts[site.defaultLocale]) || pid);
    if (pages.has(`${site.defaultLocale}:${defId}`)) hreflang += `  <link rel="alternate" hreflang="x-default" href="${urlOf(site, site.defaultLocale, defId)}">\n`;

    // fonts: default = Google Fonts (as the original site); "self" = self-hosted files in assets/fonts
    const fontLinks = site.fonts === 'self'
      ? `  <link rel="preload" href="${rootPrefix}assets/fonts/inter-latin-2.woff2" as="font" type="font/woff2" crossorigin>\n` +
        `  <link rel="stylesheet" href="${rootPrefix}assets/css/fonts.css">`
      : '  <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
        '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
        '  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">';

    const loc = site.locales[locale];
    const vars = {
      lang: loc.lang || locale, current: pid, root: rootPrefix, base: basePrefix, toggle, fontLinks,
      title: meta.title, description: meta.description,
      ogTitle: meta.ogTitle ?? meta.title, ogDescription: meta.ogDescription ?? meta.description,
      image: meta.image ?? site.defaultImage ?? 'hero-forest.jpg',
      canonical: urlOf(site, locale, pid), hreflang,
      siteName: site.siteName, origin: site.origin, domain: site.domain, email: site.email,
      mailSubject: loc.mailSubject, mailSubjectEnc: encodeURIComponent(loc.mailSubject),
      year: String(new Date().getFullYear()),
    };

    let doc = layout
      .replace('{{head}}', () => headTpl)
      .replace('{{extras}}', () => page.extras)
      .replace('{{header}}', () => partial(locale, 'header'))
      .replace('{{footer}}', () => partial(locale, 'footer'))
      .replace('{{content}}', () => page.content);
    doc = fillTokens(doc, vars, path.relative(ROOT, page.file));
    writeOut(path.join(out, rel), doc);
    count++;
  }

  // assets: shared first, then site overlay (e.g. config.js, site-specific images)
  copyTree(path.join(ROOT, 'shared', 'assets'), path.join(out, 'assets'));
  copyTree(path.join(site.dir, 'assets'), path.join(out, 'assets'));
  copyTree(path.join(site.dir, 'static'), out);          // _redirects, _headers, favicon.ico...

  // sitemap.xml + robots.txt
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
  const ordered = [...pages.values()].filter(p => p.raw === undefined && p.meta.sitemap !== false)
    .sort((a, b) => (a.id === 'index' ? 0 : 1) - (b.id === 'index' ? 0 : 1) || a.id.localeCompare(b.id) ||
      locales.indexOf(a.locale) - locales.indexOf(b.locale));
  for (const p of ordered) {
    const prio = p.id === 'index' ? '1.0' : p.id.startsWith('legal/') ? '0.4' : '0.8';
    xml += `  <url>\n    <loc>${urlOf(site, p.locale, p.id)}</loc>\n`;
    for (const l of locales) {
      const lid = l === p.locale ? p.id : ((p.meta.counterparts && p.meta.counterparts[l]) || p.id);
      if (pages.has(`${l}:${lid}`)) xml += `    <xhtml:link rel="alternate" hreflang="${site.locales[l].hreflang || l}" href="${urlOf(site, l, lid)}"/>\n`;
    }
    xml += `    <priority>${prio}</priority>\n  </url>\n`;
  }
  xml += '</urlset>\n';
  writeOut(path.join(out, 'sitemap.xml'), xml);
  const disallow = (site.robots && site.robots.disallow || []).map(d => `Disallow: ${d}\n`).join('');
  writeOut(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n${disallow}\nSitemap: ${site.origin}/sitemap.xml\n`);

  console.log(`built ${id}: ${count} pages -> ${path.relative(ROOT, out)}`);
  if (sharedUsed.length && id !== 'ca') {
    console.log(`  note: shared pages in use (review site-specific wording): ${sharedUsed.join(', ')}`);
  }
  return { site, out };
}

// ------------------------------------------------------------------ link check
function checkSite(id) {
  const out = path.join(DIST, id);
  const problems = [];
  const files = listFiles(out).filter(f => f.endsWith('.html'));
  for (const rel of files) {
    const text = fs.readFileSync(path.join(out, rel), 'utf8');
    for (const m of text.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      let u = m[1];
      if (/^(https?:|mailto:|tel:|#|data:|javascript:)/i.test(u)) continue;
      u = u.split('#')[0].split('?')[0];
      if (!u) continue;
      const target = u.startsWith('/') ? path.join(out, u) : path.join(out, path.dirname(rel), u);
      const ok = exists(target) && (fs.statSync(target).isFile() || exists(path.join(target, 'index.html')));
      if (!ok) problems.push(`${rel}: broken link -> ${m[1]}`);
    }
    for (const m of text.matchAll(/<link rel="(?:canonical|alternate)"[^>]*href="([^"]+)"/g)) {
      const u = new URL(m[1]);
      let p = decodeURIComponent(u.pathname);
      const cand = [p, p + '.html', p.replace(/\/$/, '') + '/index.html', p + 'index.html'];
      if (!cand.some(c => exists(path.join(out, c)))) problems.push(`${rel}: <link> URL does not exist in the build -> ${m[1]}`);
    }
  }
  if (problems.length) {
    console.error(`check ${id}: ${problems.length} problem(s)`);
    problems.forEach(p => console.error('  ' + p));
    return false;
  }
  console.log(`check ${id}: ${files.length} pages OK, no broken internal links`);
  return true;
}

// ------------------------------------------------------------------ preview server
function serve(id, port) {
  const { site, out } = buildSite(id);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
  const find = p => {
    const cands = [p, p + '.html', posix.join(p, 'index.html')];
    for (const c of cands) { const f = path.join(out, c); if (exists(f) && fs.statSync(f).isFile()) return f; }
    return null;
  };
  http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.includes('..')) { res.writeHead(400); return res.end('bad request'); }
    if (site.cleanUrls && p.endsWith('.html')) {            // Cloudflare Pages redirects /x.html -> /x
      const clean = p.endsWith('/index.html') ? p.slice(0, -'index.html'.length) : p.slice(0, -'.html'.length);
      res.writeHead(308, { Location: clean || '/' }); return res.end();
    }
    const f = find(p);
    if (f) { res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res); }
    const nf = path.join(out, '404.html');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(exists(nf) ? fs.readFileSync(nf) : 'Not found');
  }).listen(port, () => console.log(`serving ${id} at http://localhost:${port}/  (Ctrl+C to stop)`));
}

// ------------------------------------------------------------------ main
const ids = siteIds();
const cmd = args[0] && !ids.includes(args[0]) && args[0] !== 'all' ? args[0] : 'build';
const target = cmd === 'build' ? (args[0] || 'all') : args[1];
const targets = !target || target === 'all' ? ids : [target];
for (const t of targets) if (!ids.includes(t)) fail(`unknown site "${t}" (available: ${ids.join(', ')})`);

if (cmd === 'build') targets.forEach(buildSite);
else if (cmd === 'check') { targets.forEach(buildSite); if (!targets.map(checkSite).every(Boolean)) process.exit(1); }
else if (cmd === 'serve') { if (targets.length !== 1) fail('usage: node build.js serve <site> [port]'); serve(targets[0], Number(args[2]) || (targets[0] === 'ca' ? 4173 : 4174)); }
else fail(`unknown command "${cmd}"`);
