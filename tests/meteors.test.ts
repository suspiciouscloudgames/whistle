import test from "node:test";
import assert from "node:assert/strict";
import { advanceMeteors, createMeteorTimeline, meteorElapsed, METEOR_COOLDOWN, METEOR_DURATION } from "../lib/meteors.ts";
import { addMeetingMember, createMeetingRoom, disconnectMeetingMember, meetingPresence, reconcileMeeting, setMeetingNightSky } from "../lib/meeting.ts";

test("a clear night waits 1–3 minutes, runs briefly, and rests at least seven minutes", () => {
  for (let seed = 0; seed < 128; seed++) {
    const timeline = createMeteorTimeline(seed);
    advanceMeteors(timeline, false, 1000);
    assert.equal(timeline.startsAt, null);
    advanceMeteors(timeline, true, 1000);
    const start = timeline.startsAt!;
    assert.ok(start >= 61_000 && start <= 181_000);
    assert.equal(meteorElapsed(timeline, start - 1), null);
    assert.equal(meteorElapsed(timeline, start), 0);
    assert.equal(advanceMeteors(timeline, true, start + 1000), false);
    assert.equal(meteorElapsed(timeline, start + METEOR_DURATION), null);
    advanceMeteors(timeline, true, start + METEOR_DURATION);
    assert.ok(timeline.startsAt! >= start + METEOR_DURATION + METEOR_COOLDOWN);
  }
});

test("leaving the night stops the shower and returning cannot bypass its rest", () => {
  const timeline = createMeteorTimeline(99);
  advanceMeteors(timeline, true, 1000);
  const interrupted = timeline.startsAt! + 2000;
  advanceMeteors(timeline, false, interrupted);
  assert.equal(timeline.startsAt, null);
  assert.equal(timeline.cooldownUntil, interrupted + METEOR_COOLDOWN);
  advanceMeteors(timeline, true, interrupted + 1);
  assert.ok(timeline.startsAt! >= interrupted + METEOR_COOLDOWN + 60_000);
  advanceMeteors(timeline, false, interrupted + 2);
  advanceMeteors(timeline, true, interrupted + 3);
  assert.ok(timeline.startsAt! >= interrupted + METEOR_COOLDOWN + 60_000);
});

test("connected players share one sky schedule and a late arrival does not restart it", () => {
  const room = createMeetingRoom(17);
  addMeetingMember(room, "a", 1000); addMeetingMember(room, "b", 1000);
  setMeetingNightSky(room, "a", true, 1000);
  const start = room.meteors.startsAt!;
  setMeetingNightSky(room, "b", true, start + 2000);
  assert.equal(room.meteors.startsAt, start);
  assert.deepEqual(meetingPresence(room, "a").meteors?.timeline, meetingPresence(room, "b").meteors?.timeline);
  disconnectMeetingMember(room, "a", start + 3000);
  assert.equal(room.meteors.startsAt, start);
  setMeetingNightSky(room, "b", false, start + 4000);
  assert.equal(room.meteors.startsAt, null);
  setMeetingNightSky(room, "b", true, start + 5000);
  const next = room.meteors.startsAt!;
  assert.ok(next >= start + 4000 + METEOR_COOLDOWN);
  reconcileMeeting(room, next + METEOR_DURATION);
  assert.ok(room.meteors.startsAt! >= next + METEOR_DURATION + METEOR_COOLDOWN);
});
