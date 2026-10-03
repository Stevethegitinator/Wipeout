// Headless test: the AI driver runs every stage in every car. Checks the stage
// geometry, physics and driver together, and reports times and incidents.
//   node rally/tools/simtest.js [stageIndex] [carIndex]
import { Road } from '../src/road.js';
import { STAGES, CARS } from '../src/stages.js';
import { Car } from '../src/car.js';
import { Driver } from '../src/ai.js';
import { buildLayout } from '../src/layout.js';

const [si, ci] = process.argv.slice(2).map(Number);
const stages = Number.isFinite(si) ? [STAGES[si]] : STAGES;
const cars = Number.isFinite(ci) ? [CARS[ci]] : CARS;
let failed = 0;
for (const st of stages) {
  const road = new Road(st);
  buildLayout(road, 1);
  for (const spec of cars) {
    const car = new Car(spec, road, { assist: +(process.env.ASSIST ?? 1) });
    car.place(road.start - 8);
    const ai = new Driver(car);
    const dt = 1 / 60;
    let t = 0, resets = 0, offroad = 0, maxSlip = 0, impacts = 0, air = 0, vmax = 0, stuck = 0, sumSlip = 0, n = 0, lastProg = 0, lastProgT = 0;
    while (t < 600 && car.s < road.finish) {
      const inp = ai.update(dt);
      car.update(inp, dt);
      t += dt;
      for (const e of car.drainEvents()) if (e.type === 'impact') impacts++;
      if (!car.onGround) air += dt;
      vmax = Math.max(vmax, car.speed);
      if (car.roadDist > 1) offroad += dt;
      if (car.speed > 10) { maxSlip = Math.max(maxSlip, Math.abs(car.slipAngle)); sumSlip += Math.abs(car.slipAngle); n++; }
      if (car.s > lastProg + 5) { lastProg = car.s; lastProgT = t; }
      const lost = car.roadDist > 25 || car.upsideTime > 2 || t - lastProgT > 6 || !isFinite(car.pos.x);
      if (lost && process.env.V) console.log('   reset at', car.s.toFixed(0), 'dist', car.roadDist.toFixed(1), 'up', car.upsideTime.toFixed(1), 'stall', (t - lastProgT).toFixed(1), 'v', car.speed.toFixed(1), road.notes.filter((n) => Math.abs(n.s - car.s) < 60).map((n) => n.words.join(' ')).join(' | '));
      if (lost) { resets++; car.place(Math.max(road.start, lastProg - 10)); lastProgT = t; if (resets > 30) break; }
    }
    // Snow banks and muddy ditches catch even the AI now and then.
    const ok = car.s >= road.finish && resets <= (st.wet || st.surface === 'snow' ? 6 : 3);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${st.id.padEnd(8)} ${spec.id.padEnd(7)} time ${t.toFixed(1).padStart(6)}s avg ${(road.finish / t * 3.6).toFixed(0).padStart(3)}km/h max ${(vmax * 3.6).toFixed(0)} resets ${resets} offroad ${offroad.toFixed(1)}s impacts ${impacts} air ${air.toFixed(1)}s slip avg ${(sumSlip / Math.max(1, n) * 57.3).toFixed(1)}° max ${(maxSlip * 57.3).toFixed(0)}° dmg ${car.damage.body.toFixed(2)}`);
  }
}
process.exit(failed ? 1 : 0);
