import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Build the glyph audit page straight out of `BattleIcons.tsx`.
 *
 *   node scripts/glyph-audit.mjs && open glyph-audit.html
 *
 * Generated rather than hand-written, so what is audited is what actually
 * renders — a copied path set drifts from the component the first time either
 * is touched, which is the one thing an audit must not do.
 *
 * It shows every glyph at every size the UI uses, a nearest-neighbour
 * magnification of the real 18px rasterisation (the test that killed four
 * candidates), and the whole set on a dark and a light panel, because the
 * lifter's bays and the garrison's road wheels are punched with `evenodd` and
 * have to stay holes on any background.
 */
const SRC = new URL('../web/src/components/BattleIcons.tsx', import.meta.url);
const src = readFileSync(SRC, 'utf8');

const ICONS = [
  ['ShipIcon', 'battleship', 'battleship', '#7fd4cd'],
  ['EscortIcon', 'escort', 'escort', '#fbbf24'],
  ['TorpedoBoatIcon', 'torpedo_boat', 'torpedo boat', '#f87171'],
  ['LifterIcon', 'lifter', 'lifter', '#4ade80'],
  ['GarrisonIcon', 'garrison', 'garrison (ground)', '#a78bfa'],
];

function bodyOf(fnName) {
  const start = src.indexOf(`export function ${fnName}(`);
  if (start < 0) throw new Error(`${fnName} not found`);
  const open = src.indexOf('<svg', start);
  const close = src.indexOf('</svg>', open);
  const inner = src.slice(src.indexOf('>', src.indexOf('aria-hidden', open)) + 1, close);
  // Keep only <path>/<rect>, drop the {title && …} expression.
  const out = [];
  for (const m of inner.matchAll(/<(path|rect)\b[\s\S]*?\/>/g)) {
    out.push(
      m[0]
        .replace(/fillRule=/g, 'fill-rule=')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\s+/g, ' '),
    );
  }
  if (out.length === 0) throw new Error(`no shapes parsed from ${fnName}`);
  return out.join('');
}

const glyphs = ICONS.map(([fn, key, label, color]) => ({
  key,
  label,
  color,
  body: bodyOf(fn),
}));

const svg = (g, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" style="color:${g.color}" xmlns="http://www.w3.org/2000/svg">${g.body}</svg>`;

const dataUrl = (g, size) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(svg(g, size));

const SIZES = [13, 16, 18, 24, 32, 64];

const html = `<title>Hull glyph audit</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0b0d12; color:#d6dae2; margin:0; padding:28px 32px 60px;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px; }
  h1 { font-size:15px; letter-spacing:.06em; margin:0 0 4px; }
  p.sub { color:#7b8494; margin:0 0 26px; font-size:12px; }
  h2 { font-size:11px; letter-spacing:.09em; text-transform:uppercase; color:#7b8494;
       margin:34px 0 10px; font-weight:400; border-top:1px solid #232833; padding-top:14px; }
  table { border-collapse:collapse; }
  th { font-size:10px; color:#7b8494; font-weight:400; padding:0 16px 8px; }
  td { padding:9px 16px; text-align:center; vertical-align:middle; }
  td.name { text-align:left; color:#d6dae2; min-width:120px; }
  .panel { background:#12151c; border:1px solid #232833; padding:12px 14px; display:flex;
           flex-wrap:wrap; gap:18px; align-items:center; }
  .panel.light { background:#d6dae2; }
  .panel span { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#7b8494; }
  .panel.light span { color:#3a4150; }
  .mag { display:flex; flex-wrap:wrap; gap:14px; }
  .mag figure { margin:0; text-align:center; }
  .mag img { image-rendering:pixelated; background:#12151c; border:1px solid #232833; display:block; }
  .mag figcaption { color:#7b8494; font-size:11px; margin-top:6px; }
  .note { color:#7b8494; font-size:11px; margin:8px 0 0; max-width:70ch; line-height:1.55; }
</style>

<h1>Hull glyph audit</h1>
<p class="sub">Generated from <code>web/src/components/BattleIcons.tsx</code> — these are the shipped paths.</p>

<h2>Every glyph, every size it is used at</h2>
<table>
  <tr><th style="text-align:left">class</th>${SIZES.map((s) => `<th>${s}px</th>`).join('')}</tr>
  ${glyphs
    .map(
      (g) =>
        `<tr><td class="name">${g.label}</td>` +
        SIZES.map((s) => `<td>${svg(g, s)}</td>`).join('') +
        '</tr>',
    )
    .join('')}
</table>

<h2>Rendered at 18px, then magnified — what the eye actually gets</h2>
<div class="mag">
  ${glyphs
    .map(
      (g) =>
        `<figure><img src="${dataUrl(g, 18)}" width="180" height="180"><figcaption>${g.label}</figcaption></figure>`,
    )
    .join('')}
</div>
<p class="note">Nearest-neighbour magnification of the real 18px rasterisation. Detail that
vanishes here vanishes in the order of battle — this is the test that killed a fletched needle
(read as a fish skeleton), a tube-over-hull (stacked bars), a single chevron (a UI arrow) and a
wet-navy battleship (wrong genre).</p>

<h2>At row size, side by side — the actual bar</h2>
<div class="panel">${glyphs.map((g) => `<span>${svg(g, 18)} ${g.label}</span>`).join('')}</div>
<p class="note">Can you tell them apart without reading the label? The torpedo boat is the only
asymmetric glyph in the set, which is what makes it findable; its underside is deliberately clean,
because a ventral strake turned it into a red copy of the escort.</p>

<h2>On a light panel — the lifter's bays must stay holes</h2>
<div class="panel light">${glyphs.map((g) => `<span>${svg(g, 18)} ${g.label}</span>`).join('')}</div>
<p class="note">The lifter's bays and the garrison's road wheels are punched with
<code>evenodd</code> rather than painted in the panel colour, so they survive any background.
If either fills in here, that is the bug.</p>
`;

writeFileSync(
  new URL('../glyph-audit.html', import.meta.url),
  html,
);
console.log(`built audit for ${glyphs.length} glyphs`);
for (const g of glyphs) console.log(`  ${g.label.padEnd(18)} ${g.body.length} chars of path data`);
