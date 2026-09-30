// 2D overlay: race HUD and menu drawing helpers, rendered at low resolution
// and scaled up with nearest-neighbour filtering.
import { WEAPONS, TEAMS } from './data.js';

export const FONT = '"Arial Black", "Arial Bold", Arial, sans-serif';

export function fmtTime(t) {
  if (!isFinite(t)) return '-:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export function text(ctx, str, x, y, size, color = '#fff', align = 'left', italic = true, shadow = true) {
  ctx.font = `${italic ? 'italic ' : ''}900 ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillText(str, x + Math.max(1, size / 12), y + Math.max(1, size / 12));
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

export function panel(ctx, x, y, w, h, alpha = 0.6, edge = null) {
  ctx.fillStyle = `rgba(4,8,20,${alpha})`;
  ctx.beginPath();
  ctx.moveTo(x + 8, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - 8, y + h); ctx.lineTo(x, y + h); ctx.closePath();
  ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); }
}

function weaponIcon(ctx, id, x, y, s) {
  const c = WEAPONS[id].color;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 2;
  switch (id) {
    case 'rockets':
      for (const o of [-0.25, 0, 0.25]) ctx.fillRect(o * s - s * 0.06, -s * 0.3, s * 0.12, s * 0.6);
      break;
    case 'missile':
      ctx.beginPath(); ctx.moveTo(0, -s * 0.35); ctx.lineTo(s * 0.12, s * 0.25); ctx.lineTo(-s * 0.12, s * 0.25); ctx.fill();
      break;
    case 'mines':
      for (const [a, b] of [[-0.2, -0.15], [0.2, -0.15], [0, 0.2]]) { ctx.beginPath(); ctx.arc(a * s, b * s, s * 0.12, 0, 7); ctx.fill(); }
      break;
    case 'shock':
      for (const r of [0.12, 0.24, 0.36]) { ctx.beginPath(); ctx.arc(0, 0, r * s, 0, 7); ctx.stroke(); }
      break;
    case 'bolt':
      ctx.beginPath(); ctx.moveTo(s * 0.1, -s * 0.35); ctx.lineTo(-s * 0.15, s * 0.02); ctx.lineTo(s * 0.05, s * 0.02);
      ctx.lineTo(-s * 0.1, s * 0.35); ctx.lineTo(s * 0.18, -s * 0.06); ctx.lineTo(-s * 0.02, -s * 0.06); ctx.fill();
      break;
    case 'shield':
      ctx.beginPath(); ctx.moveTo(0, -s * 0.35); ctx.lineTo(s * 0.28, -s * 0.2); ctx.lineTo(s * 0.2, s * 0.15); ctx.lineTo(0, s * 0.35);
      ctx.lineTo(-s * 0.2, s * 0.15); ctx.lineTo(-s * 0.28, -s * 0.2); ctx.closePath(); ctx.stroke();
      break;
    case 'turbo':
      for (const o of [-0.18, 0.05]) { ctx.beginPath(); ctx.moveTo(o * s, -s * 0.25); ctx.lineTo(o * s + s * 0.2, 0); ctx.lineTo(o * s, s * 0.25); ctx.stroke(); }
      break;
  }
  ctx.restore();
}

// Cached minimap outline per track.
const mapCache = new WeakMap();
function minimap(ctx, race, x, y, size) {
  const tr = race.track;
  let m = mapCache.get(tr);
  if (!m) {
    const b = tr.bounds;
    const span = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    m = { b, span };
    mapCache.set(tr, m);
  }
  const px = (p) => x + ((p.x - m.b.min.x) / m.span) * size;
  const pz = (p) => y + ((p.z - m.b.min.z) / m.span) * size;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i <= tr.N; i += 6) { const p = tr.P[i % tr.N]; i ? ctx.lineTo(px(p), pz(p)) : ctx.moveTo(px(p), pz(p)); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
  for (const s of race.ships) {
    if (s === race.player) continue;
    ctx.fillStyle = '#' + s.team.primary.toString(16).padStart(6, '0');
    ctx.fillRect(px(s.pos) - 2, pz(s.pos) - 2, 4, 4);
  }
  if (race.player) {
    ctx.fillStyle = '#ffff40';
    ctx.fillRect(px(race.player.pos) - 3, pz(race.player.pos) - 3, 6, 6);
  }
}

export function drawRaceHUD(ctx, race, W, H, blink) {
  const s = race.player;
  if (!s) return;
  const U = H / 240; // unit scale

  // Lap
  panel(ctx, 6 * U, 6 * U, 78 * U, 30 * U);
  text(ctx, 'LAP', 12 * U, 16 * U, 7 * U, '#9ad0ff');
  const lapShown = Math.max(1, Math.min(race.laps, s.lap + 1));
  text(ctx, `${lapShown}`, 14 * U, 33 * U, 18 * U, '#fff');
  text(ctx, `/${race.laps}`, 32 * U, 33 * U, 10 * U, '#fff');

  // Lap times
  let ly = 48 * U;
  s.lapTimes.forEach((t, i) => {
    const best = t === s.bestLap;
    text(ctx, `${i + 1} ${fmtTime(t)}`, 10 * U, ly, 7 * U, best ? '#60ff90' : '#ddd');
    ly += 9 * U;
  });

  // Position
  if (race.mode !== 'time') {
    panel(ctx, W - 84 * U, 6 * U, 78 * U, 30 * U);
    text(ctx, 'POS', W - 76 * U, 16 * U, 7 * U, '#9ad0ff');
    text(ctx, `${s.place}`, W - 56 * U, 33 * U, 18 * U, s.place <= 3 ? '#ffd040' : '#fff', 'right');
    text(ctx, `/${race.ships.length}`, W - 54 * U, 33 * U, 10 * U, '#fff');
  }

  // Race time
  const cur = s.finished ? s.finishTime : race.time;
  text(ctx, fmtTime(cur), W / 2, 18 * U, 11 * U, '#fff', 'center');
  if (!s.finished && s.lap >= 0) text(ctx, fmtTime(race.time - s.lapStart), W / 2, 28 * U, 7 * U, '#9ad0ff', 'center');

  // Weapon
  if (race.mode !== 'time') {
    const bx = W / 2 - 14 * U, by = 34 * U, bs = 28 * U;
    ctx.fillStyle = 'rgba(4,8,20,0.6)'; ctx.fillRect(bx, by, bs, bs);
    ctx.strokeStyle = s.weapon ? WEAPONS[s.weapon].color : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1);
    if (s.weapon) weaponIcon(ctx, s.weapon, W / 2, by + bs / 2, bs);
  }

  // Speed bar
  const segs = 24, sw = 5 * U, sh = 12 * U, sx = W - (segs * (sw + U)) - 10 * U, sy = H - 22 * U;
  panel(ctx, sx - 8 * U, sy - 16 * U, segs * (sw + U) + 16 * U, 34 * U);
  const frac = Math.min(1, s.speed / (s.topSpeed * 1.25));
  for (let i = 0; i < segs; i++) {
    const on = i / segs < frac;
    const hue = 120 - (i / segs) * 120;
    ctx.fillStyle = on ? `hsl(${hue},100%,55%)` : 'rgba(255,255,255,0.12)';
    const hh = sh * (0.4 + 0.6 * i / segs);
    ctx.fillRect(sx + i * (sw + U), sy + sh - hh, sw, hh);
  }
  text(ctx, `${Math.round(s.speed * 3.6)}`, sx, sy - 4 * U, 10 * U, '#fff');
  text(ctx, 'KM/H', sx + 30 * U, sy - 4 * U, 6 * U, '#9ad0ff');
  if (s.boostTime > 0) text(ctx, 'BOOST', sx + segs * (sw + U), sy - 4 * U, 7 * U, '#20e0ff', 'right');

  // Minimap
  minimap(ctx, race, 8 * U, H - 72 * U, 64 * U);

  // Countdown
  if (race.state === 'countdown') {
    const n = Math.ceil(race.countdown);
    if (n <= 3 && n >= 1) {
      const f = race.countdown - Math.floor(race.countdown);
      text(ctx, `${n}`, W / 2, H / 2 + 10 * U, (30 + f * 20) * U, n === 1 ? '#40ff80' : '#ffd040', 'center');
    }
  }

  // Messages
  let my = H * 0.36;
  for (const m of race.messages.slice(-3)) {
    text(ctx, m.text, W / 2, my, 13 * U, m.color, 'center');
    my += 16 * U;
  }
  if (s.wrongWay > 60 && blink) text(ctx, 'WRONG WAY', W / 2, H * 0.62, 16 * U, '#ff3030', 'center');
  if (s.stunTime > 0 && blink) text(ctx, 'SYSTEMS DISRUPTED', W / 2, H * 0.7, 8 * U, '#b09aff', 'center');
}

export function drawStatBar(ctx, x, y, w, h, v, color) {
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y, w, h);
  const n = 10;
  for (let i = 0; i < n; i++) {
    if (i / n < v) { ctx.fillStyle = color; ctx.fillRect(x + i * (w / n) + 1, y + 1, w / n - 2, h - 2); }
  }
}

export function teamColor(i) { return '#' + TEAMS[i].primary.toString(16).padStart(6, '0'); }
