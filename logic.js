const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

function randomCell(gridSize, occupied, rng) {
  const open = [];
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const cell = { x, y };
      if (!occupied.some((pos) => sameCell(pos, cell))) {
        open.push(cell);
      }
    }
  }
  if (open.length === 0) return null;
  const idx = Math.floor(rng() * open.length);
  return open[idx];
}

function createInitialState({ gridSize = 20, rng = Math.random } = {}) {
  const start = { x: Math.floor(gridSize / 2), y: Math.floor(gridSize / 2) };
  const snake = [start, { x: start.x - 1, y: start.y }];
  const food = randomCell(gridSize, snake, rng);
  return {
    gridSize,
    snake,
    direction: "right",
    pendingDirection: "right",
    food,
    score: 0,
    alive: true,
    rng,
  };
}

function isOpposite(a, b) {
  return (
    (a === "up" && b === "down") ||
    (a === "down" && b === "up") ||
    (a === "left" && b === "right") ||
    (a === "right" && b === "left")
  );
}

function setDirection(state, next) {
  if (!DIRECTIONS[next]) return state;
  if (isOpposite(state.direction, next)) return state;
  return { ...state, pendingDirection: next };
}

function step(state) {
  if (!state.alive) return state;

  const direction = state.pendingDirection;
  const delta = DIRECTIONS[direction];
  const head = state.snake[0];
  const nextHead = { x: head.x + delta.x, y: head.y + delta.y };

  // wall collision
  if (
    nextHead.x < 0 ||
    nextHead.y < 0 ||
    nextHead.x >= state.gridSize ||
    nextHead.y >= state.gridSize
  ) {
    return { ...state, alive: false, direction };
  }

  // body collision (excluding tail if it moves)
  const body = state.snake.slice(0, -1);
  if (body.some((pos) => sameCell(pos, nextHead))) {
    return { ...state, alive: false, direction };
  }

  let nextSnake = [nextHead, ...state.snake];
  let nextFood = state.food;
  let nextScore = state.score;

  if (state.food && sameCell(nextHead, state.food)) {
    nextScore += 1;
    nextFood = randomCell(state.gridSize, nextSnake, state.rng);
  } else {
    nextSnake = nextSnake.slice(0, -1);
  }

  return {
    ...state,
    snake: nextSnake,
    food: nextFood,
    score: nextScore,
    direction,
  };
}

export { createInitialState, setDirection, step, DIRECTIONS };
