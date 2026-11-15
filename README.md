# Sistema Solar a escala real

Prototipo web (Three.js) para recorrer el sistema solar a escala 1:1 con una nave.

## Ejecutar

```bash
python serve.py
```

Abrir http://localhost:8080. Hace falta un servidor (no funciona con doble clic en el
HTML) porque usa módulos ES. Three.js se carga desde un CDN, así que la primera vez
necesitás conexión a internet.

## Cómo se resuelve la escala

| Problema | Solución en este proyecto |
|---|---|
| `float32` tiene ~7 dígitos: a 1 UA la precisión cae a ~16 km | La simulación usa `double` de JS (metros). La cámara está **siempre en el origen** y todo se dibuja relativo a ella (`system.syncRender`). |
| Z-fighting entre 0,5 m (la nave) y 10¹⁵ m | `logarithmicDepthBuffer: true` en el renderer. |
| Los planetas se mueven a ~30 km/s y hay aceleración temporal | La nave guarda su posición **relativa al cuerpo dominante** (esfera de influencia). Al cambiar de SOI cambia de marco (`ship.js`). |
| Distancias enormes | Tres **modos de motor** (ver abajo). El supercrucero llega a ~0,75 × la altitud sobre el cuerpo más cercano. |
| Un cuerpo lejano mide menos de 1 píxel | Puntos de tamaño fijo y marcadores en el HUD. |
| Estrellas | Escena aparte que sólo comparte la rotación de la cámara. |

**Terreno real (fase 3):** los cuerpos rocosos (Luna, Tierra, Marte, Mercurio y las lunas) pasan a un cubo-esfera con quadtree de chunks generados en Web Workers (`src/planet/`) cuando te acercás a menos de ~6 radios. Podés volar a pocos metros del suelo; la nave choca contra el relieve real (10 m de margen) y gira con el cuerpo cerca de él. Detalle en `PLAN_MEJORAS.md`.

Efemérides: elementos keplerianos de JPL (Standish, 1800–2050) para los planetas y
elementos medios para la Luna. Las demás lunas usan órbitas circulares aproximadas en
el plano ecuatorial de su planeta, con fase inicial aproximada. Los ejes de rotación
usan los polos IAU reales.

## Texturas reales (opcional)

Por defecto las texturas son procedurales. Para usar texturas reales:

1. Descargá los mapas de https://www.solarsystemscope.com/textures/ (licencia CC BY 4.0).
   También sirven los de NASA, que son de dominio público.
2. Guardalos como `textures/<id>.jpg`. Los ids son: `sun`, `mercury`, `venus`, `earth`,
   `moon`, `mars`, `jupiter`, `saturn`, `uranus`, `neptune`, `io`, `europa`,
   `ganymede`, `callisto`, `titan`, etc.
3. Listá esos ids en `textures/manifest.json`, por ejemplo `["earth", "moon", "mars"]`.

## Modos de motor

La lógica está en `src/ship/engines.js`; la densidad del aire (ρ = ρ0·e^(−h/H) por planeta), en `src/air.js`.

| Modo | Para qué | Rango | Manejo |
|---|---|---|---|
| **Atmosférico** (Y) | Volar bajo sobre una ciudad o el terreno | 0 (hover) a ~950 m/s (≈ Mach 2,5–3); menos con aire denso | Jet/VTOL: alabea al girar, la nariz arrastra la velocidad, R/F sube y baja en vertical. Sólo dentro de la atmósfera (o a < 20 km de la superficie si no hay aire) |
| **Impulso** (U) | Maniobras en el espacio y en órbita | 500 m/s a 3.000 km/s (0,02 × altitud) | Inercia y deriva; el strafe es RCS |
| **Supercrucero** (J) | Viajes interplanetarios | 0,75 × altitud | Carga de 1,5 s; interdicción automática al acercarse a un cuerpo, con velocidad de salida segura |

T recorre los modos. Cambios automáticos: al salir de la atmósfera pasa a impulso; al entrar
pasa a atmosférico, y si entrás rápido hay **reentrada** (el arrastre te frena en unos
segundos, con temblor). El piloto automático (G) elige el modo solo. Cada modo tiene su
sonido (turbina, rumor grave, drone) y su FOV/temblor de cámara.

## Controles

Pulsá **H** dentro del juego para ver todos los controles.

- Hacé clic para capturar el mouse. El mouse funciona como joystick virtual (V cambia a mouse directo).
- **W/S**: acelerador. **Shift**: boost. **T**: modo de motor (**Y** atmosférico, **U** impulso, **J** supercrucero).
- **Botón derecho / Alt**: vista libre.
- **0–8**: elegir objetivo.
- **G**: piloto automático al objetivo.
- **, y .**: aceleración temporal.

## Nave y efectos

- El modelo de la nave es **procedural** (`src/ship/procedural.js`): fuselaje por secciones, alas, góndolas, timones y cabina,
  con mapas de color/normal/rugosidad generados en un canvas. No usa archivos de terceros, así que no hay licencias que acreditar.
  Si falla, `src/ship/visual.js` cae al modelo de primitivas.
- Efectos en `src/fx/`: escape (núcleo/halo, diamantes de choque), RCS, carga y estallido del supercrucero, y plasma de reentrada
  según la densidad de la atmósfera. `visual.js` expone `createShipVisual(scene) → { object3d, update(state, dt) }`.

## Próximos pasos posibles

- Atmósfera vista desde adentro (cielo, perspectiva aérea) y nubes.
- Sombras de los anillos y eclipses.
- Física newtoniana opcional (órbitas reales de la nave) además del modo arcade.
- Asteroides y cometas desde el catálogo de JPL.
