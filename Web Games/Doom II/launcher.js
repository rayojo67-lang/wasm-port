const CONFIG = {
  canvasId: "screen",
  wasmFile: "/wasmdoom.wasm",
  musicFile: "/wasmdoom.music.wasm",
  wadFile: "/wads/doom2.wad",
  tickRate: 35
};

const state = {
  doom: null,
  canvas: null,
  ctx: null,
  imageData: null,
  wad: null,
  palette: new Uint8ClampedArray(256 * 3),
  framebuffer: null,
  keys: new Set(),
  running: false
};

function $(id) {
  return document.getElementById(id);
}

function resizeCanvas() {
  const canvas = state.canvas;

  const scale = Math.min(
    window.innerWidth / 320,
    window.innerHeight / 200
  );

  canvas.style.width = `${Math.floor(320 * scale)}px`;
  canvas.style.height = `${Math.floor(200 * scale)}px`;
}

function setupCanvas() {
  state.canvas = $(CONFIG.canvasId);

  if (!state.canvas) {
    throw new Error(`Missing #${CONFIG.canvasId}`);
  }

  state.canvas.width = 320;
  state.canvas.height = 200;

  state.ctx = state.canvas.getContext("2d", {
    alpha: false,
    desynchronized: true
  });

  state.imageData = state.ctx.createImageData(320, 200);

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
}

function keyDown(key) {
  if (!state.doom) return;

  state.doom.wasmdoom_keydown(key);
}

function keyUp(key) {
  if (!state.doom) return;

  state.doom.wasmdoom_keyup(key);
}

function setupKeyboard() {
  window.addEventListener("keydown", event => {
    if (event.repeat) return;

    state.keys.add(event.code);

    const key = mapKey(event);

    if (key !== null) {
      event.preventDefault();
      keyDown(key);
    }
  });

  window.addEventListener("keyup", event => {
    state.keys.delete(event.code);

    const key = mapKey(event);

    if (key !== null) {
      event.preventDefault();
      keyUp(key);
    }
  });
}

function mapKey(event) {
  switch (event.code) {
    case "ArrowUp":
    case "KeyW":
      return 0xAE;

    case "ArrowDown":
    case "KeyS":
      return 0xAF;

    case "ArrowLeft":
    case "KeyA":
      return 0xAC;

    case "ArrowRight":
    case "KeyD":
      return 0xAD;

    case "ControlLeft":
    case "ControlRight":
      return 0xA0;

    case "Space":
      return 0x20;

    case "ShiftLeft":
    case "ShiftRight":
      return 0xA1;

    case "Escape":
      return 27;

    case "Enter":
      return 13;

    default:
      return null;
  }
}

function drawFrame() {
  const doom = state.doom;

  const framebufferPtr =
    doom.wasmdoom_get_framebuffer();

  const palettePtr =
    doom.wasmdoom_get_palette();

  const memory = new Uint8Array(
    doom.memory.buffer
  );

  const framebuffer =
    memory.subarray(
      framebufferPtr,
      framebufferPtr + 320 * 200
    );

  const palette =
    memory.subarray(
      palettePtr,
      palettePtr + 256 * 3
    );

  const pixels = state.imageData.data;

  for (let i = 0; i < framebuffer.length; i++) {
    const color = framebuffer[i] * 3;

    const out = i * 4;

    pixels[out] =
      palette[color];

    pixels[out + 1] =
      palette[color + 1];

    pixels[out + 2] =
      palette[color + 2];

    pixels[out + 3] = 255;
  }

  state.ctx.putImageData(
    state.imageData,
    0,
    0
  );
}

async function loadFile(url) {
  const response = await fetch(url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      `Failed to load ${url}: ${response.status}`
    );
  }

  return new Uint8Array(
    await response.arrayBuffer()
  );
}

async function loadWasm() {
  const wasmBytes =
    await loadFile(CONFIG.wasmFile);

  const result =
    await WebAssembly.instantiate(
      wasmBytes,
      {}
    );

  state.doom = result.instance.exports;
}

async function loadWad() {
  state.wad =
    await loadFile(CONFIG.wadFile);

  const ptr =
    state.doom.wasmdoom_wad_alloc(
      state.wad.length
    );

  if (!ptr) {
    throw new Error(
      "DOOM WASM could not allocate WAD memory."
    );
  }

  new Uint8Array(
    state.doom.memory.buffer,
    ptr,
    state.wad.length
  ).set(state.wad);
}

function bootDoom() {
  state.doom.wasmdoom_init();
}

function tick() {
  if (!state.running) return;

  state.doom.wasmdoom_tick();

  drawFrame();
}

function startLoop() {
  state.running = true;

  let last = performance.now();
  let accumulator = 0;

  const tickLength =
    1000 / CONFIG.tickRate;

  function frame(now) {
    if (!state.running) return;

    accumulator += now - last;
    last = now;

    while (accumulator >= tickLength) {
      tick();
      accumulator -= tickLength;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

async function start() {
  setupCanvas();
  setupKeyboard();

  console.log("Loading DOOM WASM...");

  await loadWasm();

  console.log("Loading DOOM II WAD...");

  await loadWad();

  console.log("loading wasm...");

  bootDoom();

  startLoop();

  console.log("LETS GOO!");
}

window.__doomLauncher = {
  start,
  stop() {
    state.running = false;
  },
  get engine() {
    return state.doom;
  }
};

start().catch(error => {
  console.error(error);

  const errorBox = $("error");

  if (errorBox) {
    errorBox.textContent =
      error.stack || error.message;
    errorBox.hidden = false;
  }
});
