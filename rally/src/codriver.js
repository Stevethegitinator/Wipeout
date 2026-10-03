// The co-driver: reads the pace notes ahead of the car at a distance that
// scales with speed, chains close notes with "into", and comments on the run.
export class CoDriver {
  constructor(road, audio) {
    this.road = road; this.audio = audio;
    this.notes = road.notes;
    this.next = 0;
    this.shown = []; // notes on the HUD: { note, t }
    this.lastRemark = -99;
    this.time = 0;
    this.halfwayDone = false;
  }
  reset(s = 0) {
    this.next = this.notes.findIndex((n) => n.s > s - 5);
    if (this.next < 0) this.next = this.notes.length;
    this.shown = [];
  }
  remark(words, minGap = 6, priority = false) {
    if (this.time - this.lastRemark < minGap) return false;
    this.lastRemark = this.time;
    this.audio.say(words, { priority });
    return true;
  }
  update(dt, car, running) {
    this.time += dt;
    this.shown = this.shown.filter((x) => this.time - x.t < 4.5 && x.note.end > car.s - 8);
    if (!running) return;
    // Drop notes we've already driven past.
    while (this.next < this.notes.length && this.notes[this.next].end < car.s - 2) this.next++;
    if (this.next >= this.notes.length) return;
    const busy = this.audio.voiceBusyFor();
    const v = Math.max(car.speed, 8);
    const ahead = Math.min(190, Math.max(55, v * 3.4 + 20));
    const n = this.notes[this.next];
    if (n.s - car.s > ahead) return;
    // Don't let the queue run more than a note behind.
    if (busy > 0.35) return;
    let words = n.words.slice();
    const called = [n];
    this.next++;
    // Chain notes that come close together: "hard right into easy left".
    let k = n;
    while (k.into && this.next < this.notes.length && called.length < 3) {
      const nx = this.notes[this.next];
      words = words.filter((w) => !w.startsWith('d'));
      words.push('into', ...nx.words);
      called.push(nx);
      this.next++;
      k = nx;
    }
    // Faster delivery when the car is quick.
    const rate = v > 30 ? 1.08 : 1;
    this.audio.say(words, { rate });
    for (const c of called) this.shown.push({ note: c, t: this.time });
  }
  halfway(car) {
    if (!this.halfwayDone && car.s > this.road.finish / 2) { this.halfwayDone = true; return true; }
    return false;
  }
}

// Icon descriptions for the HUD (derived from note words).
export function noteIcon(note) {
  const w = note.words;
  const corner = note.grade ? { grade: note.grade, dir: note.dir } : null;
  return {
    corner,
    caution: w.includes('caution'),
    crest: w.includes('over_crest'),
    jump: w.includes('jump') || w.includes('big_jump'),
    splash: w.includes('water_splash'),
    dontcut: w.includes('dont_cut'),
    keepin: w.includes('keep_in'),
    narrows: w.includes('narrows'),
    dip: w.includes('dip'),
    long: w.includes('long') || w.includes('very_long'),
    tightens: w.includes('tightens'), opens: w.includes('opens'),
    dist: (w.find((x) => /^d\d+$/.test(x)) || '').slice(1),
  };
}
