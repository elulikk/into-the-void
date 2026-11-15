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
| Distancias enormes | **Supercrucero** (tecla J): la velocidad máxima es ~0,75 × la altitud sobre el cuerpo más cercano. Sin él, el tope es 3 km/s. |
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

## Controles

Pulsá **H** dentro del juego para ver todos los controles.

- Hacé clic para capturar el mouse. El mouse funciona como joystick virtual (V cambia a mouse directo).
- **W/S**: acelerador. **Shift**: boost. **J**: supercrucero.
- **Botón derecho / Alt**: vista libre.
- **0–8**: elegir objetivo.
- **G**: piloto automático al objetivo.
- **, y .**: aceleración temporal.

## Próximos pasos posibles

- Atmósfera vista desde adentro (cielo, perspectiva aérea) y nubes.
- Sombras de los anillos y eclipses.
- Física newtoniana opcional (órbitas reales de la nave) además del modo arcade.
- Asteroides y cometas desde el catálogo de JPL.
