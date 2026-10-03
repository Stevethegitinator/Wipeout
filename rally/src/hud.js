// In-race HUD drawn on a 2D canvas over the 3D view.
import { fmtTime, fmtDelta, clamp } from './util.js';
import { noteIcon } from './codriver.js';

const FONT = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const GRADE_COL = { flat: '#7CFFB2', easy: '#3ee07a', medium: '#ffe14a', hard: '#ff9d2e', square: '#ff4d3a', hairpin: '#ff2a6a' };
const GRADE_ANG = { flat: 18, easy: 40, medium: 70, hard: 100, square: 120, hairpin: 175 };

export class Hud {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.msgs = []; this.t = 0;
    this.noteAnim = new Map();
  }
  resize(w, h, dpr) {
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    this.c.style.width = w + 'px'; this.c.style.height = h + 'px';
    this.w = w; this.h = h; this.dpr = dpr;
    this.S = Math.min(w / 1280, h / 720) * 1.0 + 0.0001;
  }
  clear() { this.g.setTransform(1, 0, 0, 1, 0, 0); this.g.clearRect(0, 0, this.c.width, this.c.height); }
  message(text, sub = '', col = '#fff', dur = 2.2, big = false) { this.msgs.push({ text, sub, col, t: 0, dur, big }); }

  draw(dt, st) {
    this.t += dt;
    const g = this.g, S = this.S, W = this.w, H = this.h;
    this.clear();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (st.hidden) { this.drawMessages(dt); return; }
    g.lineJoin = 'round'; g.lineCap = 'round';
    this.drawTimer(st);
    this.drawProgress(st);
    this.drawTacho(st);
    this.drawNotes(st);
    if (st.showDamage) this.drawDamage(st);
    this.drawMessages(dt);
    if (st.countdown !== undefined) this.drawCountdown(st.countdown);
  }

  panel(x, y, w, h, skew = 10, alpha = 0.55) {
    const g = this.g;
    g.beginPath(); g.moveTo(x + skew, y); g.lineTo(x + w, y); g.lineTo(x + w - skew, y + h); g.lineTo(x, y + h); g.closePath();
    const gr = g.createLinearGradient(x, y, x, y + h);
    gr.addColorStop(0, `rgba(12,16,24,${alpha})`); gr.addColorStop(1, `rgba(4,6,10,${alpha + 0.15})`);
    g.fillStyle = gr; g.fill();
  }
  text(s, x, y, size, col = '#fff', align = 'left', weight = 800, italic = true) {
    const g = this.g;
    g.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;
    g.textAlign = align; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillText(s, x + 1.5, y + 2);
    g.fillStyle = col; g.fillText(s, x, y);
  }

  drawTimer(st) {
    const S = this.S, x = 24 * S, y = 22 * S;
    this.panel(x, y, 270 * S, 74 * S, 14 * S);
    const g = this.g;
    g.fillStyle = '#ffcc00'; g.fillRect(x + 14 * S, y, 4 * S, 74 * S);
    this.text('STAGE TIME', x + 30 * S, y + 22 * S, 15 * S, '#9fb3c8', 'left', 700, false);
    this.text(fmtTime(st.time), x + 30 * S, y + 64 * S, 46 * S, '#ffffff');
    let yy = y + 92 * S;
    for (const sp of st.splits || []) {
      this.panel(x, yy - 22 * S, 270 * S, 30 * S, 10 * S, 0.45);
      this.text(sp.label, x + 30 * S, yy, 17 * S, '#cdd8e4', 'left', 700, false);
      this.text(fmtTime(sp.time), x + 120 * S, yy, 20 * S, '#fff');
      if (sp.delta !== undefined) this.text(fmtDelta(sp.delta), x + 255 * S, yy, 20 * S, sp.delta <= 0 ? '#4dff88' : '#ff5a4a', 'right');
      yy += 34 * S;
    }
    if (st.penalty) { this.text(`+${st.penalty}s PENALTY`, x + 30 * S, yy + 4 * S, 18 * S, '#ff8a3a'); }
    if (st.ghostDelta !== undefined) {
      this.panel(x, yy - 22 * S, 190 * S, 30 * S, 10 * S, 0.45);
      this.text('vs BEST', x + 30 * S, yy, 16 * S, '#cdd8e4', 'left', 700, false);
      this.text(fmtDelta(st.ghostDelta), x + 175 * S, yy, 20 * S, st.ghostDelta <= 0 ? '#4dff88' : '#ff5a4a', 'right');
    }
  }

  drawProgress(st) {
    const g = this.g, S = this.S;
    const x = 34 * S, y0 = this.h * 0.36, y1 = this.h * 0.8;
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 10 * S; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 4 * S; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
    const p = clamp(st.progress, 0, 1);
    const yp = y1 - (y1 - y0) * p;
    const gr = g.createLinearGradient(0, y1, 0, yp);
    gr.addColorStop(0, '#ffb300'); gr.addColorStop(1, '#ffe680');
    g.strokeStyle = gr; g.lineWidth = 4 * S; g.beginPath(); g.moveTo(x, y1); g.lineTo(x, yp); g.stroke();
    for (const s of st.splitMarks || []) { const yy = y1 - (y1 - y0) * s; g.fillStyle = '#fff'; g.fillRect(x - 8 * S, yy - 1.5 * S, 16 * S, 3 * S); }
    // Finish flag.
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(x - 8 * S + i * 4 * S, y0 - 14 * S + j * 4 * S, 4 * S, 4 * S); }
    if (st.ghostProgress !== undefined) { const yy = y1 - (y1 - y0) * clamp(st.ghostProgress, 0, 1); g.fillStyle = 'rgba(120,200,255,0.9)'; g.beginPath(); g.arc(x, yy, 5 * S, 0, 7); g.fill(); }
    g.fillStyle = '#ffcc00'; g.beginPath(); g.moveTo(x + 9 * S, yp); g.lineTo(x + 20 * S, yp - 7 * S); g.lineTo(x + 20 * S, yp + 7 * S); g.fill();
    g.beginPath(); g.arc(x, yp, 6 * S, 0, 7); g.fill();
  }

  drawTacho(st) {
    const g = this.g, S = this.S;
    const R = 92 * S, cx = this.w - 140 * S, cy = this.h - 120 * S;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const maxR = Math.ceil((st.redline + 500) / 1000) * 1000;
    const frac = (r) => clamp(r / maxR, 0, 1);
    // Backplate.
    const bg = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.25);
    bg.addColorStop(0, 'rgba(10,14,20,0.75)'); bg.addColorStop(1, 'rgba(10,14,20,0.0)');
    g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R * 1.25, 0, 7); g.fill();
    // Track and redline zone.
    g.lineWidth = 12 * S;
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
    g.strokeStyle = 'rgba(255,40,40,0.55)'; g.beginPath(); g.arc(cx, cy, R, a0 + (a1 - a0) * frac(st.redline), a1); g.stroke();
    // RPM fill.
    const f = frac(st.rpm);
    const gr = g.createLinearGradient(cx - R, cy, cx + R, cy);
    gr.addColorStop(0, '#29d3ff'); gr.addColorStop(0.65, '#ffe14a'); gr.addColorStop(1, '#ff3b3b');
    g.strokeStyle = gr; g.lineWidth = 12 * S;
    g.shadowColor = st.rpm > st.redline - 600 ? '#ff3b3b' : '#29d3ff'; g.shadowBlur = 14 * S;
    g.beginPath(); g.arc(cx, cy, R, a0, a0 + (a1 - a0) * f); g.stroke();
    g.shadowBlur = 0;
    // Ticks.
    for (let r = 0; r <= maxR; r += 1000) {
      const a = a0 + (a1 - a0) * frac(r);
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2 * S;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 18 * S), cy + Math.sin(a) * (R - 18 * S)); g.lineTo(cx + Math.cos(a) * (R - 9 * S), cy + Math.sin(a) * (R - 9 * S)); g.stroke();
      this.text(String(r / 1000), cx + Math.cos(a) * (R - 30 * S), cy + Math.sin(a) * (R - 30 * S) + 5 * S, 14 * S, '#cfd8e2', 'center', 700, false);
    }
    // Shift lights.
    const leds = 9, ledW = 13 * S;
    const startR = st.redline - 1600;
    for (let i = 0; i < leds; i++) {
      const on = st.rpm > startR + (i / leds) * 1500;
      const flash = st.rpm > st.redline - 120 && Math.floor(this.t * 16) % 2;
      const col = i < 3 ? '#3dff6e' : i < 6 ? '#ffd23a' : '#ff3b3b';
      g.fillStyle = on ? (flash ? '#5ad0ff' : col) : 'rgba(255,255,255,0.1)';
      if (on) { g.shadowColor = g.fillStyle; g.shadowBlur = 10 * S; }
      g.beginPath(); g.arc(cx - (leds - 1) / 2 * ledW + i * ledW, cy - R - 26 * S, 4.5 * S, 0, 7); g.fill();
      g.shadowBlur = 0;
    }
    // Gear and speed.
    const gear = st.gear < 0 ? 'R' : st.gear === 0 ? 'N' : String(st.gear);
    this.text(gear, cx, cy + 14 * S, 64 * S, st.shifting ? '#ffcc00' : '#fff', 'center', 900);
    this.text(String(Math.round(st.speed * 3.6)), cx + 4 * S, cy + 58 * S, 34 * S, '#fff', 'center', 800);
    this.text('KM/H', cx, cy + 76 * S, 13 * S, '#9fb3c8', 'center', 700, false);
    // Boost gauge.
    if (st.turbo) {
      const bx = cx - R * 0.55, by = cy + R * 0.95, bw = R * 1.1;
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(bx, by, bw, 5 * S);
      g.fillStyle = '#29d3ff'; g.fillRect(bx, by, bw * clamp(st.boost, 0, 1), 5 * S);
      this.text('BOOST', bx - 6 * S, by + 6 * S, 12 * S, '#9fb3c8', 'right', 700, false);
    }
  }

  // Pace notes: the current call as a big arrow with modifiers, the next one smaller.
  drawNotes(st) {
    const shown = (st.notes || []).slice().sort((a, b) => a.note.s - b.note.s).slice(0, 3);
    const g = this.g, S = this.S;
    const cx = this.w / 2, y = 30 * S;
    // The next corner is the big one in the middle; later calls queue to the right.
    shown.forEach((item, k) => {
      const ic = noteIcon(item.note);
      const age = st.noteTime - item.t;
      const appear = clamp(age / 0.2, 0, 1);
      const fade = clamp((4.5 - age) / 0.5, 0, 1);
      const scale = (k === 0 ? 1.15 : k === 1 ? 0.7 : 0.55) * (0.85 + 0.15 * appear);
      const x = cx + (k === 0 ? 0 : (150 + (k - 1) * 105) * S) + (1 - appear) * 40 * S;
      const alpha = Math.max(fade, k === 0 ? 0.85 : 0) * appear * (k === 0 ? 1 : 0.75);
      g.save();
      g.globalAlpha = alpha;
      g.translate(x, y + 58 * S * scale);
      g.scale(scale, scale);
      this.drawNoteIcon(ic, S);
      g.restore();
    });
  }

  drawNoteIcon(ic, S) {
    const g = this.g;
    const R = 46 * S;
    // Backing disc.
    const gr = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.35);
    gr.addColorStop(0, 'rgba(8,12,18,0.82)'); gr.addColorStop(1, 'rgba(8,12,18,0.0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 1.35, 0, 7); g.fill();
    let label = '';
    if (ic.corner) {
      const col = GRADE_COL[ic.corner.grade];
      const ang = GRADE_ANG[ic.corner.grade] * Math.PI / 180;
      const dir = ic.corner.dir; // +1 right
      // Draw a road arrow: straight in, then curving by `ang`.
      g.save();
      g.strokeStyle = col; g.lineWidth = 13 * S; g.shadowColor = col; g.shadowBlur = 18 * S;
      const len = R * 0.8, rad = ic.corner.grade === 'hairpin' ? R * 0.32 : R * (1.1 - ang / Math.PI * 0.6);
      g.beginPath();
      g.moveTo(0, R * 0.85); g.lineTo(0, R * 0.2);
      // Arc turning toward dir.
      const cxA = dir * rad;
      const start = dir > 0 ? Math.PI : 0;
      const end = start + dir * ang;
      g.arc(cxA, R * 0.2, rad, start, end, dir < 0);
      g.stroke();
      // Arrow head at the end.
      const ex = cxA + Math.cos(end) * rad, ey = R * 0.2 + Math.sin(end) * rad;
      const tang = end + (dir > 0 ? Math.PI / 2 : -Math.PI / 2); // direction of travel at the arc's end
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(ex + Math.cos(tang) * 16 * S, ey + Math.sin(tang) * 16 * S);
      g.lineTo(ex + Math.cos(tang + 2.3) * 14 * S, ey + Math.sin(tang + 2.3) * 14 * S);
      g.lineTo(ex + Math.cos(tang - 2.3) * 14 * S, ey + Math.sin(tang - 2.3) * 14 * S);
      g.fill();
      g.restore();
      void len;
      label = `${ic.corner.grade.toUpperCase()} ${dir > 0 ? 'RIGHT' : 'LEFT'}`;
    } else if (ic.jump || ic.crest) {
      g.strokeStyle = ic.jump ? '#ff9d2e' : '#ffe14a'; g.lineWidth = 9 * S;
      g.beginPath(); g.moveTo(-R * 0.8, R * 0.4); g.quadraticCurveTo(0, -R * (ic.jump ? 1.1 : 0.6), R * 0.8, R * 0.4); g.stroke();
      if (ic.jump) { g.fillStyle = '#ff9d2e'; g.beginPath(); g.moveTo(-6 * S, -R * 0.95); g.lineTo(6 * S, -R * 0.95); g.lineTo(0, -R * 1.2); g.fill(); }
      label = ic.jump ? 'JUMP' : 'OVER CREST';
    } else if (ic.splash) {
      g.strokeStyle = '#4fc3ff'; g.lineWidth = 6 * S;
      for (let i = 0; i < 3; i++) { g.beginPath(); for (let x = -R * 0.8; x <= R * 0.8; x += 4 * S) g.lineTo(x, i * 14 * S - 10 * S + Math.sin(x / (8 * S)) * 5 * S); g.stroke(); }
      label = 'WATER SPLASH';
    } else if (ic.dip) {
      g.strokeStyle = '#ffe14a'; g.lineWidth = 9 * S;
      g.beginPath(); g.moveTo(-R * 0.8, -R * 0.2); g.quadraticCurveTo(0, R * 0.9, R * 0.8, -R * 0.2); g.stroke();
      label = 'DIP';
    } else if (ic.narrows) {
      g.strokeStyle = '#fff'; g.lineWidth = 7 * S;
      g.beginPath(); g.moveTo(-R * 0.6, R * 0.8); g.lineTo(-R * 0.25, -R * 0.6); g.moveTo(R * 0.6, R * 0.8); g.lineTo(R * 0.25, -R * 0.6); g.stroke();
      label = 'NARROWS';
    }
    // Caution: a red triangle badge.
    if (ic.caution) {
      g.save(); g.translate(-R * 0.95, -R * 0.75);
      g.fillStyle = '#ff2a2a'; g.beginPath(); g.moveTo(0, -16 * S); g.lineTo(15 * S, 11 * S); g.lineTo(-15 * S, 11 * S); g.fill();
      this.text('!', 0, 9 * S, 20 * S, '#fff', 'center', 900, false);
      g.restore();
    }
    this.text(label, 0, R * 1.42, 22 * S, '#fff', 'center', 800);
    const chips = [];
    if (ic.long) chips.push('LONG');
    if (ic.tightens) chips.push('TIGHTENS');
    if (ic.opens) chips.push('OPENS');
    if (ic.dontcut) chips.push("DON'T CUT");
    if (ic.keepin) chips.push('KEEP IN');
    if (ic.crest && ic.corner) chips.push('OVER CREST');
    if (ic.dist) chips.push(ic.dist);
    let cy = R * 1.42 + 24 * S;
    if (chips.length) {
      const txt = chips.join('  ·  ');
      this.text(txt, 0, cy, 16 * S, '#ffd54a', 'center', 700, false);
    }
  }

  drawDamage(st) {
    const g = this.g, S = this.S;
    const x = 28 * S, y = this.h - 150 * S, w = 70 * S, h = 120 * S;
    this.panel(x - 10 * S, y - 26 * S, 210 * S, h + 40 * S, 10 * S, 0.4);
    this.text('DAMAGE', x, y - 8 * S, 14 * S, '#9fb3c8', 'left', 700, false);
    const d = st.damage;
    const col = (v) => v < 0.15 ? '#3dff6e' : v < 0.45 ? '#ffd23a' : v < 0.75 ? '#ff8a2a' : '#ff2a2a';
    g.lineWidth = 2 * S;
    // Car outline (top view).
    g.strokeStyle = col(d.body); g.strokeRect(x + 10 * S, y + 4 * S, w - 20 * S, h - 8 * S);
    g.fillStyle = col(d.engine); g.fillRect(x + 18 * S, y + 10 * S, w - 36 * S, 22 * S);
    g.fillStyle = col(d.gearbox); g.fillRect(x + 26 * S, y + 52 * S, w - 52 * S, 30 * S);
    const sus = col(d.suspension);
    g.fillStyle = sus;
    for (const [xx, yy] of [[x + 2 * S, y + 14 * S], [x + w - 10 * S, y + 14 * S], [x + 2 * S, y + h - 34 * S], [x + w - 10 * S, y + h - 34 * S]]) g.fillRect(xx, yy, 8 * S, 20 * S);
    const rows = [['ENGINE', d.engine], ['RADIATOR', d.radiator], ['GEARBOX', d.gearbox], ['SUSPENSION', d.suspension], ['STEERING', d.steering], ['BODY', d.body]];
    rows.forEach(([n, v], i) => {
      this.text(n, x + w + 6 * S, y + 12 * S + i * 18 * S, 13 * S, '#cdd8e4', 'left', 600, false);
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x + w + 84 * S, y + 4 * S + i * 18 * S, 36 * S, 7 * S);
      g.fillStyle = col(v); g.fillRect(x + w + 84 * S, y + 4 * S + i * 18 * S, 36 * S * clamp(v, 0, 1), 7 * S);
    });
  }

  drawCountdown(n) {
    const g = this.g, S = this.S;
    if (n === null) return;
    const txt = n > 0 ? String(n) : 'GO!';
    const frac = this.t % 1;
    g.save();
    g.translate(this.w / 2, this.h * 0.42);
    const sc = 1 + (1 - Math.min(1, frac * 4)) * 0.4;
    g.scale(sc, sc);
    this.text(txt, 0, 40 * S, 150 * S, n > 0 ? '#ffffff' : '#3dff6e', 'center', 900);
    g.restore();
  }

  drawMessages(dt) {
    const g = this.g, S = this.S;
    let y = Math.max(this.h * 0.42, 300 * S);
    this.msgs = this.msgs.filter((m) => (m.t += dt) < m.dur);
    for (const m of this.msgs) {
      const a = clamp(m.t / 0.15, 0, 1) * clamp((m.dur - m.t) / 0.4, 0, 1);
      const slide = (1 - clamp(m.t / 0.25, 0, 1)) * 60 * S;
      g.save(); g.globalAlpha = a;
      const sz = (m.big ? 72 : 44) * S;
      const wTxt = Math.max(320 * S, m.text.length * sz * 0.48 + 80 * S);
      this.panel(this.w / 2 - wTxt / 2 + slide, y - sz * 0.95, wTxt, sz * (m.sub ? 1.6 : 1.25), 18 * S, 0.55);
      this.text(m.text, this.w / 2 + slide, y, sz, m.col, 'center', 900);
      if (m.sub) this.text(m.sub, this.w / 2 + slide, y + sz * 0.5, sz * 0.42, '#e8eef5', 'center', 700, false);
      g.restore();
      y += sz * 1.9;
    }
  }
}
