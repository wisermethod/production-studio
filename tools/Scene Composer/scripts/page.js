'use strict';
const { json } = require('./rational.js');
// Both functions below are serialized into the project. They close over nothing.
function stateAt(D, f) {
  const ease = t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const blend = (a, b, t) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] + (b[k] - a[k]) * t]));
  function motion(start, moves, target, time = f) {
    let previous = start;
    for (const m of moves) {
      const dest = target(m);
      if (time >= m.frame) { previous = dest; continue; }
      if (time <= m.start_frame) return previous;
      return blend(previous, dest, ease(clamp((time - m.start_frame) / (m.frame - m.start_frame), 0, 1)));
    }
    return previous;
  }
  function bounded(k, x, y) {
    const axis = (p, span, view) => span <= view ? (view - span) / 2 : clamp(p, view - span, 0);
    return { k, x: axis(x, D.still.width * k, D.width), y: axis(y, D.still.height * k, D.height) };
  }
  function camera(m) {
    const r = m.rect === 'full' ? { x: 0, y: 0, w: D.still.width, h: D.still.height } : m.rect;
    const margin = m.rect === 'full' ? 0 : Math.min(D.width, D.height) * 0.04;
    const k = Math.min((D.width - 2 * margin) / r.w, (D.height - 2 * margin) / r.h);
    return bounded(k, D.width / 2 - (r.x + r.w / 2) * k, D.height / 2 - (r.y + r.h / 2) * k);
  }
  const c = motion(camera({ rect: 'full' }), D.camera, camera);
  function alpha(start, until, fadeIn = D.fades.callout, fadeOut = D.fades.out) {
    if (f < start) return 0;
    const up = clamp((f - start + 1) / Math.max(1, fadeIn), 0, 1);
    const down = until === undefined || f < until ? 1 : clamp(1 - (f - until + 1) / Math.max(1, fadeOut), 0, 1);
    return Math.min(up, down);
  }
  const cursorAt = time => D.cursor && motion(D.cursor.start, D.cursor.moves, m => ({ x: m.x, y: m.y }), time);
  // Click centers must be sampled at the click, not at the current seek.
  return {
    camera: bounded(c.k, c.x, c.y), cursor: cursorAt(f),
    chip: D.chip ? alpha(D.chip.frame, D.chip.until, D.fades.chip) : 0,
    callouts: D.callouts.map(c => alpha(c.frame, c.until)),
    clicks: D.clicks.map(c => {
      const age = (f - c.frame) / D.fps;
      return { ...cursorAt(c.frame), opacity: age < 0 || age >= 0.5 ? 0 : Math.min(alpha(c.frame, undefined, D.fades.ripple), 1 - age / 0.5), scale: 0.4 + 1.4 * clamp(age / 0.5, 0, 1) };
    }),
    captions: D.captions.cues.map(c => f < c.end_frame ? alpha(c.start_frame, undefined, D.fades.caption) : 0)
  };
}
function mount(D, stateAt) {
  const get = id => document.getElementById(id);
  const camera = get('camera');
  function element(tag, className, parent, text) {
    const e = document.createElement(tag); e.className = className;
    if (text !== undefined) e.textContent = text;
    parent.appendChild(e); return e;
  }
  // A label is placed from the rectangle and the still alone, never from a measured width, so its place cannot depend on
  // whether a font had loaded when a seek ran: it sits beside the rectangle on the side with more room, as wide as that
  // room allows, and wraps; with under 80 pixels either side it sits inside the rectangle's top left corner.
  const GAP = 12, MIN = 80;
  const callouts = D.callouts.map(c => {
    const r = c.rect, e = element('div', 'callout', camera), label = element('div', 'label', camera, c.label);
    Object.assign(e.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    const right = D.still.width - (r.x + r.w + GAP), left = r.x - GAP;
    if (Math.max(right, left) < MIN) Object.assign(label.style, { left: `${r.x + GAP}px`, top: `${r.y + GAP}px`, maxWidth: `${Math.max(1, r.w - 2 * GAP)}px` });
    else if (right >= left) Object.assign(label.style, { left: `${r.x + r.w + GAP}px`, top: `${r.y}px`, maxWidth: `${right}px` });
    else Object.assign(label.style, { right: `${D.still.width - left}px`, top: `${r.y}px`, maxWidth: `${left}px` });
    return { e, label };
  });
  const clicks = D.clicks.map(() => element('div', 'ripple', camera));
  const captions = D.captions.mode === 'drawn' ? D.captions.cues.map(c => element('div', 'caption', get('root'), c.text)) : [];
  if (D.chip) get('chip').textContent = D.chip.text;
  function seek(time) {
    const f = Math.max(0, Math.min(D.frames, Math.round(time * D.fps)));
    const s = stateAt(D, f);
    camera.style.transform = `translate(${s.camera.x}px,${s.camera.y}px) scale(${s.camera.k})`;
    if (D.cursor) get('cursor').style.transform = `translate(${s.cursor.x}px,${s.cursor.y}px)`;
    get('cursor').style.opacity = D.cursor ? '1' : '0';
    get('chip').style.opacity = String(s.chip);
    callouts.forEach((c, i) => { c.e.style.opacity = c.label.style.opacity = String(s.callouts[i]); });
    clicks.forEach((e, i) => {
      const c = s.clicks[i]; e.style.opacity = String(c.opacity);
      e.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.scale})`;
    });
    captions.forEach((e, i) => { e.style.opacity = String(s.captions[i]); });
  }
  window.addEventListener('video-render:seek', e => seek(e.detail.time));
  seek(0);
}
function page(D) {
  const family = D.fonts.length ? JSON.stringify(D.fonts[0].family) : 'sans-serif';
  const faces = D.fonts.map(f => `@font-face { font-family: ${JSON.stringify(f.family)}; src: url("${f.file}"); font-weight: ${f.weight}; font-style: ${f.style}; font-display: block; }`).join('\n');
  const c = D.colors, s = D.captions.style;
  // Every element whose opacity changes stays on a compositing layer of its own from the first seek, so a frame never
  // depends on whether an earlier seek in the same browser had promoted it mid-fade: without this, text drawn after a
  // fade differed by one or two levels between one render worker and several. Nothing is marked for transform: a
  // layer so marked is rasterized at one scale and resized, so a zoom's detail would depend on when it was drawn.
  const css = `${faces}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { width: ${D.width}px; height: ${D.height}px; overflow: hidden; }
#root { position: relative; background: ${c.background}; font-family: ${family}; }
#camera { position: absolute; left: 0; top: 0; width: ${D.still.width}px; height: ${D.still.height}px; transform-origin: 0 0; }
#still { image-orientation: none; display: block; width: 100%; height: 100%; border-radius: 8px; box-shadow: 0 16px 48px #0006; }
#cursor { will-change: opacity; z-index: 3; position: absolute; left: -4px; top: -2px; width: 34px; height: 34px; opacity: 0; overflow: visible; }
#cursor path { fill: ${c.cursor_fill}; stroke: ${c.cursor_stroke}; }
.callout { will-change: opacity; z-index: 1; position: absolute; border: 4px solid ${c.highlight}; border-radius: 10px; box-shadow: 0 0 0 5px #0002; opacity: 0; }
.label { will-change: opacity; z-index: 1; opacity: 0; position: absolute; width: max-content; max-width: ${D.still.width}px; background: ${c.label_background}; color: ${c.label_text}; font-size: 24px; line-height: 1.3; font-weight: ${D.fonts[0]?.weight ?? 400}; padding: 8px 16px; border-radius: 10px; overflow-wrap: anywhere; }
#chip { will-change: opacity; z-index: 4; position: absolute; left: 2%; top: 3%; max-width: 96%; background: ${c.chip_background}; color: ${c.chip_text}; font-size: ${Math.min(D.width, D.height) * 0.04}px; line-height: 1.3; font-weight: ${D.fonts[0]?.weight ?? 400}; padding: 10px 22px; border-radius: 12px; opacity: 0; }
.ripple { will-change: opacity; z-index: 2; position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; border: 4px solid ${c.click_ripple}; border-radius: 50%; opacity: 0; transform-origin: center; }
${s ? `.caption { will-change: opacity; z-index: 5; position: absolute; left: 50%; ${s.position}: ${s.margin}px; transform: translateX(-50%); width: max-content; max-width: ${s.max_width}px; font-family: ${JSON.stringify(s.font)}; font-size: ${s.size}px; font-weight: ${s.weight}; line-height: 1.3; color: ${s.color}; background: ${s.background === 'none' ? 'transparent' : s.background}; padding: ${s.padding}px; border-radius: ${s.radius}px; text-align: center; overflow-wrap: anywhere; opacity: 0; }` : ''}
`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Walkthrough scene</title><link rel="stylesheet" href="style.css"></head>
<body><div id="root" data-video-root><div id="camera"><img id="still" src="${D.still.file}" alt=""><svg id="cursor" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg"><path d="M4 2 L4 28 L11 21 L16 32 L21 30 L16 19 L26 19 Z" stroke-width="2.2" stroke-linejoin="round"/></svg></div><div id="chip"></div></div><script src="scene.js"></script></body></html>
`;
  return {
    'project/index.html': html, 'project/style.css': css,
    'project/scene.js': `'use strict';\nconst SCENE = ${json(D).trimEnd()};\n(${mount.toString()})(SCENE, ${stateAt.toString()});\n`
  };
}
module.exports = { page, stateAt };
