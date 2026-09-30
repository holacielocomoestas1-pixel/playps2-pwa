# TRACK B — Play! (PS2) en el navegador · PWA experimental

PWA que corre **Play!**, emulador de PlayStation 2, compilado a WebAssembly en el
navegador. El usuario carga su **propio** archivo (ISO/CSO/CHD/ISZ/BIN/ELF);
no se incluye, descarga ni enlaza ningún juego, BIOS ni ROM comercial.

## Estado

- **PWA funcional y verificada** con Chromium real (headless): el núcleo wasm
  inicializa, crea contexto WebGL2, responde a controles táctiles y teclado,
  y expone su contador de FPS. Captura en `verificacion/play-ui-boot.png`.
- **Build oficial desde fuentes: EN CURSO / veredicto abajo.**

## Intento de build oficial

Seguido al pie de la letra el README del proyecto (`jpd002/play-`, commit
`83700b2`):

1. Clonado shallow (`--depth 1`) + `git submodule update --init --recursive --depth 1`
   (los submódulos anidados de `deps/Dependencies` —zstd, xxHash, zlib— son
   obligatorios; sin `--recursive` el configure falla).
2. emsdk instalado (3.1.73). Notas del entorno: hubo que parchear el `tar` de
   emsdk con `--no-same-owner` (correr como root en contenedor) y descargar los
   tarballs grandes con `curl -C -` porque la descarga urllib de emsdk se
   truncaba/bloqueaba contra `storage.googleapis.com`.
3. `emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=OFF -DBUILD_PLAY=ON -DBUILD_PSFPLAYER=ON -DUSE_QT=OFF`
   → configure OK.
4. `cmake --build . --config Release -j2` → **ÉXITO** (`[100%] Built target Play`, exit 0).

Log completo: `build-log.txt`.

### Veredicto del build oficial

> **El build oficial desde fuentes FUNCIONÓ.** Sin parchear el proyecto Play!:
> `Play.js` (206.318 B) + `Play.wasm` (2.157.100 B) compilados con emsdk 3.1.73
> el 2026-09-30 (~1h35 de compilación, 539 objetos, cero errores). Los artefactos
> se vendorizaron en `vendor/` (SHA256 en `vendor/SHA256SUMS`) y la PWA arranca con
> ellos verificada en Chromium real: `crossOriginIsolated: True`, WebGL2 OK,
> «Núcleo listo», cero errores JS. El plan B (artefactos publicados) quedó
> **reemplazado** por el build propio.

## Qué se sirve (build oficial, verificado)

La PWA sirve los artefactos **compilados desde las fuentes oficiales de Play!**
en esta máquina: `vendor/Play.js` (206 KB) + `vendor/Play.wasm` (2,1 MB), con
SHA256 en `vendor/SHA256SUMS`. **Nada se hotlinkea**: todo se sirve desde el
mismo origen.
Si el build oficial termina con éxito, estos archivos se sustituyen por los
recién compilados (misma API: `Play()`, `initVm`, `bootDiscImage`, `bootElf`,
`getFrames`, `clearStats`, `discImageDevice`).

## Cómo correr en local

El wasm usa pthreads → necesita `SharedArrayBuffer` → exige cabeceras
`Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy:
require-corp`. `serve.py` (solo stdlib) las envía:

```bash
cd ~/workspace/emulador/ps2
python3 serve.py 8090
# abrir http://127.0.0.1:8090/
```

Luego: «Elegir archivo…» y seleccionar tu ISO/ELF. En escritorio, clic en la
pantalla y usa el teclado (flechas = D-Pad, A = □, Z = ✕, S = △, X = ○,
Enter = Start, Backspace = Select, 1/2 = L1/L2, 8/9 = R1/R2).

## Cómo desplegar

Web service en Render (tier gratuito) con este mismo `serve.py`:

```bash
gh repo create <nombre> --public --source ~/workspace/emulador/ps2
git -C ~/workspace/emulador/ps2 push -u origin main
python3 ~/workspace/skills/render/bin/render.py service-create \
  '{"type":"web_service","name":"playps2-pwa","ownerId":"<owner>","repo":"https://github.com/<u>/<repo>",
    "branch":"main","autoDeploy":"yes",
    "serviceDetails":{"runtime":"docker","plan":"free","region":"oregon",
      "envSpecificDetails":{"dockerfilePath":"./Dockerfile","dockerContext":"."}}}}'
```

`serve.py` lee `$PORT`/`$HOST` del entorno. Las cabeceras COOP/COEP ya van incluidas,
imprescindibles para el wasm con pthreads.

### Estado del deploy (2026-09-30)

- Repo: https://github.com/holacielocomoestas1-pixel/playps2-pwa (público).
- Servicio Render creado: `playps2-pwa` (`srv-dauel43ncjis73fbblc0`),
  URL prevista https://playps2-pwa.onrender.com, plan free, región oregon, runtime docker.
- **Deploy BLOQUEADO por cuota**: el primer deploy (`dep-dauel4bncjis73fbblu0`)
  falló en <1 s con `build_failed` — la cuenta agotó sus minutos de build del
  tier gratuito (`pipeline_minutes_exhausted`; la track hermana PSP lo confirmó
  hoy con el mismo síntoma). No es problema del código ni del Dockerfile.
- `autoDeploy: yes` quedó activado: cuando la cuota se resetee (1 de octubre),
  Render debería desplegar solo desde `main`. **No se gastó dinero.**
- Verificación pendiente: cuando el deploy viva, comprobar
  `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
  require-corp` en la respuesta y que el núcleo arranque.

## Licencia

Play! © 2006–2026 Jean-Philip Desjardins, licencia BSD (ver `LICENSE-Play.txt`,
copia intacta del repo). Esta redistribución conserva el aviso de copyright
como exige la licencia. El shell PWA (`index.html`, `app.js`, `styles.css`,
`sw.js`, `serve.py`, iconos) es código propio del proyecto emulador.

## VEREDICTO HONESTO de rendimiento

Medido con Chromium de escritorio headless (SwiftShader), 2026-09-30:

- Inicialización del módulo wasm + `initVm()`: **~4 s**, sin errores JS.
- `SharedArrayBuffer` + `crossOriginIsolated`: **true** (pthreads operativos).
- Contexto WebGL2 sobre `#outputCanvas` (640×480): **OK**.
- Controles táctiles → `KeyboardEvent`s sintéticos sobre el canvas: **OK**
  (verificado que llegan `keydown`/`keyup` con el `code` correcto).
- **FPS con juego: NO MEDIDO.** El contador del propio emulador
  (`getFrames()`, ventana de 1 s) marca **0 f/s sin juego booteado**, que es lo
  esperado: no hay nada emulando. No se consiguió ningún homebrew legal
  arrancable (el repo no incluye ninguno y la demo oficial no ofrece archivos
  de prueba), y por regla del proyecto no se descargó ninguna ROM/BIOS comercial.

**God of War y los juegos 3D exigentes NO serán jugables por esta vía.**
Lo dice el propio README de Play!: el build web no tiene protección de
escritura en páginas de memoria (la caché JIT no se puede invalidar en juegos
que cargan módulos en el EE) ni control del entorno de punto flotante, así que
varios juegos fallan; y aun cuando arrancan, un PS2 emulado por software sobre
WebAssembly va muy por debajo de la velocidad jugable en 3D. Esta track es un
experimento honesto, no una vía para jugar a God of War en el móvil.
