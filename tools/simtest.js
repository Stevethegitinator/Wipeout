// Headless check: AI-driven ships of every team complete laps on every circuit.
import { TRACKS, TEAMS } from '../src/data.js';
import { TrackData } from '../src/trackdata.js';
import { Ship } from '../src/ship.js';
import { AIPilot } from '../src/ai.js';

const cls = Number(process.argv[2] ?? 1);
let failed = false;
for (const def of TRACKS) {
  const tr = new TrackData(def);
  // Sanity: non-adjacent sections must not overlap.
  let minGap = Infinity;
  for (let i = 0; i < tr.N; i += 2) for (let j = i + 40; j < tr.N - 40 + i; j += 2) {
    const jj = tr.wrap(j);
    const d = tr.P[i].distanceTo(tr.P[jj]);
    if (Math.abs(tr.P[i].y - tr.P[jj].y) < 12) minGap = Math.min(minGap, d);
  }
  const rows = [];
  for (const team of TEAMS) {
    const s = new Ship(tr, team, 0, cls);
    const ai = new AIPilot(s, 1, () => 0.5);
    s.placeAt(tr.N - 4, 0);
    const dt = 1 / 120;
    let t = 0, walls = 0, maxSpd = 0;
    while (s.lap < 3 && t < 400) {
      ai.update(dt, [s], t);
      s.update(dt, t, true);
      for (const e of s.events) if (e.type === 'wall' && e.power > 0.05) walls++;
      s.events.length = 0;
      maxSpd = Math.max(maxSpd, s.speed);
      t += dt;
    }
    const ok = s.lap >= 3;
    if (!ok) failed = true;
    rows.push(`${team.id.padEnd(8)} ${ok ? 'OK ' : 'DNF'} laps=${s.lapTimes.map((x) => x.toFixed(1)).join('/')} walls=${walls} vmax=${maxSpd.toFixed(0)}${ok ? '' : ' stuck@' + s.section}`);
  }
  console.log(`${def.name} len=${tr.length.toFixed(0)} N=${tr.N} minGap=${minGap.toFixed(0)}`);
  rows.forEach((r) => console.log('  ' + r));
}
process.exit(failed ? 1 : 0);
