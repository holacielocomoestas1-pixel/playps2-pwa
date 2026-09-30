#!/usr/bin/env python3
"""Verificación honesta de la PWA Play! PS2 con Chromium real (headless).

- Sirve ~/workspace/emulador/ps2 con serve.py (cabeceras COOP/COEP).
- Navega a la página, espera a que el módulo wasm inicialice (window.__playReady).
- Lee el contador de FPS del propio emulador (getFrames, ventana de 1 s).
- Toma captura de la UI booteada.
Sin captura -> NO VERIFICADO.
"""
import base64, json, os, subprocess, sys, time, urllib.request
import websocket

CHROME = os.path.expanduser("~/.cache/ms-playwright/chromium-1193/chrome-linux/chrome")
TRACK = os.path.expanduser("~/workspace/emulador/ps2")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9336
SERVEPORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8091
OUTDIR = os.path.join(TRACK, "verificacion")
os.makedirs(OUTDIR, exist_ok=True)
OUT = os.path.join(OUTDIR, "play-ui-boot.png")
W, H = 1280, 800

server = subprocess.Popen([sys.executable, os.path.join(TRACK, "serve.py"), str(SERVEPORT)],
                          cwd=TRACK, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

proc = subprocess.Popen([
    CHROME, "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
    "--autoplay-policy=no-user-gesture-required", "--mute-audio",
    "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "about:blank",
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def wait_debugger(timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=3) as r:
                pages = json.load(r)
            for p in pages:
                if p.get("webSocketDebuggerUrl"):
                    return p["webSocketDebuggerUrl"]
        except Exception:
            time.sleep(0.5)
    raise RuntimeError("sin debugger")

ws_url = wait_debugger()
ws = websocket.create_connection(ws_url, timeout=120)
_msgid = [0]
def cmd(method, params=None):
    _msgid[0] += 1
    i = _msgid[0]
    ws.send(json.dumps({"id": i, "method": method, "params": params or {}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == i:
            if "error" in m:
                raise RuntimeError(f"{method}: {m['error']}")
            return m.get("result", {})

def evaluate(expr, await_promise=False):
    r = cmd("Runtime.evaluate", {"expression": expr, "awaitPromise": await_promise,
                                 "returnByValue": True})
    res = r.get("result") or {}
    return res.get("value")

cmd("Page.enable"); cmd("Runtime.enable")
cmd("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "mobile": False,
      "deviceScaleFactor": 1})
# capturar errores de consola/JS
cmd("Runtime.evaluate", {"expression": """
window.__errs=[]; window.addEventListener('error',e=>window.__errs.push('ERR: '+e.message));
window.addEventListener('unhandledrejection',e=>window.__errs.push('REJ: '+(e.reason&&e.reason.message||e.reason)));
"""})
cmd("Page.navigate", {"url": f"http://127.0.0.1:{SERVEPORT}/"})

print("webgl2:", evaluate("(()=>{const c=document.createElement('canvas');return !!c.getContext('webgl2');})()"))
print("crossOriginIsolated:", evaluate("window.crossOriginIsolated"),
      "| SharedArrayBuffer:", evaluate("typeof SharedArrayBuffer!=='undefined'"))

ready = False
for i in range(60):
    time.sleep(2)
    ready = evaluate("window.__playReady===true")
    st = evaluate("document.getElementById('status') && document.getElementById('status').textContent")
    if i % 5 == 0 or ready:
        print(f"t+{2*(i+1)}s ready={ready} status={st!r}")
    if ready:
        break

print("errores JS:", evaluate("window.__errs"))
print("canvas en DOM:", evaluate("!!document.getElementById('outputCanvas')"))

if ready:
    # FPS del emulador sin juego booteado (ventana de 2 s)
    fps = evaluate("""(async()=>{
      const m = window.__playModule;
      const f0 = m.getFrames();
      await new Promise(r=>setTimeout(r,2000));
      const f1 = m.getFrames();
      m.clearStats();
      return {frames_en_2s: f1-f0, badge: document.getElementById('fps').textContent};
    })()""", await_promise=True)
    print("medición FPS (sin juego):", fps)
    # tamaño del contexto webgl del canvas
    print("canvas size:", evaluate("(()=>{const c=document.getElementById('outputCanvas');return c.width+'x'+c.height;})()"))
    time.sleep(2)

shot = cmd("Page.captureScreenshot", {"format": "png"})
with open(OUT, "wb") as f:
    f.write(base64.b64decode(shot["data"]))
print("captura:", OUT, "ready=" , ready)

ws.close(); proc.terminate(); server.terminate()
sys.exit(0 if ready else 2)
