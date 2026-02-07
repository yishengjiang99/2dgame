import { createInitialState, setDirection, step } from "./logic.js";

const canvas = document.getElementById("board");
const scoreEl = document.getElementById("score");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart");
const pauseBtn = document.getElementById("pause");
const controlButtons = document.querySelectorAll("[data-dir]");

const ctx = canvas.getContext("2d");
const gridSize = 20;
const cellSize = canvas.width / gridSize;

let state = createInitialState({ gridSize });
let running = true;
let lastTick = 0;
let tickMs = 140;

function reset() {
  state = createInitialState({ gridSize });
  running = true;
  lastTick = 0;
  render();
  updateStatus("");
}

function togglePause() {
  running = !running;
  updateStatus(running ? "" : "Paused");
}

function updateStatus(message) {
  if (!message) {
    statusEl.textContent = "";
    statusEl.classList.remove("visible");
    return;
  }
  statusEl.textContent = message;
  statusEl.classList.add("visible");
}

function handleDirection(next) {
  state = setDirection(state, next);
}

function handleKey(event) {
  const key = event.key.toLowerCase();
  if (key === "arrowup" || key === "w") handleDirection("up");
  if (key === "arrowdown" || key === "s") handleDirection("down");
  if (key === "arrowleft" || key === "a") handleDirection("left");
  if (key === "arrowright" || key === "d") handleDirection("right");
  if (key === " ") togglePause();
  if (key === "r") reset();
}

function renderGrid() {
  ctx.strokeStyle = "#e3e0d7";
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridSize; i += 1) {
    const pos = i * cellSize;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, canvas.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(canvas.width, pos);
    ctx.stroke();
  }
}

function renderSnake() {
  state.snake.forEach((segment, index) => {
    ctx.fillStyle = index === 0 ? "#153d26" : "#1f5d3a";
    ctx.fillRect(
      segment.x * cellSize,
      segment.y * cellSize,
      cellSize,
      cellSize
    );
  });
}

function renderFood() {
  if (!state.food) return;
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(
    state.food.x * cellSize,
    state.food.y * cellSize,
    cellSize,
    cellSize
  );
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderGrid();
  renderFood();
  renderSnake();
  scoreEl.textContent = String(state.score);
}

function loop(timestamp) {
  if (!lastTick) lastTick = timestamp;
  const delta = timestamp - lastTick;
  if (running && delta >= tickMs) {
    state = step(state);
    lastTick = timestamp;
    if (!state.alive) {
      running = false;
      updateStatus("Game Over — press Restart or R");
    }
  }
  render();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", handleKey);
restartBtn.addEventListener("click", reset);
pauseBtn.addEventListener("click", togglePause);
controlButtons.forEach((btn) =>
  btn.addEventListener("click", () => handleDirection(btn.dataset.dir))
);

reset();
requestAnimationFrame(loop);
