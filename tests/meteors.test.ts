import test from "node:test";
import assert from "node:assert/strict";
import { createMeteorShower, meteorRandom } from "../lib/meteors.ts";

test("each passage draws one to three streaks and ends when the last one lands", () => {
  const random = meteorRandom(27);
  const counts = new Set<number>();
  for (let i = 0; i < 180; i++) {
    const time = i * 150, heading = i / 10;
    const shower = createMeteorShower(time, heading, -.45, random);
    counts.add(shower.streaks.length);
    assert.equal(shower.startedAt, time);
    assert.equal(shower.streaks[0].start, 0);
    assert.ok(shower.streaks.every(s => s.start >= 0 && s.duration > 0 && Math.abs(s.azimuth - heading) < .4));
    assert.equal(shower.endsAt, time + 1000 * Math.max(...shower.streaks.map(s => s.start + s.duration)));
  }
  assert.deepEqual([...counts].sort(), [1, 2, 3]);
});
