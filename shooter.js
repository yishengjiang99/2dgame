import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const viewport = document.getElementById("viewport");
const heightmapInput = document.getElementById("heightmap");
const heightmapUrlInput = document.getElementById("heightmap-url");
const loadUrlButton = document.getElementById("load-url");
const statusEl = document.getElementById("status");
const altitudeButtons = Array.from(document.querySelectorAll(".altitudes button"));

const state = {
  width: 256,
  height: 256,
  data: new Float32Array(256 * 256),
  size: 520,
  heightScale: 72,
  altitudeTarget: 6,
  altitude: 6,
  locked: false,
  yaw: 0,
  pitch: 0,
  moveYaw: 0,
  velocity: new THREE.Vector3(),
  move: { forward: 0, right: 0, boost: false },
  mouse: { left: false, right: false, forward: false },
  jumpVel: 0,
  jumpOffset: 0,
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

  buildTerrain();
}

function buildTerrain() {
  if (terrain) {
    scene.remove(terrain);
    terrain.geometry.dispose();
    terrain.material.dispose();
  }

  const segmentsX = state.width - 1;
  const segmentsZ = state.height - 1;
  const geometry = new THREE.PlaneGeometry(state.size, state.size, segmentsX, segmentsZ);
  geometry.rotateX(-Math.PI / 2);
  const vertices = geometry.attributes.position;

  for (let i = 0; i < vertices.count; i += 1) {
    const ix = i % state.width;
    const iz = Math.floor(i / state.width);
    const heightValue = state.data[iz * state.width + ix];
    const y = heightValue * state.heightScale;
    vertices.setY(i, y);
  }

  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x496c3f,
    roughness: 0.8,
    metalness: 0.1,
  });

  terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  scene.add(terrain);

  camera.position.set(0, state.heightScale + state.altitude, 0);
  state.yaw = 0;
  state.pitch = -0.2;
  state.moveYaw = 0;
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
  if (!state.locked) return;
  const sensitivity = 0.0023;
  if (state.mouse.left) {
    state.moveYaw -= event.movementX * sensitivity;
  }
  if (state.mouse.right) {
    state.yaw -= event.movementX * sensitivity;
    state.pitch -= event.movementY * sensitivity;
    state.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, state.pitch));
  }
}

function updateCamera(delta) {
  const speed = state.move.boost ? 60 : 36;
  const forward = Math.max(-1, Math.min(1, state.move.forward + (state.mouse.forward ? 1 : 0)));
  const right = state.move.right;

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
      state.move.right = active ? -1 : state.move.right === -1 ? 0 : state.move.right;
      break;
    case "KeyD":
    case "ArrowRight":
      state.move.right = active ? 1 : state.move.right === 1 ? 0 : state.move.right;
      break;
    case "ShiftLeft":
    case "ShiftRight":
      state.move.boost = active;
      break;
    case "Digit1":
      if (active) setAltitude(2);
      break;
    case "Digit2":
      if (active) setAltitude(6);
      break;
    case "Digit3":
      if (active) setAltitude(12);
      break;
    case "Digit4":
      if (active) setAltitude(24);
      break;
    case "Digit5":
      if (active) setAltitude(40);
      break;
    case "Space":
      if (active && state.jumpOffset === 0) {
        state.jumpVel = 22;
      }
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
  renderer.domElement.addEventListener("click", () => {
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener("pointerlockchange", () => {
    state.locked = document.pointerLockElement === renderer.domElement;
    statusEl.textContent = state.locked ? "Locked" : "Click to enter";
  });

  document.addEventListener("mousemove", handlePointerMove);
}

function updateMouseForward() {
  state.mouse.forward = state.mouse.left && state.mouse.right;
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
loadHeightmapUrl("heightmap.png");
setupPointerLock();
requestAnimationFrame(animate);
