import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const viewport = document.getElementById("viewport");
const heightmapInput = document.getElementById("heightmap");
const heightmapUrlInput = document.getElementById("heightmap-url");
const loadUrlButton = document.getElementById("load-url");
const statusEl = document.getElementById("status");
const altitudeButtons = Array.from(document.querySelectorAll(".altitudes button"));
const debugEl = document.getElementById("debug");
const heightmapPanel = document.getElementById("heightmap-panel");
const inventoryPanel = document.getElementById("inventory-panel");
const inventoryEl = document.getElementById("inventory");
const actionBarEl = document.getElementById("action-bar");
const orbitToggleButton = document.getElementById("toggle-orbit-speed");

const state = {
  width: 256,
  height: 256,
  data: new Float32Array(256 * 256),
  size: 255,
  heightScale: 72,
  altitudeTarget: 6,
  altitude: 6,
  yaw: 0,
  pitch: 0,
  moveYaw: 0,
  velocity: new THREE.Vector3(),
  move: { forward: 0, right: 0, boost: false },
  turn: { left: false, right: false },
  mouse: { left: false, right: false, both: false },
  jumpVel: 0,
  jumpOffset: 0,
  activeSlot: 0,
  selectedItem: null,
  stepTimer: 0,
  flying: false,
  flyY: 0,
  flyVel: 0,
  dayLength: 600,
  normalDayLength: 600,
  fastDayLength: 60,
  fastMode: false,
  ambientTorchCount: 5,
  treeCount: 34,
  rockCount: 22,
  metalMineCount: 8,
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(Math.max(window.innerWidth, window.innerHeight), Math.min(window.innerWidth, window.innerHeight));
renderer.setClearColor(0xa7c4ff, 1);
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa7c4ff, 60, 380);

const camera = new THREE.PerspectiveCamera(70, Math.max(window.innerWidth, window.innerHeight) / Math.min(window.innerWidth, window.innerHeight), 0.1, 800);

const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(80, 140, 40);
scene.add(sun);
const moonLight = new THREE.DirectionalLight(0x8fb6ff, 0.12);
scene.add(moonLight);

const sky = createSkySystem();
scene.add(sky.group);

let terrain = null;
let house = null;
let houseDoorPivot = null;
let houseDoorMesh = null;
let houseDoorOpen = false;
const placedBlocks = new Map();
let longPressTimer = null;
let longPressTriggered = false;
let audioCtx = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0, 0);
const lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

const blockCatalog = [
  { id: "grass", label: "Grass", color: 0x5b8c42 },
  { id: "stone", label: "Stone", color: 0x888888 },
  { id: "sand", label: "Sand", color: 0xd8c27a },
  { id: "lava", label: "Lava", color: 0xd94b2b },
  { id: "ice", label: "Ice", color: 0x8fd3ff },
  { id: "wood", label: "Wood", color: 0x8b5a2b },
  { id: "metal", label: "Metal", color: 0x9aa3b2 },
  { id: "brick", label: "Brick", color: 0xb5524a },
  { id: "torch", label: "Torch", color: 0xffbf66 },
];

const actionBar = ["stone", "sand", "metal", "torch"];
const blockPrototypes = new Map();
const ambientTorches = [];
const worldProps = [];
const terrainMatrixDummy = new THREE.Object3D();
const TERRAIN_BASE_Y = -24;
const TERRAIN_MINE_STEP = 1;

const houseConfig = {
  x: 8,
  z: 8,
  size: 30,
  wallHeight: 12,
  doorWidth: 6,
  doorHeight: 9,
};

const respawnPoint = {
  x: houseConfig.x,
  z: houseConfig.z + houseConfig.size / 2 + 30,
};

function createGlowTexture(innerColor, outerColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(128, 128, 16, 128, 128, 128);
  gradient.addColorStop(0, innerColor);
  gradient.addColorStop(0.35, outerColor);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createSkySystem() {
  const uniforms = {
    topColor: { value: new THREE.Color(0x5a8cff) },
    horizonColor: { value: new THREE.Color(0xffc98a) },
    bottomColor: { value: new THREE.Color(0xe6f3ff) },
    nightTopColor: { value: new THREE.Color(0x10203a) },
    nightBottomColor: { value: new THREE.Color(0x31476d) },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    moonDirection: { value: new THREE.Vector3(0, -1, 0) },
    dayMix: { value: 1 },
    sunGlow: { value: 0.8 },
    moonGlow: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms,
    vertexShader: `
      varying vec3 vWorldDirection;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldDirection;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform vec3 nightTopColor;
      uniform vec3 nightBottomColor;
      uniform vec3 sunDirection;
      uniform vec3 moonDirection;
      uniform float dayMix;
      uniform float sunGlow;
      uniform float moonGlow;

      void main() {
        vec3 dir = normalize(vWorldDirection);
        float horizon = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 daySky = mix(bottomColor, horizonColor, smoothstep(0.05, 0.45, horizon));
        daySky = mix(daySky, topColor, smoothstep(0.4, 1.0, horizon));
        vec3 nightSky = mix(nightBottomColor, nightTopColor, smoothstep(0.0, 1.0, horizon));
        vec3 sky = mix(nightSky, daySky, dayMix);

        float sunDisk = pow(max(dot(dir, normalize(sunDirection)), 0.0), 512.0);
        float sunHalo = pow(max(dot(dir, normalize(sunDirection)), 0.0), 10.0) * sunGlow;
        float moonDisk = pow(max(dot(dir, normalize(moonDirection)), 0.0), 900.0);
        float moonHalo = pow(max(dot(dir, normalize(moonDirection)), 0.0), 18.0) * moonGlow;

        sky += vec3(1.0, 0.72, 0.34) * (sunDisk * 2.4 + sunHalo * 0.7);
        sky += vec3(0.72, 0.82, 1.0) * (moonDisk * 1.4 + moonHalo * 0.35);
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });

  const group = new THREE.Group();
  const skybox = new THREE.Mesh(new THREE.BoxGeometry(700, 700, 700), material);
  group.add(skybox);

  const sunGroup = new THREE.Group();
  const sunCore = new THREE.Mesh(
    new THREE.SphereGeometry(12, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe2a1 })
  );
  const sunHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createGlowTexture("rgba(255,255,220,1)", "rgba(255,160,40,0.45)"),
      color: 0xffb347,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  sunHalo.scale.setScalar(90);
  sunGroup.add(sunHalo);
  sunGroup.add(sunCore);
  group.add(sunGroup);

  const moonGroup = new THREE.Group();
  const moonCore = new THREE.Mesh(
    new THREE.SphereGeometry(9, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xdce7ff })
  );
  const moonHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createGlowTexture("rgba(235,245,255,0.9)", "rgba(120,160,255,0.22)"),
      color: 0xb8cbff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  moonHalo.scale.setScalar(56);
  moonGroup.add(moonHalo);
  moonGroup.add(moonCore);
  group.add(moonGroup);

  return { group, uniforms, sunGroup, moonGroup, radius: 260 };
}

function updateSky(timeSeconds) {
  const cycle = ((timeSeconds % state.dayLength) + state.dayLength) / state.dayLength;
  const angle = cycle * Math.PI * 2;
  const orbitTilt = Math.PI * 0.22;
  const sunDirection = new THREE.Vector3(
    Math.cos(angle),
    Math.sin(angle),
    Math.sin(orbitTilt) * Math.cos(angle * 0.6)
  ).normalize();
  const moonDirection = sunDirection.clone().multiplyScalar(-1);
  const daylight = THREE.MathUtils.clamp(sunDirection.y * 0.85 + 0.25, 0, 1);
  const sunStrength = THREE.MathUtils.smoothstep(Math.max(0, sunDirection.y), 0, 1);
  const moonStrength = THREE.MathUtils.smoothstep(Math.max(0, moonDirection.y), 0, 1);

  sky.group.position.copy(camera.position);
  sky.uniforms.sunDirection.value.copy(sunDirection);
  sky.uniforms.moonDirection.value.copy(moonDirection);
  sky.uniforms.dayMix.value = daylight;
  sky.uniforms.sunGlow.value = sunStrength;
  sky.uniforms.moonGlow.value = moonStrength;

  sky.sunGroup.position.copy(sunDirection).multiplyScalar(sky.radius);
  sky.moonGroup.position.copy(moonDirection).multiplyScalar(sky.radius);
  sky.sunGroup.visible = sunDirection.y > -0.12;
  sky.moonGroup.visible = moonDirection.y > -0.18;

  const fogColor = new THREE.Color(0x0f1726).lerp(new THREE.Color(0xa7c4ff), daylight);
  scene.fog.color.copy(fogColor);
  renderer.setClearColor(fogColor, 1);

  ambient.intensity = THREE.MathUtils.lerp(0.3, 0.62, daylight);
  ambient.color.setRGB(
    THREE.MathUtils.lerp(0.62, 1, daylight),
    THREE.MathUtils.lerp(0.68, 0.98, daylight),
    THREE.MathUtils.lerp(0.84, 0.95, daylight)
  );

  sun.intensity = THREE.MathUtils.lerp(0.08, 1.85, sunStrength);
  sun.color.setRGB(
    THREE.MathUtils.lerp(0.58, 1.0, sunStrength),
    THREE.MathUtils.lerp(0.66, 0.92, sunStrength),
    THREE.MathUtils.lerp(0.9, 0.74, sunStrength)
  );
  sun.position.copy(sunDirection).multiplyScalar(220);

  moonLight.intensity = THREE.MathUtils.lerp(0.1, 0.42, moonStrength);
  moonLight.position.copy(moonDirection).multiplyScalar(180);
}

function toggleFastMode() {
  state.fastMode = !state.fastMode;
  state.dayLength = state.fastMode ? state.fastDayLength : state.normalDayLength;
  statusEl.textContent = state.fastMode ? "Fast orbit: 60s cycle" : "Normal orbit: 10m cycle";
  if (orbitToggleButton) {
    orbitToggleButton.textContent = state.fastMode ? "Cycle Mode: Fast" : "Cycle Mode: Slow";
    orbitToggleButton.classList.toggle("active", state.fastMode);
  }
}

function createDefaultHeightmap() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  const hills = [
    { x: 0.22, y: 0.3, radius: 0.16, height: 0.24 },
    { x: 0.72, y: 0.26, radius: 0.14, height: 0.2 },
    { x: 0.34, y: 0.72, radius: 0.18, height: 0.28 },
    { x: 0.76, y: 0.68, radius: 0.12, height: 0.18 },
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      let height = 0.07;

      hills.forEach((hill) => {
        const dx = u - hill.x;
        const dy = v - hill.y;
        const dist = Math.sqrt(dx * dx + dy * dy) / hill.radius;
        if (dist < 1) {
          const falloff = 1 - dist * dist;
          height += hill.height * falloff * falloff;
        }
      });

      const gentleVariation =
        Math.sin(u * Math.PI * 2.2) * 0.008 +
        Math.cos(v * Math.PI * 2.8) * 0.006 +
        Math.sin((u + v) * Math.PI * 3.4) * 0.004;
      height += gentleVariation;
      height = Math.min(0.48, Math.max(0.045, height));
      const shade = Math.floor(height * 255);
      const idx = (y * size + x) * 4;
      data[idx] = shade;
      data[idx + 1] = shade;
      data[idx + 2] = shade;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function applyHeightmap(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  state.width = canvas.width;
  state.height = canvas.height;
  state.data = new Float32Array(state.width * state.height);

  for (let i = 0; i < state.width * state.height; i += 1) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const gray = (r + g + b) / (3 * 255);
    state.data[i] = gray;
  }

  smoothHeightmap(1);
  state.size = Math.max(state.width - 1, state.height - 1);
  buildTerrain();
}

function buildTerrain() {
  if (terrain) {
    scene.remove(terrain);
    terrain.geometry.dispose();
    terrain.material.dispose();
  }
  if (house) {
    scene.remove(house);
    house.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
    house = null;
    houseDoorPivot = null;
    houseDoorMesh = null;
    houseDoorOpen = false;
  }

  flattenTerrainForHouse();

  const geometry = new THREE.BoxGeometry(1.02, 1, 1.02);
  const material = new THREE.MeshStandardMaterial({
    color: 0x496c3f,
    roughness: 0.85,
    metalness: 0.05,
    flatShading: true,
  });

  const count = state.width * state.height;
  terrain = new THREE.InstancedMesh(geometry, material, count);
  let i = 0;
  for (let z = 0; z < state.height; z += 1) {
    for (let x = 0; x < state.width; x += 1) {
      updateTerrainColumnMatrix(x, z, i);
      i += 1;
    }
  }
  terrain.instanceMatrix.needsUpdate = true;
  scene.add(terrain);

  setRespawnFacing();
  state.pitch = -0.2;
  state.moveYaw = 0;
  buildHouse();
  clearPlacedBlocks();
  respawnWorldProps();
  respawnAmbientTorches();
}

function updateTerrainColumnMatrix(x, z, instanceId = z * state.width + x) {
  if (!terrain) return;
  const halfX = (state.width - 1) / 2;
  const halfZ = (state.height - 1) / 2;
  const heightValue = state.data[z * state.width + x];
  const y = heightValue * state.heightScale;
  const topY = y + 1;
  const columnHeight = Math.max(1, topY - TERRAIN_BASE_Y);
  terrainMatrixDummy.position.set(x - halfX, TERRAIN_BASE_Y + columnHeight / 2, z - halfZ);
  terrainMatrixDummy.scale.set(1, columnHeight, 1);
  terrainMatrixDummy.updateMatrix();
  terrain.setMatrixAt(instanceId, terrainMatrixDummy.matrix);
}

function sampleHeight(x, z) {
  const half = state.size / 2;
  const u = (x + half) / state.size;
  const v = (z + half) / state.size;

  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;

  const fx = u * (state.width - 1);
  const fz = v * (state.height - 1);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(state.width - 1, x0 + 1);
  const z1 = Math.min(state.height - 1, z0 + 1);
  const sx = fx - x0;
  const sz = fz - z0;

  const h00 = state.data[z0 * state.width + x0];
  const h10 = state.data[z0 * state.width + x1];
  const h01 = state.data[z1 * state.width + x0];
  const h11 = state.data[z1 * state.width + x1];

  const h0 = h00 * (1 - sx) + h10 * sx;
  const h1 = h01 * (1 - sx) + h11 * sx;
  const h = h0 * (1 - sz) + h1 * sz;

  return h * state.heightScale;
}

function setAltitude(target) {
  state.altitudeTarget = target;
  altitudeButtons.forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.alt) === target);
  });
}

function handlePointerMove(event) {
  const sensitivity = 0.0023;
  if (state.mouse.left) {
    state.moveYaw -= event.movementX * sensitivity;
    state.yaw = state.moveYaw;
    state.pitch -= event.movementY * sensitivity;
    state.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, state.pitch));
  }
  if (state.mouse.right) {
    state.yaw -= event.movementX * sensitivity;
    state.pitch -= event.movementY * sensitivity;
    state.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, state.pitch));
  }
}

function updateCamera(delta) {
  const speed = state.move.boost ? 60 : 36;
  const forward = Math.max(-1, Math.min(1, state.move.forward + (state.mouse.both ? -1 : 0)));
  const right = state.move.right;
  const turnRate = 2.6;
  if (state.turn.left) {
    const deltaYaw = turnRate * delta;
    state.moveYaw += deltaYaw;
    state.yaw += deltaYaw;
  }
  if (state.turn.right) {
    const deltaYaw = -turnRate * delta;
    state.moveYaw += deltaYaw;
    state.yaw += deltaYaw;
  }

  const dir = new THREE.Vector3(
    Math.sin(state.moveYaw) * forward + Math.cos(state.moveYaw) * right,
    0,
    Math.cos(state.moveYaw) * forward - Math.sin(state.moveYaw) * right
  );

  if (dir.lengthSq() > 0) {
    dir.normalize().multiplyScalar(speed * delta);
    camera.position.add(dir);
    const t = 1 - Math.exp(-delta * 10);
    state.yaw = lerpAngle(state.yaw, state.moveYaw, t);
  }

  const half = state.size / 2;
  camera.position.x = Math.max(-half, Math.min(half, camera.position.x));
  camera.position.z = Math.max(-half, Math.min(half, camera.position.z));

  const ground = sampleHeight(camera.position.x, camera.position.z);

  if (state.flying) {
    const flySpeed = state.move.boost ? 40 : 18;
    state.flyVel += (state.flyUp ? flySpeed : state.flyDown ? -flySpeed : 0) * delta * 4;
    state.flyVel *= Math.exp(-1.897 * delta);
    state.flyY += state.flyVel * delta;
    const minFlyY = ground + 2;
    if (state.flyY < minFlyY) state.flyY = minFlyY;
    camera.position.y = state.flyY;
    state.jumpOffset = 0;
    state.jumpVel = 0;
  } else {
    state.altitude += (state.altitudeTarget - state.altitude) * Math.min(1, delta * 6);
    const gravity = 90;
    state.jumpVel -= gravity * delta;
    state.jumpOffset += state.jumpVel * delta;
    if (state.jumpOffset < 0) {
      state.jumpOffset = 0;
      state.jumpVel = 0;
    }
    camera.position.y = ground + state.altitude + state.jumpOffset;
  }

  const moving = dir.lengthSq() > 0.0001;
  if (moving && state.jumpOffset === 0) {
    state.stepTimer += delta;
    const interval = state.move.boost ? 0.22 : 0.3;
    if (state.stepTimer >= interval) {
      state.stepTimer = 0;
      playStepSound();
    }
  } else {
    state.stepTimer = 0;
  }

  camera.rotation.order = "YXZ";
  camera.rotation.y = state.yaw;
  camera.rotation.x = state.pitch;
}

function lerpAngle(a, b, t) {
  let delta = (b - a + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return a + delta * t;
}

function onResize() {
  const lw = Math.max(window.innerWidth, window.innerHeight);
  const lh = Math.min(window.innerWidth, window.innerHeight);
  camera.aspect = lw / lh;
  camera.updateProjectionMatrix();
  renderer.setSize(lw, lh);
}

function animate(time) {
  const delta = Math.min(0.05, (time - (animate.lastTime || time)) / 1000);
  animate.lastTime = time;
  updateCamera(delta);
  updateSky(time / 1000);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function handleKey(event, active) {
  switch (event.code) {
    case "KeyW":
    case "ArrowUp":
      state.move.forward = active ? -1 : state.move.forward === -1 ? 0 : state.move.forward;
      break;
    case "KeyS":
    case "ArrowDown":
      state.move.forward = active ? 1 : state.move.forward === 1 ? 0 : state.move.forward;
      break;
    case "KeyA":
    case "ArrowLeft":
      state.turn.left = active;
      break;
    case "KeyD":
    case "ArrowRight":
      state.turn.right = active;
      break;
    case "KeyQ":
      state.move.right = active ? -1 : state.move.right === -1 ? 0 : state.move.right;
      break;
    case "KeyE":
      state.move.right = active ? 1 : state.move.right === 1 ? 0 : state.move.right;
      break;
    case "ShiftLeft":
    case "ShiftRight":
      state.move.boost = active;
      break;
    case "Digit1":
      if (active) placeFromSlot(0);
      break;
    case "Digit2":
      if (active) placeFromSlot(1);
      break;
    case "Digit3":
      if (active) placeFromSlot(2);
      break;
    case "Digit4":
      if (active) placeFromSlot(3);
      break;
    case "Space":
      if (active && state.jumpOffset === 0) {
        state.jumpVel = 22;
      }
      break;
    case "KeyR":
      if (active) respawn();
      break;
    case "KeyF":
      if (active) toggleFastMode();
      break;
    default:
      break;
  }
}

function loadHeightmapFile(file) {
  if (!file) return;
  const img = new Image();
  img.onload = () => applyHeightmap(img);
  img.src = URL.createObjectURL(file);
}

function loadHeightmapUrl(url) {
  if (!url) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => applyHeightmap(img);
  img.onerror = () => {
    statusEl.textContent = "Failed to load heightmap URL";
  };
  img.src = url;
}

function setupPointerLock() {
  document.addEventListener("mousemove", handlePointerMove);
}

function updateMouseForward() {
  state.mouse.both = state.mouse.left && state.mouse.right;
}

renderer.domElement.addEventListener("mousedown", (event) => {
  if (event.button === 0) state.mouse.left = true;
  if (event.button === 2) state.mouse.right = true;
  updateMouseForward();
});

renderer.domElement.addEventListener("mouseup", (event) => {
  if (event.button === 0) state.mouse.left = false;
  if (event.button === 2) state.mouse.right = false;
  updateMouseForward();
});

renderer.domElement.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

renderer.domElement.addEventListener("pointerdown", (event) => {
  updatePointerFromScreen(event.clientX, event.clientY);
  ensureAudio();
  if (event.button === 0) {
    longPressTriggered = false;
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      longPressTriggered = deleteBlockAtCursor();
    }, 450);
  }
  if (event.button === 2) {
    placeBlock();
  }
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (event.button !== 0) return;
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (longPressTriggered) return;
  raycaster.setFromCamera(pointer, camera);
  if (houseDoorMesh) {
    const hits = raycaster.intersectObject(houseDoorMesh, false);
    if (hits.length) {
      toggleHouseDoor();
      return;
    }
  }
  if (event.pointerType === "touch") {
    placeBlock();
  }
});

function updatePointerFromScreen(x, y) {
  if (window.innerHeight > window.innerWidth) {
    // Portrait mode: body is rotated 90deg; remap physical coords to landscape canvas space
    pointer.x = (y / window.innerHeight) * 2 - 1;
    pointer.y = -((window.innerWidth - x) / window.innerWidth) * 2 + 1;
  } else {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((x - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((y - rect.top) / rect.height) * 2 + 1;
  }
}

function remapToLandscape(x, y) {
  return window.innerHeight > window.innerWidth
    ? { x: y, y: window.innerWidth - x }
    : { x, y };
}

renderer.domElement.addEventListener("mousemove", (event) => {
  lastMouse.x = event.clientX;
  lastMouse.y = event.clientY;
  updatePointerFromScreen(event.clientX, event.clientY);
});

window.addEventListener("mousemove", (event) => {
  lastMouse.x = event.clientX;
  lastMouse.y = event.clientY;
  updatePointerFromScreen(event.clientX, event.clientY);
});

window.addEventListener("keydown", () => {
  ensureAudio();
});

function buildInventory() {
  inventoryEl.innerHTML = "";
  actionBarEl.innerHTML = "";

  if (!state.selectedItem && blockCatalog.length) {
    state.selectedItem = actionBar[0];
  }

  blockCatalog.forEach((block) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "inventory-item";
    item.textContent = block.label;
    item.style.borderColor = `#${block.color.toString(16).padStart(6, "0")}`;
    item.addEventListener("click", () => {
      setSelectedItem(block.id);
    });
    if (state.selectedItem === block.id) item.classList.add("active");
    inventoryEl.appendChild(item);
  });

  renderActionBar();
}

function renderActionBar() {
  actionBarEl.innerHTML = "";
  actionBar.forEach((blockId, index) => {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "action-slot";
    const block = blockCatalog.find((b) => b.id === blockId);
    slot.textContent = block ? block.label : `${index + 1}: Empty`;
    if (index === state.activeSlot) slot.classList.add("active");
    slot.addEventListener("click", () => assignToSlot(index));
    actionBarEl.appendChild(slot);
  });
}

function setActiveSlot(index) {
  state.activeSlot = index;
  renderActionBar();
}

function setSelectedItem(blockId) {
  state.selectedItem = blockId;
  buildInventory();
}

function assignToSlot(index) {
  if (!state.selectedItem) return;
  actionBar[index] = state.selectedItem;
  state.activeSlot = index;
  renderActionBar();
}

function ensureBlockPrototype(blockId) {
  if (blockPrototypes.has(blockId)) return blockPrototypes.get(blockId);
  const block = blockCatalog.find((b) => b.id === blockId);
  if (!block) return null;

  let object;
  if (blockId === "torch") {
    object = createTorchObject();
  } else {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: block.color, roughness: 0.7, metalness: 0.1 });
    object = new THREE.Mesh(geometry, material);
  }

  blockPrototypes.set(blockId, object);
  return object;
}

function cloneRenderable(source) {
  const clone = source.clone(true);
  clone.traverse((child) => {
    if (child.isMesh) {
      child.geometry = child.geometry.clone();
      if (Array.isArray(child.material)) {
        child.material = child.material.map((material) => material.clone());
      } else if (child.material) {
        child.material = child.material.clone();
      }
    }
  });
  return clone;
}

function disposeObject(root) {
  root.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material?.dispose();
      }
    }
  });
  if (root.parent) root.parent.remove(root);
}

function createTorchObject() {
  const group = new THREE.Group();

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.11, 1.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x6f4b2c, roughness: 0.95, metalness: 0.03 })
  );
  shaft.position.y = 0.6;
  group.add(shaft);

  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffc463,
      emissive: 0xff9a2f,
      emissiveIntensity: 1.8,
      roughness: 0.3,
      metalness: 0,
    })
  );
  ember.position.y = 1.28;
  group.add(ember);

  const glow = new THREE.PointLight(0xffb45a, 1.35, 18, 2.1);
  glow.position.y = 1.4;
  group.add(glow);

  return group;
}

function clearPlacedBlocks() {
  placedBlocks.forEach((entry) => {
    entry.objects.forEach((object) => {
      disposeObject(object);
    });
  });
  placedBlocks.clear();
}

function clearAmbientTorches() {
  ambientTorches.forEach((torch) => disposeObject(torch));
  ambientTorches.length = 0;
}

function clearWorldProps() {
  worldProps.forEach((prop) => disposeObject(prop));
  worldProps.length = 0;
}

function createTorchPlacement(x, y, z) {
  const prototype = ensureBlockPrototype("torch");
  const torch = cloneRenderable(prototype);
  torch.position.set(x, y, z);
  return torch;
}

function createTreeObject() {
  const group = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.55, 4.8, 8),
    new THREE.MeshStandardMaterial({ color: 0x6c4728, roughness: 0.96, metalness: 0.02 })
  );
  trunk.position.y = 2.4;
  group.add(trunk);

  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x3f6e35, roughness: 0.92, metalness: 0.01 });
  const crownLow = new THREE.Mesh(new THREE.ConeGeometry(2.8, 4.5, 9), crownMaterial);
  crownLow.position.y = 5.2;
  group.add(crownLow);
  const crownHigh = new THREE.Mesh(new THREE.ConeGeometry(2.1, 3.8, 9), crownMaterial);
  crownHigh.position.y = 7.1;
  group.add(crownHigh);

  return group;
}

function createRockObject() {
  const mesh = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x7e8289, roughness: 0.98, metalness: 0.03, flatShading: true })
  );
  return mesh;
}

function createMetalMineObject() {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1.9, 0),
    new THREE.MeshStandardMaterial({ color: 0x50555e, roughness: 0.9, metalness: 0.12, flatShading: true })
  );
  group.add(base);

  const veinMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8c4d8,
    emissive: 0x24384f,
    emissiveIntensity: 0.45,
    roughness: 0.42,
    metalness: 0.82,
  });
  const offsets = [
    [-0.8, 0.35, 0.7],
    [0.9, -0.2, 0.4],
    [0.25, 0.8, -0.9],
  ];
  offsets.forEach(([x, y, z]) => {
    const vein = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 1.15), veinMaterial);
    vein.position.set(x, y, z);
    vein.rotation.set(Math.random() * 0.5, Math.random() * 1.3, Math.random() * 0.5);
    group.add(vein);
  });

  return group;
}

function createWorldProp(type) {
  if (type === "tree") return createTreeObject();
  if (type === "rock") return createRockObject();
  return createMetalMineObject();
}

function randomPropPosition(radiusPadding = 8) {
  const half = state.size / 2 - radiusPadding;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const x = Math.round(THREE.MathUtils.randFloat(-half, half));
    const z = Math.round(THREE.MathUtils.randFloat(-half, half));
    const dx = x - houseConfig.x;
    const dz = z - houseConfig.z;
    if (dx * dx + dz * dz < (houseConfig.size + 24) ** 2) continue;
    const rx = x - respawnPoint.x;
    const rz = z - respawnPoint.z;
    if (rx * rx + rz * rz < 22 ** 2) continue;
    return { x, z };
  }
  return null;
}

function scatterWorldProps(type, count, occupied, minSpacing) {
  for (let i = 0; i < count; i += 1) {
    let pos = null;
    for (let attempt = 0; attempt < 350; attempt += 1) {
      const candidate = randomPropPosition();
      if (!candidate) break;
      const hasConflict = occupied.some((entry) => {
        const dx = candidate.x - entry.x;
        const dz = candidate.z - entry.z;
        return dx * dx + dz * dz < (entry.spacing + minSpacing) ** 2;
      });
      if (!hasConflict) {
        pos = candidate;
        break;
      }
    }
    if (!pos) break;

    const prop = createWorldProp(type);
    const y = sampleHeight(pos.x, pos.z);
    const scale =
      type === "tree"
        ? THREE.MathUtils.randFloat(0.85, 1.35)
        : type === "rock"
          ? THREE.MathUtils.randFloat(0.75, 1.6)
          : THREE.MathUtils.randFloat(0.9, 1.35);
    prop.position.set(pos.x, y, pos.z);
    prop.rotation.y = Math.random() * Math.PI * 2;
    prop.scale.setScalar(scale);
    scene.add(prop);
    worldProps.push(prop);
    occupied.push({ x: pos.x, z: pos.z, spacing: minSpacing * scale });
  }
}

function respawnWorldProps() {
  clearWorldProps();
  const occupied = [];
  scatterWorldProps("tree", state.treeCount, occupied, 8);
  scatterWorldProps("rock", state.rockCount, occupied, 5);
  scatterWorldProps("metal", state.metalMineCount, occupied, 7);
}

function randomTorchPosition() {
  const half = state.size / 2 - 8;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const x = Math.round(THREE.MathUtils.randFloat(-half, half));
    const z = Math.round(THREE.MathUtils.randFloat(-half, half));
    const dx = x - houseConfig.x;
    const dz = z - houseConfig.z;
    if (dx * dx + dz * dz < (houseConfig.size * 0.9) ** 2) continue;
    const rx = x - respawnPoint.x;
    const rz = z - respawnPoint.z;
    if (rx * rx + rz * rz < 18 ** 2) continue;
    return { x, z };
  }
  return null;
}

function respawnAmbientTorches() {
  clearAmbientTorches();
  const occupied = new Set();

  for (let i = 0; i < state.ambientTorchCount; i += 1) {
    const pos = randomTorchPosition();
    if (!pos) break;
    const key = `${pos.x},${pos.z}`;
    if (occupied.has(key)) {
      i -= 1;
      continue;
    }
    occupied.add(key);
    const y = sampleHeight(pos.x, pos.z) + 1;
    const torch = createTorchPlacement(pos.x, y, pos.z);
    scene.add(torch);
    ambientTorches.push(torch);
  }
}

function flattenTerrainForHouse() {
  const halfX = (state.width - 1) / 2;
  const halfZ = (state.height - 1) / 2;
  const centerHeight = sampleHeight(houseConfig.x, houseConfig.z);
  const flatValue = centerHeight / state.heightScale;
  const radius = houseConfig.size / 2 + 6;
  const centerRadius = 32;
  const centerValue = sampleHeight(0, 0) / state.heightScale;

  for (let z = 0; z < state.height; z += 1) {
    const worldZ = z - halfZ;
    for (let x = 0; x < state.width; x += 1) {
      const worldX = x - halfX;
      const dx = worldX - houseConfig.x;
      const dz = worldZ - houseConfig.z;
      const cdx = worldX;
      const cdz = worldZ;
      if (cdx * cdx + cdz * cdz <= centerRadius * centerRadius) {
        state.data[z * state.width + x] = centerValue;
      } else if (dx * dx + dz * dz <= radius * radius) {
        state.data[z * state.width + x] = flatValue;
      }
    }
  }
}

function smoothHeightmap(maxDelta) {
  const maxStep = maxDelta / state.heightScale;
  const w = state.width;
  const h = state.height;
  const data = state.data;

  for (let pass = 0; pass < 4; pass += 1) {
    for (let z = 0; z < h; z += 1) {
      for (let x = 0; x < w; x += 1) {
        const idx = z * w + x;
        let v = data[idx];
        if (x > 0) v = clampStep(v, data[idx - 1], maxStep);
        if (x < w - 1) v = clampStep(v, data[idx + 1], maxStep);
        if (z > 0) v = clampStep(v, data[idx - w], maxStep);
        if (z < h - 1) v = clampStep(v, data[idx + w], maxStep);
        data[idx] = v;
      }
    }
    for (let z = h - 1; z >= 0; z -= 1) {
      for (let x = w - 1; x >= 0; x -= 1) {
        const idx = z * w + x;
        let v = data[idx];
        if (x > 0) v = clampStep(v, data[idx - 1], maxStep);
        if (x < w - 1) v = clampStep(v, data[idx + 1], maxStep);
        if (z > 0) v = clampStep(v, data[idx - w], maxStep);
        if (z < h - 1) v = clampStep(v, data[idx + w], maxStep);
        data[idx] = v;
      }
    }
  }
}

function clampStep(value, neighbor, maxStep) {
  if (value - neighbor > maxStep) return neighbor + maxStep;
  if (neighbor - value > maxStep) return neighbor - maxStep;
  return value;
}

function toggleHouseDoor() {
  if (!houseDoorPivot) return false;
  houseDoorOpen = !houseDoorOpen;
  houseDoorPivot.rotation.y = houseDoorOpen ? -Math.PI / 2 : 0;
  return true;
}

function respawn() {
  setRespawnFacing();
  state.jumpOffset = 0;
  state.jumpVel = 0;
  state.move.forward = 0;
  state.move.right = 0;
  respawnWorldProps();
  respawnAmbientTorches();
}

function setRespawnFacing() {
  const dx = houseConfig.x - respawnPoint.x;
  const dz = houseConfig.z - respawnPoint.z;
  const ground = sampleHeight(respawnPoint.x, respawnPoint.z);
  camera.position.set(respawnPoint.x, ground + state.altitude, respawnPoint.z);
  state.yaw = Math.atan2(dx, dz) + Math.PI;
  state.moveYaw = state.yaw;
}

function buildHouse() {
  const houseGroup = new THREE.Group();
  const gray = new THREE.MeshStandardMaterial({ color: 0x9c9c9c, roughness: 0.9, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x7b7b7b, roughness: 0.95, metalness: 0.02 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x6b84a6, roughness: 0.2, metalness: 0.4 });

  const baseX = houseConfig.x;
  const baseZ = houseConfig.z;
  const ground = sampleHeight(baseX, baseZ);
  const half = houseConfig.size / 2;
  const wallHalf = houseConfig.size / 2 - 0.3;
  const wallHeight = houseConfig.wallHeight;

  const floor = new THREE.Mesh(new THREE.BoxGeometry(houseConfig.size, 1, houseConfig.size), gray);
  floor.position.set(baseX, ground + 0.5, baseZ);
  houseGroup.add(floor);

  const wallGeometry = new THREE.BoxGeometry(houseConfig.size, wallHeight, 0.6);
  const wallN = new THREE.Mesh(wallGeometry, gray);
  wallN.position.set(baseX, ground + 0.5 + wallHeight / 2, baseZ - wallHalf);
  houseGroup.add(wallN);

  const doorHalf = houseConfig.doorWidth / 2;
  const wallSLeft = new THREE.Mesh(new THREE.BoxGeometry(half - doorHalf, wallHeight, 0.6), gray);
  wallSLeft.position.set(baseX - (doorHalf + (half - doorHalf) / 2), ground + 0.5 + wallHeight / 2, baseZ + wallHalf);
  houseGroup.add(wallSLeft);

  const wallSRight = new THREE.Mesh(new THREE.BoxGeometry(half - doorHalf, wallHeight, 0.6), gray);
  wallSRight.position.set(baseX + (doorHalf + (half - doorHalf) / 2), ground + 0.5 + wallHeight / 2, baseZ + wallHalf);
  houseGroup.add(wallSRight);

  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(houseConfig.doorWidth + 0.4, houseConfig.doorHeight + 0.6, 0.5), dark);
  doorFrame.position.set(baseX, ground + 0.5 + houseConfig.doorHeight / 2, baseZ + wallHalf - 0.1);
  houseGroup.add(doorFrame);

  houseDoorPivot = new THREE.Group();
  houseDoorPivot.position.set(baseX - doorHalf, ground + 0.5 + houseConfig.doorHeight / 2, baseZ + wallHalf - 0.25);
  houseDoorMesh = new THREE.Mesh(new THREE.BoxGeometry(houseConfig.doorWidth, houseConfig.doorHeight, 0.3), dark);
  houseDoorMesh.position.set(doorHalf, 0, 0);
  houseDoorPivot.add(houseDoorMesh);
  houseGroup.add(houseDoorPivot);

  const capBlock = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), dark);
  capBlock.position.set(baseX - 1, ground + 0.5 + houseConfig.doorHeight + 0.8, baseZ + wallHalf - 0.2);
  houseGroup.add(capBlock);
  const capBlock2 = capBlock.clone();
  capBlock2.position.set(baseX + 1, ground + 0.5 + houseConfig.doorHeight + 0.8, baseZ + wallHalf - 0.2);
  houseGroup.add(capBlock2);

  const wallGeometrySide = new THREE.BoxGeometry(0.6, wallHeight, houseConfig.size);
  const wallE = new THREE.Mesh(wallGeometrySide, gray);
  wallE.position.set(baseX + wallHalf, ground + 0.5 + wallHeight / 2, baseZ);
  houseGroup.add(wallE);

  const wallW = new THREE.Mesh(wallGeometrySide, gray);
  wallW.position.set(baseX - wallHalf, ground + 0.5 + wallHeight / 2, baseZ);
  houseGroup.add(wallW);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(houseConfig.size + 0.6, Math.max(1.8, wallHeight * 0.25), houseConfig.size + 0.6),
    dark
  );
  roof.position.set(baseX, ground + 0.5 + wallHeight + (wallHeight * 0.25) / 2, baseZ);
  houseGroup.add(roof);

  const windowGeometry = new THREE.BoxGeometry(2.2, 2.2, 0.2);
  const windowSideGeometry = new THREE.BoxGeometry(0.2, 2.2, 2.2);
  const windowHeight = ground + 0.5 + wallHeight * 0.65;

  const northOffsets = [-10, 0, 10];
  northOffsets.forEach((dx) => {
    const win = new THREE.Mesh(windowGeometry, glass);
    win.position.set(baseX + dx, windowHeight, baseZ - wallHalf + 0.35);
    houseGroup.add(win);
  });

  const southOffsets = [-10, 10];
  southOffsets.forEach((dx) => {
    const win = new THREE.Mesh(windowGeometry, glass);
    win.position.set(baseX + dx, windowHeight, baseZ + wallHalf - 0.35);
    houseGroup.add(win);
  });

  const winSouthLeft = new THREE.Mesh(windowGeometry, glass);
  winSouthLeft.position.set(baseX - 6, windowHeight, baseZ + wallHalf - 0.35);
  houseGroup.add(winSouthLeft);

  const eastOffsets = [-8, 8];
  eastOffsets.forEach((dz) => {
    const win = new THREE.Mesh(windowSideGeometry, glass);
    win.position.set(baseX + wallHalf - 0.35, windowHeight, baseZ + dz);
    houseGroup.add(win);
  });

  const westOffsets = [-8, 8];
  westOffsets.forEach((dz) => {
    const win = new THREE.Mesh(windowSideGeometry, glass);
    win.position.set(baseX - wallHalf + 0.35, windowHeight, baseZ + dz);
    houseGroup.add(win);
  });

  house = houseGroup;
  scene.add(houseGroup);
}

function placeBlock() {
  const blockId = actionBar[state.activeSlot];
  if (!blockId || !terrain) return;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(terrain, false);
  if (!hits.length) return;
  const hit = hits[0];
  const halfX = (state.width - 1) / 2;
  const halfZ = (state.height - 1) / 2;
  const snappedX = Math.round(hit.point.x + halfX) - halfX;
  const snappedZ = Math.round(hit.point.z + halfZ) - halfZ;
  const ground = sampleHeight(snappedX, snappedZ);
  const key = `${snappedX},${snappedZ}`;
  const entry = placedBlocks.get(key);
  const topHeight = entry ? entry.height : ground + 1;
  let object;
  if (blockId === "torch") {
    object = createTorchPlacement(snappedX, topHeight, snappedZ);
  } else {
    object = cloneRenderable(ensureBlockPrototype(blockId));
    object.position.set(snappedX, topHeight + 0.5, snappedZ);
  }
  scene.add(object);
  if (entry) {
    entry.objects.push(object);
    entry.height = topHeight + 1;
  } else {
    placedBlocks.set(key, { objects: [object], height: topHeight + 1 });
  }
  if (debugEl) {
    debugEl.textContent = `Placed ${blockId} at (${snappedX}, ${Math.round(topHeight)}) z:${snappedZ}`;
  }
  playPlaceSound();
}

function placeFromSlot(index) {
  if (!actionBar[index]) return;
  state.activeSlot = index;
  renderActionBar();
  updatePointerFromScreen(lastMouse.x, lastMouse.y);
  placeBlock();
}

function deleteBlockAtCursor() {
  let removed = false;
  if (placedBlocks.size) {
    raycaster.setFromCamera(pointer, camera);
    const objects = [];
    placedBlocks.forEach((entry) => {
      objects.push(...entry.objects);
    });
    const hits = raycaster.intersectObjects(objects, true);
    if (hits.length) {
      const hitObject = hits[0].object;
      placedBlocks.forEach((entry, key) => {
        const index = entry.objects.findIndex((object) => {
          let current = hitObject;
          while (current) {
            if (current === object) return true;
            current = current.parent;
          }
          return false;
        });
        if (index !== -1) {
          const object = entry.objects.splice(index, 1)[0];
          const { x, z } = object.position;
          disposeObject(object);
          if (entry.objects.length === 0) {
            placedBlocks.delete(key);
          } else {
            const ground = sampleHeight(x, z);
            entry.height = ground + entry.objects.length;
          }
          playRemoveSound();
          removed = true;
        }
      });
    }
  }
  if (removed) return true;
  return mineTerrainAtCursor();
}

function mineTerrainAtCursor() {
  if (!terrain) return false;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(terrain, false);
  if (!hits.length) return false;

  const hit = hits[0];
  const instanceId = hit.instanceId;
  if (instanceId == null) return false;

  const xIndex = instanceId % state.width;
  const zIndex = Math.floor(instanceId / state.width);
  const dataIndex = zIndex * state.width + xIndex;
  const step = TERRAIN_MINE_STEP / state.heightScale;
  const nextValue = Math.max(0, state.data[dataIndex] - step);
  if (nextValue === state.data[dataIndex]) return false;

  state.data[dataIndex] = nextValue;
  updateTerrainColumnMatrix(xIndex, zIndex, instanceId);
  terrain.instanceMatrix.needsUpdate = true;

  const halfX = (state.width - 1) / 2;
  const halfZ = (state.height - 1) / 2;
  const worldX = xIndex - halfX;
  const worldZ = zIndex - halfZ;
  const key = `${worldX},${worldZ}`;
  const entry = placedBlocks.get(key);
  if (entry) {
    entry.objects.forEach((object) => {
      object.position.y -= TERRAIN_MINE_STEP;
    });
    entry.height = Math.max(sampleHeight(worldX, worldZ) + 1, entry.height - TERRAIN_MINE_STEP);
  }

  if (debugEl) {
    debugEl.textContent = `Mined terrain at (${worldX}, ${Math.round(sampleHeight(worldX, worldZ))}) z:${worldZ}`;
  }
  playRemoveSound();
  return true;
}

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } else if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playTone({ freq = 220, duration = 0.12, type = "sine", gain = 0.08 }) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.value = gain;
  osc.connect(amp).connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  amp.gain.setValueAtTime(gain, now);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}

function playPlaceSound() {
  playTone({ freq: 480, duration: 0.08, type: "square", gain: 0.05 });
}

function playRemoveSound() {
  playTone({ freq: 160, duration: 0.12, type: "sawtooth", gain: 0.05 });
}

function playStepSound() {
  playTone({ freq: 220 + Math.random() * 40, duration: 0.06, type: "triangle", gain: 0.03 });
}

function setupMobileControls() {
  // Try to lock screen to landscape
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock("landscape").catch((err) => console.warn("Orientation lock failed:", err));
  }

  const gesturePad = document.getElementById("gesture-pad");
  const btnUp = document.getElementById("btn-up");
  const btnDown = document.getElementById("btn-down");
  const btnTurbo = document.getElementById("btn-turbo");

  if (!gesturePad || !btnUp || !btnDown || !btnTurbo) return;

  // Gesture pad – left joystick (move + turn)
  let gestureOrigin = null;
  const DEAD_ZONE = 8;
  const MAX_DIST = 50;

  function applyGesture(cx, cy) {
    if (!gestureOrigin) return;
    const dx = cx - gestureOrigin.x;
    const dy = cy - gestureOrigin.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    state.turn.left = adx > DEAD_ZONE && dx < 0;
    state.turn.right = adx > DEAD_ZONE && dx > 0;
    if (ady > DEAD_ZONE) {
      const norm = Math.max(-1, Math.min(1, dy / MAX_DIST));
      state.move.forward = norm;
    } else {
      state.move.forward = 0;
    }
  }

  gesturePad.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    gestureOrigin = remapToLandscape(t.clientX, t.clientY);
    ensureAudio();
  }, { passive: false });

  gesturePad.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    const mapped = remapToLandscape(t.clientX, t.clientY);
    applyGesture(mapped.x, mapped.y);
  }, { passive: false });

  gesturePad.addEventListener("touchend", (e) => {
    e.preventDefault();
    gestureOrigin = null;
    state.move.forward = 0;
    state.turn.left = false;
    state.turn.right = false;
  }, { passive: false });

  // Up button – jump / fly up; double-tap toggles fly mode
  let lastUpTap = 0;
  btnUp.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ensureAudio();
    const now = Date.now();
    if (now - lastUpTap < 350) {
      // double-tap: toggle fly mode
      state.flying = !state.flying;
      if (state.flying) {
        state.flyY = camera.position.y;
        state.flyVel = 0;
      }
      btnUp.classList.toggle("fly-active", state.flying);
    }
    lastUpTap = now;
    if (state.flying) {
      state.flyUp = true;
    } else if (state.jumpOffset === 0) {
      state.jumpVel = 22;
    }
    btnUp.classList.add("pressed");
  });

  btnUp.addEventListener("pointerup", (e) => {
    e.preventDefault();
    state.flyUp = false;
    btnUp.classList.remove("pressed");
  });

  btnUp.addEventListener("pointerleave", () => {
    state.flyUp = false;
    btnUp.classList.remove("pressed");
  });

  // Down button – fly down
  btnDown.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    state.flyDown = true;
    btnDown.classList.add("pressed");
    ensureAudio();
  });

  btnDown.addEventListener("pointerup", (e) => {
    e.preventDefault();
    state.flyDown = false;
    btnDown.classList.remove("pressed");
  });

  btnDown.addEventListener("pointerleave", () => {
    state.flyDown = false;
    btnDown.classList.remove("pressed");
  });

  // Turbo button – temporary speed boost
  btnTurbo.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    state.move.boost = true;
    btnTurbo.classList.add("pressed");
    ensureAudio();
  });

  btnTurbo.addEventListener("pointerup", (e) => {
    e.preventDefault();
    state.move.boost = false;
    btnTurbo.classList.remove("pressed");
  });

  btnTurbo.addEventListener("pointerleave", () => {
    state.move.boost = false;
    btnTurbo.classList.remove("pressed");
  });

  // Pitch control – swipe up/down outside the movement box pitches the camera
  let pitchTouchId = null;
  let pitchTouchOriginY = null;
  const PITCH_SENSITIVITY = 0.003;

  document.addEventListener("touchstart", (e) => {
    if (pitchTouchId !== null) return;
    for (const t of e.changedTouches) {
      if (gesturePad.contains(t.target)) continue;
      pitchTouchId = t.identifier;
      pitchTouchOriginY = remapToLandscape(t.clientX, t.clientY).y;
      break;
    }
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (pitchTouchId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== pitchTouchId) continue;
      const mapped = remapToLandscape(t.clientX, t.clientY);
      const dy = mapped.y - pitchTouchOriginY;
      state.pitch -= dy * PITCH_SENSITIVITY;
      state.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, state.pitch));
      pitchTouchOriginY = mapped.y;
      break;
    }
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === pitchTouchId) {
        pitchTouchId = null;
        pitchTouchOriginY = null;
        break;
      }
    }
  }, { passive: true });
}

heightmapInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  loadHeightmapFile(file);
});

loadUrlButton.addEventListener("click", () => {
  loadHeightmapUrl(heightmapUrlInput.value.trim());
});

if (orbitToggleButton) {
  orbitToggleButton.addEventListener("click", () => toggleFastMode());
}

window.addEventListener("keydown", (event) => handleKey(event, true));
window.addEventListener("keyup", (event) => handleKey(event, false));
window.addEventListener("resize", onResize);

altitudeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setAltitude(Number(btn.dataset.alt)));
});

setAltitude(state.altitudeTarget);
setupPointerLock();
buildInventory();
if (heightmapPanel) heightmapPanel.open = false;
if (inventoryPanel) inventoryPanel.open = false;
applyHeightmap(createDefaultHeightmap());
setupMobileControls();
requestAnimationFrame(animate);
