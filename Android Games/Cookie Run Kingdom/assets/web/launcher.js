const CONFIG = {
  wasmFile: "game.wasm",
  canvasId: "game-canvas",
  width: 1280,
  height: 720,
  fps: 60,
  fullscreen: true
};
const state = {
  wasm: null,
  instance: null,
  memory: null,
  canvas: null,
  ctx: null,
  lastTime: 0,
  accumulator: 0,
  running: false,
  scale: 1,
  offsetX: 0,
  offsetY: 0
};
const noop = () => {};
const wasi = {
  fd_write(fd, iovs, iovsLen, nwritten) {
    if (state.memory) new DataView(state.memory.buffer).setUint32(nwritten, 0, true);
    return 0;
  },
  fd_close: noop,
  fd_seek: () => 0,
  fd_read: () => 0,
  fd_fdstat_get: () => 0,
  fd_prestat_get: () => 8,
  fd_prestat_dir_name: () => 0,
  environ_sizes_get: (c, b) => {
    if (state.memory) {
      const v = new DataView(state.memory.buffer);
      v.setUint32(c, 0, true); v.setUint32(b, 0, true);
    }
    return 0;
  },
  environ_get: noop,
  args_sizes_get: (c, b) => {
    if (state.memory) {
      const v = new DataView(state.memory.buffer);
      v.setUint32(c, 0, true); v.setUint32(b, 0, true);
    }
    return 0;
  },
  args_get: noop,
  clock_time_get: (id, precision, result) => {
    if (state.memory) {
      const v = new DataView(state.memory.buffer);
      const ns = BigInt(Math.floor(performance.now() * 1e6));
      v.setBigUint64(result, ns, true);
    }
    return 0;
  },
  proc_exit(code) { if (code) console.warn("WASI proc_exit", code); },
  random_get(ptr, len) {
    if (state.memory) crypto.getRandomValues(new Uint8Array(state.memory.buffer, ptr, len));
    return 0;
  },
  sched_yield: () => 0,
  poll_oneoff: () => 0,
  path_open: () => 8
};
function log(...args) { console.debug("[WASM]", ...args); }
function exportsOf() { return state.instance?.exports || {}; }
function call(name, ...args) {
  const fn = exportsOf()[name];
  if (typeof fn !== "function") return undefined;
  try { return fn(...args); } catch (e) { console.error(name, e); return undefined; }
}
function resizeCanvas() {
  const c = state.canvas;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(vw / CONFIG.width, vh / CONFIG.height);
  state.scale = scale;
  state.offsetX = (vw - CONFIG.width * scale) / 2;
  state.offsetY = (vh - CONFIG.height * scale) / 2;
  c.style.width = `${CONFIG.width * scale}px`;
  c.style.height = `${CONFIG.height * scale}px`;
  c.style.left = `${state.offsetX}px`;
  c.style.top = `${state.offsetY}px`;
  c.width = Math.round(CONFIG.width * dpr);
  c.height = Math.round(CONFIG.height * dpr);
  state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function setupCanvas() {
  state.canvas = document.getElementById(CONFIG.canvasId);
  if (!state.canvas) throw new Error(`Missing #${CONFIG.canvasId}`);
  state.ctx = state.canvas.getContext("2d", { alpha: false, desynchronized: true });
  state.canvas.style.position = "fixed";
  state.canvas.style.transformOrigin = "top left";
  prepareRuntime(); resizeCanvas();
  addEventListener("resize", resizeCanvas, { passive: true });
}
function preventPageGestures() {
  document.documentElement.style.touchAction = "none";
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#000";
}
function applyCanvasHints() {
  state.canvas.style.imageRendering = "auto";
  state.canvas.style.contain = "strict";
  state.canvas.style.willChange = "transform";
  state.canvas.style.transform = "translateZ(0)";
}
function installInputFallbacks() {
  addEventListener("blur", () => call("on_focus", 0));
  addEventListener("focus", () => call("on_focus", 1));
  addEventListener("wheel", e => call("on_wheel", e.deltaX, e.deltaY), { passive: true });
}
function prepareRuntime() {
  preventPageGestures();
  applyCanvasHints();
  installInputFallbacks();
}
addEventListener("orientationchange", resizeCanvas);
function pointerPosition(e) {
  const r = state.canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / state.scale,
    y: (e.clientY - r.top) / state.scale
  };
}
function pointerEvent(name, e) {
  const p = pointerPosition(e);
  call(name, p.x, p.y, e.pointerId || 0, e.buttons || 0);
}
function setupInput() {
  const c = state.canvas;
  c.addEventListener("pointerdown", e => {
    e.preventDefault(); c.setPointerCapture?.(e.pointerId);
    pointerEvent("on_touch_down", e);
  }, { passive: false });
  c.addEventListener("pointermove", e => {
    if (e.buttons) pointerEvent("on_touch_move", e);
  }, { passive: true });
  c.addEventListener("pointerup", e => {
    e.preventDefault(); pointerEvent("on_touch_up", e);
  }, { passive: false });
  c.addEventListener("pointercancel", e => pointerEvent("on_touch_cancel", e));
  addEventListener("keydown", e => {
    call("on_key_down", e.keyCode, e.repeat ? 1 : 0);
  });
  addEventListener("keyup", e => call("on_key_up", e.keyCode));
  c.addEventListener("contextmenu", e => e.preventDefault());
}
function importObject() {
  return {
    env: {
      memory: state.memory,
      abort: noop,
      console_log: noop,
      now_ms: () => performance.now(),
      js_random: () => Math.random()
    },
    wasi_snapshot_preview1: wasi,
    wasi_unstable: wasi
  };
}
async function instantiate() {
  state.memory ||= new WebAssembly.Memory({ initial: 256, maximum: 512 });
  const response = await fetch(CONFIG.wasmFile, { cache: "no-store" });
  let result;
  try {
    if (WebAssembly.instantiateStreaming) {
      result = await WebAssembly.instantiateStreaming(response, importObject());
    }
  } catch (e) {
    log("instantiateStreaming fallback", e);
  }
  if (!result) {
    const bytes = await (await fetch(CONFIG.wasmFile, { cache: "no-store" })).arrayBuffer();
    result = await WebAssembly.instantiate(bytes, importObject());
  }
  state.instance = result.instance;
  state.wasm = result.module;
  state.memory = exportsOf().memory || state.memory;
  if (!state.memory) {
    const pages = exportsOf().memory_pages?.() || 256;
    state.memory = new WebAssembly.Memory({ initial: pages });
  }
}
function initGame() {
  call("init", CONFIG.width, CONFIG.height);
  call("resize", CONFIG.width, CONFIG.height);
  call("start");
  resizeCanvas();
}
function renderFramebuffer(ptr, len) {
  if (!state.memory || !len) return false;
  const max = CONFIG.width * CONFIG.height * 4;
  const bytes = new Uint8ClampedArray(state.memory.buffer, ptr, Math.min(len, max));
  if (bytes.length < max) return false;
  const image = new ImageData(bytes.slice(0, max), CONFIG.width, CONFIG.height);
  state.ctx.putImageData(image, 0, 0);
  return true;
}
function render() {
  if (call("render") !== undefined) return;
  const ptr = call("framebuffer_ptr");
  const len = call("framebuffer_len");
  if (Number.isInteger(ptr) && Number.isInteger(len) && renderFramebuffer(ptr, len)) return;
  renderFramebuffer(0, CONFIG.width * CONFIG.height * 4);
}
function tick(time) {
  if (!state.running) return;
  const dt = Math.min((time - state.lastTime) / 1000, 0.1);
  state.lastTime = time;
  state.accumulator += dt;
  const fixed = 1 / Math.max(1, CONFIG.fps);
  while (state.accumulator >= fixed) {
    if (call("tick", fixed) === undefined &&
        call("update", fixed) === undefined) call("step", fixed);
    state.accumulator -= fixed;
  }
  render();
  requestAnimationFrame(tick);
}
function setFullscreen() {
  if (!CONFIG.fullscreen || document.fullscreenElement) return;
  document.documentElement.requestFullscreen?.().catch(noop);
}
async function start() {
  setupCanvas();
  setupInput();
  await instantiate();
  initGame();
  state.running = true;
  setFullscreen();
  requestAnimationFrame(tick);
}
window.__wasmLauncher = {
  CONFIG,
  state,
  start,
  call,
  resize: resizeCanvas,
  fullscreen: setFullscreen,
  stop() { state.running = false; call("stop"); }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) call("pause");
  else call("resume");
});
window.addEventListener("load", () => start().catch(e => {
  console.error("WASM launcher failed", e);
  document.body.dataset.wasmError = "true";
}));
