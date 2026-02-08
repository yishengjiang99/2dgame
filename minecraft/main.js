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
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0xa7c4ff, 1);
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa7c4ff, 60, 380);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 800);

const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(80, 140, 40);
scene.add(sun);

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
];

const actionBar = Array.from({ length: 5 }, () => null);
const blockMeshes = new Map();

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

function createDefaultHeightmap() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x / size - 0.5;
      const ny = y / size - 0.5;
      const d = Math.sqrt(nx * nx + ny * ny);
      const ridge = Math.max(0, 1 - d * 1.4);
      const noise = (Math.sin(x * 0.12) + Math.cos(y * 0.08) + Math.sin((x + y) * 0.05)) * 0.15;
      const height = Math.min(1, Math.max(0, ridge + noise));
      const v = Math.floor(height * 255);
      const idx = (y * size + x) * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
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

  const geometry = new THREE.BoxGeometry(1.02, 1.02, 1.02);
  const material = new THREE.MeshStandardMaterial({
    color: 0x496c3f,
    roughness: 0.85,
    metalness: 0.05,
    flatShading: true,
  });

  const count = state.width * state.height;
  terrain = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  const halfX = (state.width - 1) / 2;
  const halfZ = (state.height - 1) / 2;
  let i = 0;
  for (let z = 0; z < state.height; z += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const heightValue = state.data[z * state.width + x];
      const y = heightValue * state.heightScale;
      dummy.position.set(x - halfX, y + 0.5, z - halfZ);
      dummy.updateMatrix();
      terrain.setMatrixAt(i, dummy.matrix);
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
  state.altitude += (state.altitudeTarget - state.altitude) * Math.min(1, delta * 6);
  const gravity = 90;
  state.jumpVel -= gravity * delta;
  state.jumpOffset += state.jumpVel * delta;
  if (state.jumpOffset < 0) {
    state.jumpOffset = 0;
    state.jumpVel = 0;
  }
  camera.position.y = ground + state.altitude + state.jumpOffset;

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
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(time) {
  const delta = Math.min(0.05, (time - (animate.lastTime || time)) / 1000);
  animate.lastTime = time;
  updateCamera(delta);
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
    case "Digit5":
      if (active) placeFromSlot(4);
      break;
    case "Space":
      if (active && state.jumpOffset === 0) {
        state.jumpVel = 22;
      }
      break;
    case "KeyR":
      if (active) respawn();
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
    }
  }
});

function updatePointerFromScreen(x, y) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((x - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((y - rect.top) / rect.height) * 2 + 1;
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

  for (let i = 0; i < Math.min(5, blockCatalog.length); i += 1) {
    if (!actionBar[i]) actionBar[i] = blockCatalog[i].id;
  }
  if (actionBar.length >= 4) {
    actionBar[0] = "brick";
    actionBar[2] = "lava";
    actionBar[3] = "grass";
  }

  if (!state.selectedItem && blockCatalog.length) {
    state.selectedItem = blockCatalog[0].id;
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
    slot.textContent = block ? `${index + 1}: ${block.label}` : `${index + 1}: Empty`;
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

function ensureBlockMesh(blockId) {
  if (blockMeshes.has(blockId)) return blockMeshes.get(blockId);
  const block = blockCatalog.find((b) => b.id === blockId);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: block.color, roughness: 0.7, metalness: 0.1 });
  const mesh = new THREE.Mesh(geometry, material);
  blockMeshes.set(blockId, mesh);
  return mesh;
}

function clearPlacedBlocks() {
  placedBlocks.forEach((entry) => {
    entry.meshes.forEach((mesh) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
  });
  placedBlocks.clear();
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
  const mesh = ensureBlockMesh(blockId).clone();
  mesh.position.set(snappedX, topHeight + 0.5, snappedZ);
  scene.add(mesh);
  if (entry) {
    entry.meshes.push(mesh);
    entry.height = topHeight + 1;
  } else {
    placedBlocks.set(key, { meshes: [mesh], height: topHeight + 1 });
  }
  if (debugEl) {
    debugEl.textContent = `Placed ${blockId} at (${snappedX}, ${Math.round(topHeight + 1)}) z:${snappedZ}`;
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
  if (!placedBlocks.size) return false;
  raycaster.setFromCamera(pointer, camera);
  const meshes = [];
  placedBlocks.forEach((entry) => {
    meshes.push(...entry.meshes);
  });
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return false;
  const hitMesh = hits[0].object;
  let removed = false;
  placedBlocks.forEach((entry, key) => {
    const index = entry.meshes.indexOf(hitMesh);
    if (index !== -1) {
      const mesh = entry.meshes.splice(index, 1)[0];
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      if (entry.meshes.length === 0) {
        placedBlocks.delete(key);
      } else {
        const { x, z } = mesh.position;
        const ground = sampleHeight(x, z);
        entry.height = ground + entry.meshes.length;
      }
      playRemoveSound();
      removed = true;
    }
  });
  return removed;
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

heightmapInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  loadHeightmapFile(file);
});

loadUrlButton.addEventListener("click", () => {
  loadHeightmapUrl(heightmapUrlInput.value.trim());
});

window.addEventListener("keydown", (event) => handleKey(event, true));
window.addEventListener("keyup", (event) => handleKey(event, false));
window.addEventListener("resize", onResize);

altitudeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setAltitude(Number(btn.dataset.alt)));
});

setAltitude(state.altitudeTarget);
loadHeightmapUrl(new URL("./heightmap.png", import.meta.url).toString());
setupPointerLock();
buildInventory();
if (heightmapPanel) heightmapPanel.open = false;
if (inventoryPanel) inventoryPanel.open = true;
requestAnimationFrame(animate);
