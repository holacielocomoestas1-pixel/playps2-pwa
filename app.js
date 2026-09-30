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

// ── Biblioteca homebrew + carga desde URL ──────────────────────────
let hbCatalog = null;

async function loadHomebrewCatalog() {
  if (hbCatalog) return hbCatalog;
  try {
    const r = await fetch("homebrew/catalog.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    hbCatalog = Array.isArray(j.juegos) ? j.juegos : [];
  } catch (e) {
    console.warn("homebrew catalog:", e);
    hbCatalog = [];
  }
  return hbCatalog;
}

// Escribe en el FS del emulador creando los directorios padre si hace falta.
function fsWriteFile(FS, path, data) {
  const clean = path.replace(/^\/+/, "");
  const parts = clean.split("/").filter(Boolean);
  let dir = "";
  for (let i = 0; i < parts.length - 1; i++) {
    dir += "/" + parts[i];
    try { FS.mkdir(dir); } catch (e) { /* ya existe */ }
  }
  const stream = FS.open("/" + clean, "w+");
  FS.write(stream, data, 0, data.length, 0);
  FS.close(stream);
}

function bootElfByName(name) {
  PlayModule.bootElf(name);
  overlay.classList.add("hidden");
  canvas.focus();
}

function bootDiscByName(name) {
  PlayModule.bootDiscImage(name);
  overlay.classList.add("hidden");
  canvas.focus();
}

async function bootHomebrew(entry) {
  if (!PlayModule) { setStatus("El núcleo aún no está listo."); return; }
  const files = entry.archivos || [];
  try {
    if (entry.tipo === "iso") {
      setStatus("Descargando " + entry.titulo + "…");
      const r = await fetch("homebrew/ps2/" + entry.id + "/" + files[0]);
      if (!r.ok) throw new Error("HTTP " + r.status);
      PlayModule.discImageDevice.setFile(await r.blob());
      setStatus("Arrancando " + entry.titulo + " …");
      bootDiscByName(entry.boot);
      return;
    }
    for (let i = 0; i < files.length; i++) {
      const rel = files[i];
      setStatus("Descargando " + entry.titulo + "… " + (i + 1) + "/" + files.length);
      const r = await fetch("homebrew/ps2/" + entry.id + "/" + rel);
      if (!r.ok) throw new Error("HTTP " + r.status + " — " + rel);
      fsWriteFile(PlayModule.FS, rel, new Uint8Array(await r.arrayBuffer()));
    }
    setStatus("Arrancando " + entry.titulo + " …");
    bootElfByName(entry.boot);
  } catch (e) {
    console.error(e);
    setStatus("No se pudo arrancar: " + (e && e.message ? e.message : e));
  }
}

async function bootFromUrl(rawUrl) {
  const url = (rawUrl || "").trim();
  if (!url) return;
  if (!PlayModule) { setStatus("El núcleo aún no está listo."); return; }
  let name = "";
  try {
    name = decodeURIComponent(new URL(url, location.href).pathname.split("/").filter(Boolean).pop() || "");
  } catch (e) { setStatus("Enlace no válido."); return; }
  if (!name || name.lastIndexOf(".") === -1) { setStatus("El enlace debe apuntar a un archivo (.iso, .elf, …)."); return; }
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  setStatus("Descargando " + name + " …");
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    if (ext === ".elf") {
      fsWriteFile(PlayModule.FS, name, new Uint8Array(await r.arrayBuffer()));
      setStatus("Arrancando " + name + " …");
      bootElfByName(name);
    } else {
      PlayModule.discImageDevice.setFile(await r.blob());
      setStatus("Arrancando " + name + " …");
      bootDiscByName(name);
    }
  } catch (e) {
    console.error(e);
    setStatus("No se pudo cargar el enlace: " + (e && e.message ? e.message : e) + " — ¿permite CORS el servidor?");
  }
}

async function renderHomebrew() {
  const grid = document.getElementById("hbGrid");
  if (!grid) return;
  const catalog = await loadHomebrewCatalog();
  if (!catalog.length) {
    grid.innerHTML = "";
    const p = document.createElement("p");
    p.className = "hb-loading";
    p.textContent = "Catálogo no disponible.";
    grid.appendChild(p);
    return;
  }
  grid.innerHTML = "";
  for (const entry of catalog) {
    const card = document.createElement("div");
    card.className = "hb-card";
    const cover = document.createElement("div");
    cover.className = "hb-cover";
    cover.textContent = entry.titulo.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const hue = [...entry.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    cover.style.background = "hsl(" + hue + " 45% 36%)";
    const body = document.createElement("div");
    body.className = "hb-body";
    const title = document.createElement("div");
    title.className = "hb-title";
    title.textContent = entry.titulo;
    const meta = document.createElement("div");
    meta.className = "hb-meta";
    meta.textContent = (entry.genero || "") + " · " + (entry.tamano || "");
    const desc = document.createElement("div");
    desc.className = "hb-desc";
    desc.textContent = entry.descripcion || "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "▶ Jugar";
    btn.addEventListener("click", () => bootHomebrew(entry));
    body.append(title, meta, desc, btn);
    card.append(cover, body);
    grid.appendChild(card);
  }
}

document.getElementById("urlBtn").addEventListener("click", () =>
  bootFromUrl(document.getElementById("urlInput").value));
document.getElementById("urlInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); bootFromUrl(e.target.value); }
});

renderHomebrew();

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
