import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { createSocket } from "node:dgram";
import { SerialPortMock } from "serialport";
import { WebSocket } from "ws";
import { parseRanges, parseBridgeMessage, type BridgeMessage, type Point, type RangePacket } from "../lib/uwb/protocol.ts";
import { parseConfig, solvePosition, distanceTo } from "../lib/uwb/solver.ts";
import { createProcessor, startBridge } from "../scripts/uwb/bridge.ts";
import { parseMakerfabs, attachLines } from "../scripts/uwb/input.ts";
import { startSimulator } from "../scripts/uwb/simulator.ts";

const config = parseConfig(JSON.parse(await readFile(new URL("../config/uwb.example.json", import.meta.url), "utf8")));
const point = { x: 1, z: 3, boardHeight: 1.2 };
const packet = (p: Point = point, seq = 1, tagId = "0"): RangePacket => ({ type: "ranges", tagId, seq,
  ranges: config.anchors.map((a) => ({ anchorId: a.id, distance: distanceTo(p, a) })),
});
const near = (actual: number, expected: number, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test("2D solver accounts for anchor elevation with only three ranges", () => {
  const result = solvePosition(packet().ranges.slice(0, 3), config);
  near(result.x, 1); near(result.z, 3); near(result.boardHeight, 1.2); near(result.residual, 0);
});

test("3D solver recovers physical height separately from horizontal position", () => {
  const result = solvePosition(packet({ ...point, boardHeight: 2.1 }).ranges, { ...config, mode: "3d" });
  near(result.x, 1); near(result.z, 3); near(result.boardHeight, 2.1);
});

test("centimetre-rounded noisy distances remain close to their source", () => {
  const ranges = packet().ranges.map((r, i) => ({ ...r, distance: Math.round(r.distance * 100) / 100 + (i % 2 ? 0.02 : -0.02) }));
  const result = solvePosition(ranges, config);
  near(result.x, 1, 0.06); near(result.z, 3, 0.06);
  assert.ok(result.residual < 0.05);
});

test("missing, impossible, duplicate and inconsistent ranges are rejected", () => {
  assert.throws(() => solvePosition(packet().ranges.slice(0, 2), config), /앵커/);
  assert.throws(() => solvePosition(packet().ranges.map((r) => ({ ...r, distance: 0.1 })), config));
  assert.throws(() => solvePosition([...packet().ranges, packet().ranges[0]], config));
  assert.throws(() => solvePosition(packet().ranges.map((r, i) => ({ ...r, distance: r.distance + (i === 0 ? 6 : 0) })), config));
  assert.throws(() => solvePosition(packet().ranges.map((r) => ({ ...r, distance: NaN })), config));
});

test("collinear 2D and coplanar 3D configurations are rejected before starting", () => {
  assert.throws(() => parseConfig({ ...config, anchors: config.anchors.map((a, i) => ({ ...a, x: i, z: 0 })) }), /배치/);
  assert.throws(() => parseConfig({ ...config, mode: "3d", anchors: config.anchors.map((a) => ({ ...a, boardHeight: 2 })) }), /배치/);
  assert.throws(() => parseConfig({ ...config, tags: ["0", "0"] }));
  assert.throws(() => parseConfig({ ...config, smoothingMs: -1 }));
  assert.throws(() => parseConfig({ ...config, fixedHeight: 11 }));
});

test("canonical packets validate metre ranges, IDs, sequences and size", () => {
  assert.deepEqual(parseRanges(JSON.stringify(packet())), packet());
  for (const value of [{ ...packet(), seq: -1 }, { ...packet(), seq: 1.1 }, { ...packet(), tagId: {} },
    { ...packet(), ranges: [{ anchorId: "0", distance: "2" }] },
    { ...packet(), ranges: [{ anchorId: "0", distance: 501 }] }]) assert.throws(() => parseRanges(JSON.stringify(value)));
  assert.throws(() => parseRanges(" ".repeat(5000)));
});

test("Makerfabs old and new reports respect masks, centimetres and dynamic anchor IDs", () => {
  const old = parseMakerfabs("AT+RANGE=tid:0,mask:05,seq:255,range:(150,999,350,0,0,0,0,0),rssi:(-70,-80,-80,0,0,0,0,0)")!;
  assert.deepEqual(old.ranges, [{ anchorId: "0", distance: 1.5 }, { anchorId: "2", distance: 3.5 }]);
  const newer = parseMakerfabs("AT+RANGE=tid:1,mask:03,seq:0,range:(150,200,0,0,0,0,0,0),ancid:(3,2,-1,-1,-1,-1,-1,-1)")!;
  assert.deepEqual(newer.ranges, [{ anchorId: "3", distance: 1.5 }, { anchorId: "2", distance: 2 }]);
  assert.equal(parseMakerfabs("OK"), null);
  assert.throws(() => parseMakerfabs("AT+RANGE=broken"));
  assert.throws(() => parseMakerfabs("AT+RANGE=tid:0,mask:01,seq:1,range:(0,0,0,0,0,0,0,0)"));
});

test("tags have independent filters; old/duplicate packets and unknown tags do not refresh tracking", () => {
  const output: BridgeMessage[] = [];
  const receive = createProcessor(config, (message) => output.push(message));
  receive(packet(point, 2), false, 1000);
  receive(packet({ ...point, x: 4 }, 1), false, 1100);
  receive(packet(point, 2), false, 1150);
  receive(packet(point, 3, "unknown"), false, 1200);
  assert.equal(output.length, 1);
  receive(packet({ ...point, x: 4 }, 1, "1"), false, 1200);
  assert.equal(output[1].type, "position");
  near((output[1] as Point).x, 4);
  receive(packet({ ...point, x: 4 }, 3), false, 1250);
  assert.ok((output[2] as Point).x > 1 && (output[2] as Point).x < 4);
  receive(packet({ ...point, x: 2 }, 0), false, 2500);
  near((output[3] as Point).x, 2);
});

test("ordered serial counters can wrap; invalid frames stop tracking and reset smoothing", () => {
  const output: BridgeMessage[] = [];
  const receive = createProcessor(config, (message) => output.push(message));
  receive(packet(point, 255), true, 1000);
  receive({ ...packet(point, 0), ranges: [] }, true, 1100);
  assert.equal(output[1].type, "invalid");
  receive(packet({ ...point, x: 4 }, 1), true, 1200);
  near((output[2] as Point).x, 4);
});

test("continuous duplicate traffic cannot revive a stale position after the timeout", () => {
  const output: BridgeMessage[] = [];
  const receive = createProcessor(config, (message) => output.push(message));
  receive(packet(point, 10), false, 1000);
  for (let now = 1100; now < 5000; now += 100) receive(packet(point, 10), false, now);
  assert.equal(output.length, 1);
  receive(packet({ ...point, x: 4 }, 11), false, 5000);
  near((output[1] as Point).x, 4);
});

test("bridge output parser rejects bad height and malformed coordinates", () => {
  const messages: BridgeMessage[] = [];
  createProcessor(config, (message) => messages.push(message))(packet());
  assert.deepEqual(parseBridgeMessage(JSON.stringify(messages[0])), messages[0]);
  assert.throws(() => parseBridgeMessage(JSON.stringify({ ...messages[0], boardHeight: 11 })));
  assert.throws(() => parseBridgeMessage(JSON.stringify({ ...messages[0], x: "1" })));
});

test("USB stream framing handles split reports, CRLF, startup logs and oversized lines", async (t) => {
  const path = "/dev/whistle-uwb-mock";
  SerialPortMock.binding.createPort(path);
  const serial = new SerialPortMock({ path, baudRate: 115200 });
  await once(serial, "open");
  t.after(() => { serial.close(); });
  const packets: RangePacket[] = [], errors: string[] = [];
  const detach = attachLines(serial, (line) => { const p = parseMakerfabs(line); if (p) packets.push(p); }, (e) => errors.push(e));
  t.after(detach);
  const report = "AT+RANGE=tid:0,mask:07,seq:1,range:(150,200,350,0,0,0,0,0)\r\n";
  serial.port!.emitData("boot\r\n" + report.slice(0, 24));
  serial.port!.emitData(report.slice(24) + "x".repeat(5000) + "\n" + report.replace("seq:1", "seq:2"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(packets.map((p) => p.seq), [1, 2]);
  assert.equal(errors.length, 1);
});

test("real UDP → solver → WebSocket accepts new data without replaying cached positions", async (t) => {
  const bridge = await startBridge({ ...config, smoothingMs: 0 }, { wsPort: 0, udpPort: 0, log: () => {} });
  t.after(() => bridge.close());
  const socket = createSocket("udp4");
  t.after(() => socket.close());
  const client = new WebSocket(`ws://127.0.0.1:${bridge.wsPort}`);
  t.after(() => client.terminate());
  await once(client, "open");
  const response = once(client, "message", { signal: AbortSignal.timeout(3000) });
  socket.send("broken", bridge.udpPort, "127.0.0.1");
  socket.send(JSON.stringify(packet()), bridge.udpPort, "127.0.0.1");
  const result = parseBridgeMessage((await response)[0].toString());
  assert.equal(result.type, "position");
  near((result as Point).x, point.x); near((result as Point).boardHeight, 1.2);
  const late = new WebSocket(`ws://127.0.0.1:${bridge.wsPort}`);
  t.after(() => late.terminate());
  let replayed = false;
  late.on("message", () => { replayed = true; });
  await once(late, "open");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(replayed, false);
});

test("hardware-free simulator sends distances through UDP for all four tags and 3D height", async (t) => {
  const spatial = parseConfig({ ...config, mode: "3d" });
  const bridge = await startBridge(spatial, { wsPort: 0, udpPort: 0 });
  t.after(() => bridge.close());
  const client = new WebSocket(`ws://127.0.0.1:${bridge.wsPort}`);
  t.after(() => client.terminate());
  await once(client, "open");
  const tags = new Set<string>();
  const complete = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("simulator timeout")), 3000);
    t.after(() => clearTimeout(timer));
    client.on("message", (data) => {
      const p = parseBridgeMessage(data.toString());
      assert.equal(p.type, "position");
      if (p.type !== "position") return;
      assert.equal(p.heightSource, "uwb");
      assert.ok(p.boardHeight > 0.6 && p.boardHeight < 1.8);
      tags.add(p.tagId);
      if (tags.size === 4) resolve();
    });
  });
  t.after(startSimulator(spatial, bridge.udpPort));
  await complete;
});
