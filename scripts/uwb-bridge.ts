import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { SerialPort } from "serialport";
import { parseConfig } from "../lib/uwb/solver.ts";
import { parseRanges } from "../lib/uwb/protocol.ts";
import { startBridge } from "./uwb/bridge.ts";
import { attachLines, parseMakerfabs } from "./uwb/input.ts";
import { startSimulator } from "./uwb/simulator.ts";

async function main() {
  const { values } = parseArgs({ options: {
    config: { type: "string", default: "config/uwb.example.json" }, simulate: { type: "boolean" },
    serial: { type: "string" }, baud: { type: "string", default: "115200" }, format: { type: "string", default: "makerfabs" },
    "list-ports": { type: "boolean" }, "ws-port": { type: "string", default: "5194" },
    "udp-port": { type: "string", default: "5195" }, "udp-host": { type: "string", default: "127.0.0.1" },
    help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("npm run uwb:bridge -- [--simulate | --serial PATH] [--format makerfabs|json] [--config FILE] [--udp-host IP] [--udp-port 5195] [--ws-port 5194] [--baud 115200] [--list-ports]");
    return;
  }
  if (values["list-ports"]) { console.table(await SerialPort.list()); return; }
  if (values.simulate && values.serial) throw new Error("가상 장비와 USB 장비는 동시에 선택할 수 없습니다.");
  if (!["makerfabs", "json"].includes(values.format)) throw new Error("format은 makerfabs 또는 json이어야 합니다.");
  const portNumber = (value: string) => {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("포트 번호 오류");
    return port;
  };
  const baudRate = Number(values.baud);
  if (!Number.isInteger(baudRate) || baudRate <= 0 || baudRate > 4_000_000) throw new Error("baud 값 오류");
  const config = parseConfig(JSON.parse(await readFile(values.config, "utf8")));
  const bridge = await startBridge(config, { wsPort: portNumber(values["ws-port"]), udpPort: portNumber(values["udp-port"]), udpHost: values["udp-host"] });
  let port: SerialPort | undefined;
  let detach: (() => void) | undefined;
  let stopSimulator: (() => void) | undefined;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    stopSimulator?.(); detach?.();
    if (port?.isOpen) await new Promise<void>((resolve) => port!.close(() => resolve()));
    await bridge.close();
  };
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
  try {
    if (values.serial) {
      port = new SerialPort({ path: values.serial, baudRate, autoOpen: false });
      port.on("error", (error) => console.error(`USB 오류: ${error.message}`));
      port.on("close", () => { if (!stopping) console.error("USB 연결이 끊겼습니다. 장비 확인 후 프로그램을 다시 실행하세요."); });
      detach = attachLines(port, (line) => {
        try {
          const packet = values.format === "makerfabs" ? parseMakerfabs(line) : parseRanges(line);
          if (packet) bridge.receive(packet, values.format === "makerfabs");
        } catch (error) { console.error(`USB 입력 무시: ${(error as Error).message}`); }
      }, console.error);
      await new Promise<void>((resolve, reject) => port!.open((error) => error ? reject(error) : resolve()));
    }
    if (values.simulate) stopSimulator = startSimulator(config, bridge.udpPort,
      values["udp-host"] === "0.0.0.0" ? "127.0.0.1" : values["udp-host"]);
    console.log(`UWB → ws://127.0.0.1:${bridge.wsPort} | UDP ${values["udp-host"]}:${bridge.udpPort}`);
    console.log(`${values.simulate ? "가상 거리 장비 10Hz" : values.serial ? `USB ${values.serial}` : "UDP 거리 수신 대기"} | 태그 ${config.tags.join(", ")} | ${config.mode === "2d" ? `높이 고정 ${config.fixedHeight}m` : "높이 UWB 계산"}`);
  } catch (error) { await stop(); throw error; }
}

main().catch((error) => { console.error((error as Error).message); process.exitCode = 1; });
