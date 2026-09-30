// Shell PWA para Play! (PS2 en WebAssembly).
// Sigue el flujo oficial de js/play_browser del proyecto Play!:
//   Play(overrides) -> FS.mkdir("/work") -> discImageDevice -> ccall("initVm")
// Requiere cabeceras COOP/COEP (ver serve.py) por los pthreads del wasm.
import Play from "./vendor/Play.js";

const canvas = document.getElementById("outputCanvas");
const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const fileInput = document.getElementById("fileInput");
const fpsEl = document.getElementById("fps");

function setStatus(t) { statusEl.textContent = t; }

// Dispositivo de imagen de disco: el núcleo pide trozos del archivo del usuario
// mediante getFileSize()/read()/isDone() (ver DiscImageDevice.ts del proyecto).
class DiscImageDevice {
  constructor(module) { this.module = module; this.file = null; this.done = false; }
  setFile(f) { this.file = f; }
  getFileSize() {
    if (!this.file) throw new Error("No file set.");
    return this.file.size;
  }
  read(dstPtr, position, size) {
    if (!this.file) throw new Error("No file set.");
    this.done = false;
    this.file.slice(position, position + size).arrayBuffer().then((buf) => {
      this.module.HEAPU8.set(new Uint8Array(buf), dstPtr);
      this.done = true;
    });
  }
  isDone() { return this.done; }
}

let PlayModule = null;

async function boot() {
  try {
    const base = location.origin + location.pathname.slice(0, location.pathname.lastIndexOf("/"));
    const overrides = {
      locateFile: (path) => base + "/vendor/" + path,
      mainScriptUrlOrBlob: base + "/vendor/Play.js",
    };
    PlayModule = await Play(overrides);
    PlayModule.FS.mkdir("/work");
    PlayModule.discImageDevice = new DiscImageDevice(PlayModule);
    PlayModule.ccall("initVm", "", [], []);
    window.__playReady = true;
    window.__playModule = PlayModule;
    setStatus("Núcleo listo. Elige un archivo para arrancar.");
    // Contador de FPS del propio emulador (1 s de ventana).
    setInterval(() => {
      try {
        const f = PlayModule.getFrames();
        PlayModule.clearStats();
        fpsEl.textContent = f + " f/s";
      } catch (e) { /* aún no inicializado */ }
    }, 1000);
  } catch (e) {
    console.error(e);
    setStatus("Error al iniciar el núcleo: " + (e && e.message ? e.message : e));
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file || !PlayModule) return;
  const name = file.name;
  const dot = name.lastIndexOf(".");
  if (dot === -1) { setStatus("El archivo necesita extensión (.iso, .elf, …)."); return; }
  const ext = name.slice(dot).toLowerCase();
  setStatus("Arrancando " + name + " …");
  try {
    if (ext === ".elf") {
      const data = new Uint8Array(await file.arrayBuffer());
      const stream = PlayModule.FS.open(name, "w+");
      PlayModule.FS.write(stream, data, 0, data.length, 0);
      PlayModule.FS.close(stream);
      PlayModule.bootElf(name);
    } else {
      PlayModule.discImageDevice.setFile(file);
      PlayModule.bootDiscImage(name);
    }
    overlay.classList.add("hidden");
    canvas.focus();
  } catch (e) {
    console.error(e);
    setStatus("No se pudo arrancar: " + (e && e.message ? e.message : e));
  }
});

// Controles táctiles -> eventos de teclado sintéticos sobre el canvas,
// que es donde el núcleo registra sus callbacks de teclado.
function press(code, down) {
  const ev = new KeyboardEvent(down ? "keydown" : "keyup", { code, bubbles: true });
  canvas.dispatchEvent(ev);
}

document.querySelectorAll("[data-code]").forEach((btn) => {
  const code = btn.getAttribute("data-code");
  const down = (e) => { e.preventDefault(); btn.classList.add("active"); press(code, true); };
  const up = (e) => { e.preventDefault(); btn.classList.remove("active"); press(code, false); };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("pointerleave", up);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
});

boot();
