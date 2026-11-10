"use client";
import { useLanguage } from "./Language";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import type { Asset, World, Simulation, Player } from "@/lib/world";
import { softenEdges } from "./Atmosphere";
import { makeTerrain } from "./TerrainScene";
import { deriveStructures, floorHeight, tileAt, terrainSample, SURFACES } from "@/lib/terrain";
import { environmentAt } from "@/lib/environment";
import { makeWeather } from "./WeatherScene";
import { WEATHER } from "@/lib/weather";
import { daylightAt } from "@/lib/daylight";
import {
  roughGroundMotion,
  playerEyeHeight,
  launchJump,
  resolveJump,
  JUMP_BUFFER_SECONDS,
  COYOTE_SECONDS,
  blocksAirStep,
  jumpFrame,
  movementProfile,
  followHeading,
  movementKey,
  fallFrame,
  blocksGroundStep,
} from "@/lib/navigation";
import {
  feedbackRegions,
  type PlacementFeedback,
} from "@/lib/placement-feedback";
const EYE_HEIGHT = 1.35;
type Props = {
  world: World;
  simulation: Simulation;
  mode: "overview" | "play";
  onPlayer?: (p: Player) => void;
  onControlsReset?: () => void;
  controls?: MutableRefObject<Set<string>>;
  className?: string;
  feedback?: PlacementFeedback | null;
  clock?: () => Date;
};
const deviceTime = () => new Date();
function material(color: string) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0,
  });
}
function mesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  parent: THREE.Group,
  x = 0,
  y = 0,
  z = 0,
) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function makeObject(asset: Asset): THREE.Group {
  const g = new THREE.Group();
  // The symbol identifies an asset in the editor; only its media enters 3D.
  if (!asset.image) return g;
  const texture = new THREE.TextureLoader().load(asset.image);
  texture.colorSpace = THREE.SRGBColorSpace;
  const picture = mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    g,
    0,
    0.8,
  );
  picture.castShadow = false;
  const mark = mesh(
    new THREE.TorusGeometry(0.72, 0.025, 6, 32),
    material("#111111"),
    g,
    0,
    0.035,
  );
  mark.rotation.x = -Math.PI / 2;
  mark.name = "mark";
  mark.visible = false;
  return g;
}
function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.userData.dispose?.();
    if (m instanceof THREE.InstancedMesh) m.dispose();
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      const materials = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of materials) {
        const standard = mat as THREE.MeshStandardMaterial;
        standard.map?.dispose();
        standard.bumpMap?.dispose();
        mat.dispose();
      }
    }
  });
}
export default function Scene({
  world,
  simulation,
  mode,
  onPlayer,
  onControlsReset,
  controls,
  className = "",
  feedback = null,
  clock = deviceTime,
}: Props) {
  const { t } = useLanguage();
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const resetControls = useRef(onControlsReset);
  resetControls.current = onControlsReset;
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const host = useRef<HTMLDivElement>(null),
    fallVeil = useRef<HTMLDivElement>(null),
    actors = useRef(simulation.actors),
    callback = useRef(onPlayer),
    models = useRef(new Map<string, THREE.Group>()),
    worldRef = useRef(world),
    [failed, setFailed] = useState(false);
  actors.current = simulation.actors;
  callback.current = onPlayer;
  worldRef.current = world;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "low-power",
      });
    } catch {
      setFailed(true);
      return;
    }
    const scene = new THREE.Scene();
    const weatherScene = makeWeather(world.size);
    scene.add(weatherScene.group);
    const weatherSky = new THREE.Color();
    let targetDay = daylightAt(clockRef.current());
    const currentDay = { ...targetDay };
    let lastClockSample = -Infinity;
    const white = new THREE.Color("#ffffff");
    const nightSky = new THREE.Color("#11151c");
    const nightMist = new THREE.Color("#525c6b");
    const sky = new THREE.Color()
      .copy(nightSky)
      .lerp(white, currentDay.daylight);
    const mistColor = new THREE.Color();
    scene.background = sky;
    const baseFog = mode === "play" ? 0.055 : 0.018;
    const atmosphere = new THREE.FogExp2(sky, baseFog * currentDay.fog);
    scene.fog = atmosphere;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor("#ffffff");
    el.appendChild(renderer.domElement);
    const ambient = new THREE.HemisphereLight(
      "#ffffff",
      "#ffffff",
      currentDay.ambient,
    );
    scene.add(ambient);
    const sun = new THREE.DirectionalLight("#ffffff", currentDay.sun);
    sun.name = "whistle-sun";
    sun.position.set(currentDay.sunX, currentDay.sunY, currentDay.sunZ);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    const moon = new THREE.DirectionalLight("#dbe4f3", currentDay.moon);
    moon.name = "whistle-moon";
    moon.position.set(10, 16, -10);
    scene.add(moon);
    // An uninterrupted ground horizon, not a board of tile-sized pedestals.
    const horizon = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      material("#ffffff"),
    );
    horizon.rotation.x = -Math.PI / 2;
    horizon.position.y = -18.01;
    horizon.receiveShadow = true;
    softenEdges(horizon, world.size);
    scene.add(horizon);
    let structures = deriveStructures(world, actors.current);
    let terrain = makeTerrain(world, structures);
    softenEdges(terrain.group, world.size);
    scene.add(terrain.group);
    let terrainSignature = "";
    const camera =
      mode === "play"
        ? new THREE.PerspectiveCamera(66, 1, 0.08, 80)
        : new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 100);
    if (mode === "overview") {
      camera.position.set(20, 24, 25);
      camera.lookAt(0, 0, 0);
    }
    const toScene = (n: number) => n * 2 - world.size + 1;
    const pulses = new THREE.Group();
    scene.add(pulses);
    let pulseId = 0,
      pulseStart = 0;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const clearPulses = () => {
      disposeGroup(pulses);
      pulses.clear();
    };
    const player: Player = { ...world.start, yaw: 0 };
    let falling: { originY: number; elapsed: number } | null = null;
    let jump: ReturnType<typeof launchJump> | null = null;
    let jumpBuffer = 0;
    let groundAge = 0;
    let lastGround = floorHeight(world, player.x, player.z, structures) ?? 0;
    let respawnFade = 0;
    let walkedDistance = 0, groundBob = 0, groundRoll = 0;
    let pitch = -0.12,
      targetPitch = pitch,
      targetYaw = player.yaw,
      stepRemaining = 0,
      eyeY = playerEyeHeight(
        floorHeight(world, world.start.x, world.start.z, structures) ?? 0,
        environmentAt(terrain.environment, world.start.x, world.start.z).water,
        EYE_HEIGHT,
      ),
      velocity = 0,
      frame = 0,
      last = performance.now(),
      report = 0,
      drag = false,
      lastX = 0,
      lastY = 0;
    const keys = new Set<string>();
    models.current = new Map();
    let previousActors: typeof actors.current | undefined,
      previousAssets: typeof world.assets | undefined,
      previousTerrain: typeof world.terrain;
    const updateModels = () => {
      if (
        previousActors === actors.current &&
        previousAssets === worldRef.current.assets &&
        previousTerrain === worldRef.current.terrain
      )
        return;
      previousActors = actors.current;
      previousAssets = worldRef.current.assets;
      previousTerrain = worldRef.current.terrain;
      const signature = JSON.stringify([
        worldRef.current.terrain,
        actors.current.map((a) => [a.asset, a.x, a.z, a.removed]),
      ]);
      if (signature !== terrainSignature) {
        terrainSignature = signature;
        structures = deriveStructures(worldRef.current, actors.current);
        scene.remove(terrain.group);
        disposeGroup(terrain.group);
        terrain = makeTerrain(worldRef.current, structures);
        softenEdges(terrain.group, world.size);
        scene.add(terrain.group);
      }
      for (const a of actors.current) {
        let model = models.current.get(a.id);
        if (
          model &&
          model.userData.signature !==
            JSON.stringify(
              worldRef.current.assets.find((s) => s.id === a.asset),
            )
        ) {
          scene.remove(model);
          disposeGroup(model);
          models.current.delete(a.id);
          model = undefined;
        }
        if (!model) {
          const asset = worldRef.current.assets.find((s) => s.id === a.asset);
          if (!asset) continue;
          model = makeObject(asset);
          softenEdges(model, world.size);
          model.userData.asset = a.asset;
          model.userData.signature = JSON.stringify(asset);
          models.current.set(a.id, model);
          scene.add(model);
        }
        model.position.set(
          toScene(a.x),
          floorHeight(worldRef.current, a.x, a.z, structures) ?? -0.4,
          toScene(a.z),
        );
        model.scale.setScalar(a.scale);
        model.rotation.y = (-a.rotation * Math.PI) / 180;
        model.visible = !a.removed;
        const mark = model.getObjectByName("mark"),
          spark = model.getObjectByName("spark");
        if (mark) mark.visible = a.marks.length > 0;
        if (spark) {
          spark.visible = a.marks.length > 0;
          spark.rotation.y = performance.now() * 0.001;
        }
      }
      const ids = new Set(actors.current.map((a) => a.id));
      for (const [id, m] of models.current) {
        if (!ids.has(id)) {
          scene.remove(m);
          disposeGroup(m);
          models.current.delete(id);
        }
      }
    };
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      if (camera instanceof THREE.PerspectiveCamera) camera.aspect = w / h;
      else {
        const size = world.size * 1.22;
        camera.left = (-size * w) / h;
        camera.right = (size * w) / h;
        camera.top = size;
        camera.bottom = -size;
      }
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const blocked = (x: number, z: number) =>
      (jump
        ? blocksAirStep(jumpFrame(jump.origin, jump.elapsed).y,
            floorHeight(worldRef.current, x, z, structures))
        : blocksGroundStep(
            floorHeight(worldRef.current, player.x, player.z, structures),
            floorHeight(worldRef.current, x, z, structures),
            Math.hypot(x - player.x, z - player.z),
          )) ||
      terrain.environment.trees.some(
        (tree) => Math.hypot(tree.x - x, tree.z - z) < 0.18,
      ) ||
      actors.current.some(
        (a) =>
          !a.removed &&
          worldRef.current.assets.find((s) => s.id === a.asset)?.solid &&
          Math.hypot(x - a.x, z - a.z) < 0.43 * a.scale + 0.13,
      );
    const keydown = (e: KeyboardEvent) => {
      if (
        mode !== "play" ||
        falling !== null ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          (e.target.isContentEditable ||
            e.target.closest("input, textarea, select")))
      )
        return;
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        if (!e.repeat) jumpBuffer = JUMP_BUFFER_SECONDS;
        return;
      }
      const key = movementKey(e);
      if (key) {
        e.preventDefault();
        if (!e.repeat) keys.add(key);
      }
    };
    const keyup = (e: KeyboardEvent) => {
      const key = movementKey(e);
      if (key) keys.delete(key);
    };
    const clear = () => {
      keys.clear();
      controls?.current.clear();
      resetControls.current?.();
      jumpBuffer = 0;
      stepRemaining = 0;
      velocity = 0;
      drag = false;
    };
    const focusInput = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement &&
          (e.target.isContentEditable || e.target.closest("input, textarea, select"))) clear();
    };
    const down = (e: PointerEvent) => {
      if (mode !== "play" || falling) return;
      drag = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      targetYaw =
        player.yaw +
        THREE.MathUtils.clamp(
          targetYaw + (e.clientX - lastX) * 0.002 - player.yaw,
          -Math.PI / 6,
          Math.PI / 6,
        );
      targetPitch = THREE.MathUtils.clamp(
        targetPitch - (e.clientY - lastY) * 0.0015,
        -0.7,
        0.7,
      );
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = () => {
      drag = false;
    };
    if (mode === "play") {
      window.addEventListener("keydown", keydown);
      window.addEventListener("keyup", keyup);
      window.addEventListener("blur", clear);
      document.addEventListener("visibilitychange", clear);
      window.addEventListener("focusin", focusInput);
      renderer.domElement.addEventListener("pointerdown", down);
      renderer.domElement.addEventListener("pointermove", move);
      renderer.domElement.addEventListener("pointerup", up);
      renderer.domElement.addEventListener("pointercancel", up);
    }
    const render = (time: number) => {
      const dt = Math.min((time - last) / 1000, 0.05);
      last = time;
      // Re-read wall time after tab sleep or a device timezone change.
      if (time - lastClockSample >= 1000) {
        targetDay = daylightAt(clockRef.current());
        lastClockSample = time;
      }
      const blend = 1 - Math.exp(-dt * 0.8);
      for (const key of [
        "daylight",
        "ambient",
        "sun",
        "moon",
        "sunX",
        "sunY",
        "sunZ",
        "fog",
      ] as const)
        currentDay[key] += (targetDay[key] - currentDay[key]) * blend;
      const weather = worldRef.current.weather ?? "clear";
      const climate = WEATHER[weather];
      weatherSky.set(climate.sky);
      sky.copy(nightSky).lerp(weatherSky, currentDay.daylight);
      atmosphere.color.copy(sky);
      atmosphere.density = baseFog * currentDay.fog * climate.fog;
      mistColor.copy(nightMist).lerp(weatherSky, currentDay.daylight);
      ambient.intensity = currentDay.ambient * climate.ambient;
      sun.intensity = currentDay.sun * climate.sun;
      sun.position.set(currentDay.sunX, currentDay.sunY, currentDay.sunZ);
      moon.intensity = currentDay.moon;
      updateModels();
      terrain.update(time, camera, mistColor);
      if (mode === "overview") {
        const reaction = feedbackRef.current;
        if (reaction && reaction.id !== pulseId) {
          clearPulses();
          pulseId = reaction.id;
          pulseStart = time;
          for (const region of feedbackRegions(reaction.cells, world.size)) {
            const ring = new THREE.Mesh(
              new THREE.RingGeometry(0.98, 1, 64),
              new THREE.MeshBasicMaterial({
                color: 0x111111,
                transparent: true,
                opacity: 0.65,
                depthTest: false,
                depthWrite: false,
                side: THREE.DoubleSide,
              }),
            );
            const top = Math.max(
              ...region.indices.map((i) => {
                const x = i % world.size,
                  z = Math.floor(i / world.size);
                return Math.max(
                  floorHeight(worldRef.current, x, z, structures) ?? 0,
                  terrain.environment.cells[i].water ?? -Infinity,
                );
              }),
            );
            ring.position.set(toScene(region.x), top + 0.06, toScene(region.z));
            ring.rotation.x = -Math.PI / 2;
            ring.userData.radius = region.radius * 2;
            ring.renderOrder = 10;
            pulses.add(ring);
          }
        }
        const age = (time - pulseStart) / 1400;
        if (!reaction || age >= 1) {
          if (pulses.children.length) clearPulses();
        } else
          for (const child of pulses.children) {
            const ring = child as THREE.Mesh<
              THREE.RingGeometry,
              THREE.MeshBasicMaterial
            >;
            ring.scale.setScalar(
              ring.userData.radius * (reducedMotion ? 1 : 0.9 + age * 0.3),
            );
            ring.material.opacity = reducedMotion ? 0.5 : 0.7 * (1 - age);
            ring.material.color.setScalar(1 - currentDay.daylight);
          }
      }
      for (const a of actors.current) {
        const model = models.current.get(a.id);
        if (!model || a.removed) continue;
        const c = environmentAt(terrain.environment, a.x, a.z);
        const base =
          floorHeight(worldRef.current, a.x, a.z, structures) ?? -0.4;
        model.position.y =
          Math.max(base, c.water ?? -Infinity) +
          (c.water !== null && c.water > base
            ? Math.sin(time * 0.0012 + a.x) * 0.035
            : 0);
        model.rotation.z = Math.sin(time * 0.0015 + a.z) * c.windX * 0.07;
        model.rotation.x = Math.sin(time * 0.0015 + a.x) * c.windZ * 0.07;
      }
      if (mode === "play") {
        const previousX = player.x, previousZ = player.z;
        if (falling) {
          falling.elapsed += dt;
          const frame = fallFrame(falling.originY, falling.elapsed);
          eyeY = reducedMotion ? falling.originY : frame.y;
          if (fallVeil.current)
            fallVeil.current.style.opacity = String(frame.fade);
          if (frame.done) {
            player.x = worldRef.current.start.x;
            player.z = worldRef.current.start.z;
            player.yaw = targetYaw = 0;
            pitch = targetPitch = -0.12;
            const spawn = environmentAt(
              terrain.environment,
              player.x,
              player.z,
            );
            eyeY = playerEyeHeight(
              floorHeight(worldRef.current, player.x, player.z, structures) ?? 0,
              spawn.water,
              EYE_HEIGHT,
            );
            falling = null;
            jump = null;
            groundAge = 0;
            lastGround = floorHeight(worldRef.current, player.x, player.z, structures) ?? 0;
            respawnFade = 1;
            clear();
          }
        } else {
          respawnFade = Math.max(0, respawnFade - dt / 0.35);
          if (fallVeil.current)
            fallVeil.current.style.opacity = String(respawnFade);
          const active = (key: string) =>
            keys.has(key) || controls?.current.has(key);
          const profile = movementProfile(!!active("run"), !!active("crouch"));
          const ground = floorHeight(worldRef.current, player.x, player.z, structures);
          if (ground !== null && !jump) {
            lastGround = ground;
            groundAge = 0;
          } else groundAge += dt;
          if (controls?.current.delete("jump")) jumpBuffer = JUMP_BUFFER_SECONDS;
          else jumpBuffer = Math.max(0, jumpBuffer - dt);
          if (jumpBuffer > 0 && !jump && groundAge <= COYOTE_SECONDS) {
            const input = Number(!!(active("forward") || active("w") || active("arrowup")))
              - Number(!!(active("backward") || active("s") || active("arrowdown")));
            const direction = input || (Math.abs(velocity) > .1 ? Math.sign(velocity) : Math.sign(stepRemaining));
            jump = launchJump(lastGround, player.yaw, direction, 1.5 * profile.speed);
            jumpBuffer = 0;
            groundAge = Infinity;
            stepRemaining = 0;
          }
          if (jump) jump.elapsed += dt;
          for (const [command, turn] of [
            ["turn-left", -Math.PI / 12],
            ["turn-right", Math.PI / 12],
          ] as const) {
            if (controls?.current.delete(command)) {
              targetYaw =
                player.yaw +
                THREE.MathUtils.clamp(
                  targetYaw + turn - player.yaw,
                  -Math.PI / 6,
                  Math.PI / 6,
                );
            }
          }
          if (controls?.current.delete("step"))
            stepRemaining = Math.min(stepRemaining + 0.35, 0.7);
          if (controls?.current.delete("backstep"))
            stepRemaining = Math.max(stepRemaining - 0.35, -0.7);
          const turn =
            Number(!!(active("right") || active("d") || active("arrowright"))) -
            Number(!!(active("left") || active("a") || active("arrowleft")));
          if (turn) {
            targetYaw += turn * dt * 0.55;
          }
          player.yaw = followHeading(player.yaw, targetYaw, dt);
          pitch += (targetPitch - pitch) * (1 - Math.exp(-4 * dt));
          const heldForward =
            active("forward") || active("w") || active("arrowup");
          const backward =
            active("backward") || active("s") || active("arrowdown");
          let distance =
            (Number(!!heldForward) - Number(!!backward)) * dt * 1.5;
          if (heldForward || backward) stepRemaining = 0;
          else if (Math.abs(stepRemaining) > 0) {
            distance =
              Math.sign(stepRemaining) *
              Math.min(dt * 1.5, Math.abs(stepRemaining));
            stepRemaining -= distance;
          }
          const surface =
            tileAt(worldRef.current, player.x, player.z)?.surface ?? "plain";
          const conditions = environmentAt(
            terrain.environment,
            player.x,
            player.z,
          );
          const wet =
            conditions.water !== null &&
            conditions.water >
              (floorHeight(worldRef.current, player.x, player.z, structures) ??
                0);
          const speed =
            SURFACES.find((s) => s.id === surface)!.speed * (wet ? 0.55 : 1) * profile.speed;
          const desired = dt ? (distance / dt) * speed : 0;
          velocity +=
            (desired - velocity) *
            (surface === "slick" ? 1 - Math.exp(-3 * dt) : 1);
          distance = velocity * dt;
          const dx = jump ? jump.vx * dt : Math.sin(player.yaw) * distance,
            dz = jump ? jump.vz * dt : -Math.cos(player.yaw) * distance;
          if (!blocked(player.x + dx, player.z)) player.x += dx;
          if (!blocked(player.x, player.z + dz)) player.z += dz;
          const floor = floorHeight(
            worldRef.current,
            player.x,
            player.z,
            structures,
          );
          let feet = floor;
          if (jump) {
            const landing = resolveJump(jump, floor);
            feet = landing.feet;
            if (landing.landed || landing.missed) jump = null;
          } else if (floor === null && groundAge <= COYOTE_SECONDS) {
            feet = lastGround - 5 * groundAge * groundAge;
          }
          if (feet === null) {
            falling = { originY: eyeY, elapsed: 0 };
            clear();
            callback.current?.({ ...player, pitch, falling: true });
          } else {
            const local = environmentAt(
              terrain.environment,
              player.x,
              player.z,
            );
            const targetY = playerEyeHeight(feet, local.water, profile.eyeHeight);
            eyeY += (targetY - eyeY) * (1 - Math.exp(-8 * dt));
          }
        }
        const traveled = Math.hypot(player.x - previousX, player.z - previousZ) * 2;
        const grounded = !falling && !jump && respawnFade === 0 && !reducedMotion;
        if (grounded) walkedDistance += traveled;
        const underfoot = environmentAt(terrain.environment, player.x, player.z);
        const ground = floorHeight(worldRef.current, player.x, player.z, structures);
        const dry = underfoot.water === null || (ground !== null && ground >= underfoot.water);
        const roughness = grounded && dry && ground !== null
          ? terrainSample(worldRef.current, player.x, player.z).weights.rough : 0;
        const motion = roughGroundMotion(walkedDistance, roughness, dt > 0 ? traveled / dt : 0, !!controls?.current.has("crouch"));
        const settle = 1 - Math.exp(-14 * dt);
        groundBob += (motion.y - groundBob) * settle;
        groundRoll += (motion.roll - groundRoll) * settle;
        camera.position.set(toScene(player.x), eyeY + groundBob, toScene(player.z));
        camera.rotation.order = "YXZ";
        camera.rotation.y = -player.yaw;
        camera.rotation.x = pitch;
        camera.rotation.z = groundRoll;
        if (time - report > 80) {
          callback.current?.({ ...player, pitch, falling: falling !== null });
          report = time;
        }
      }
      weatherScene.update(time, worldRef.current.weather ?? "clear", camera, currentDay.daylight, mode === "overview");
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    const contextLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      window.removeEventListener("focusin", focusInput);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      clear();
      disposeGroup(scene);
      renderer.dispose();
      renderer.domElement.remove();
      models.current.clear();
    };
  }, [world.size, world.sky, world.start.x, world.start.z, mode]);
  return (
    <div
      className={`scene ${className}`}
      ref={host}
      role="img"
      aria-label={t(
        mode === "play" ? "1인칭으로 탐험하는 세계" : "세계의 3D 미리보기",
      )}
    >
      <div ref={fallVeil} className="fall-veil" aria-hidden="true" />
      {failed && (
        <div className="scene-error">
          {t("3D 화면을 시작하지 못했어요.")}
          <br />
          {t("WebGL을 지원하는 브라우저에서 다시 열어 주세요.")}
        </div>
      )}
    </div>
  );
}
