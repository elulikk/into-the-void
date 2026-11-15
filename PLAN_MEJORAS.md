# Plan de mejoras: vuelo de la nave + planetas procedurales

## Decisiones tomadas
- **Vuelo muy arcade** (tipo Freelancer/No Man's Sky): giros rápidos y con respuesta, sin deriva lateral, alabeo automático y cámara con resorte. El Flight Assist apagado (A2) queda fuera; el empuje mantiene algo de rampa para que haya "peso".
- **Se empieza por la fase 1 (vuelo).**
- **Planetas realistas fieles**: geografía y colores parecidos a los reales, generados proceduralmente.
- **Extras incluidos**: sonido procedural, gamepad, aterrizaje (va en la fase 5, una vez que haya terreno real). Sin migrar a Vite: se siguen usando módulos ES y `serve.py`.

## Diagnóstico del estado actual

**Nave (`src/ship.js`)**
- El mouse se aplica directo como rotación: `angVel.lerp(inp, dt*18)` alcanza el valor casi en un cuadro, así que no hay inercia de giro.
- La velocidad hace `lerp` hacia la deseada (`dt*3`). Se siente como "teletransporte suave", sin masa ni empuje.
- La cámara está pegada a la nave (`cameraOffset` × `ship.quat`), sin retraso ni balanceo, así que la nave parece congelada en pantalla.
- No hay ningún indicio visual de velocidad: en el espacio vacío no hay referencias, y los 30 m/s y los 3000 km/s se ven iguales.
- No hay banking (alabeo al girar), ni RCS, ni bloom, ni sonido.

**Planetas (`src/textures.js`, `src/system.js`)**
- Una esfera con una textura equirectangular de 512–1024 px generada en la CPU. De cerca se ve borrosa, y la superficie es lisa (no hay relieve).
- La atmósfera es un borde aditivo (rim) en una cáscara de 1.03 R. No hay scattering, no hay cielo desde adentro, no hay atardeceres.
- La colisión es contra una esfera perfecta (`b.R + 15`).

---

## PARTE A: vuelo que se sienta como un juego

### A1. Modelo de giro con inercia (el cambio más importante)
- **Joystick virtual con el mouse**: el desplazamiento del cursor respecto del centro (con zona muerta y curva exponencial) define la *velocidad angular objetivo*. Así se puede girar sostenido sin arrastrar el mouse sin fin. Se dibuja un retículo y un indicador del cursor en el HUD.
- **Resorte-amortiguador por eje** (críticamente amortiguado), con rates distintos para cabeceo, guiñada y alabeo: la nave "agarra" y "suelta" el giro con peso.
- **Alabeo automático al guiñar** (giro coordinado) y **auto-nivelación** opcional respecto del horizonte local cuando estás cerca de un planeta.

### A2. Modelo lineal con masa
- Empuje = aceleración (con límite), no `lerp` de velocidad. Hay momento.
- **Flight Assist (tecla Z)**. Encendido: amortigua gradualmente la deriva lateral (vuelo cómodo). Apagado: newtoniano puro, para derrapar.
- **Boost** con rampa de subida y bajada, más un *kick* de FOV.
- **Supercrucero con carga**: 1,5 s de "spool-up" con vibración y sonido, después entra. La `vmax` en función de la altitud se mantiene, pero se suaviza exponencialmente para que no dé saltos al cambiar de cuerpo.

### A3. Cámara viva
- Cámara de persecución con **resorte**: la posición se retrasa un poco y la rotación hace slerp con lag. Al girar se ve la nave inclinarse en pantalla.
- **Look-ahead**: la cámara se corre hacia el lado del giro.
- **FOV dinámico** según velocidad/aceleración; **shake** leve con boost, carga de supercrucero y entrada atmosférica.
- **Vista libre** (mantener Alt o el botón derecho) para orbitar alrededor de la nave.
- Cabina: balanceo leve de la cabeza por fuerza G.

### A4. Feedback visual y sonoro de velocidad
- **Polvo espacial**: partículas cerca de la cámara que se estiran en líneas según la velocidad. Es *la* clave para sentir movimiento en el vacío.
- Estelas de warp en supercrucero (shader radial).
- Capa cosmética separada de la física: el modelo se inclina un poco extra según el input.
- Propulsores RCS (soplidos al girar y al hacer strafe), llama con ruido, **bloom** en motores y Sol.
- Sonido procedural con WebAudio: zumbido del motor con pitch según el empuje, carga del supercrucero, viento en la atmósfera.
- Soporte de **gamepad** (Gamepad API).

---

## PARTE B: planetas procedurales con superficie y atmósfera

### B1. Terreno real con LOD (cubo-esfera + quadtree)
- Cada planeta rocoso pasa a ser un **cubo proyectado a esfera** con 6 quadtrees. Cada nodo es un *chunk* de 33×33 vértices que se subdivide al acercarse (criterio: error en pantalla).
- Los chunks se generan en **Web Workers** (alturas + normales), con presupuesto de N chunks por cuadro y caché LRU.
- **Precisión**: cada chunk guarda su centro en doubles y sus vértices relativos a ese centro (float32). Se integra con el esquema "cámara en el origen" que ya existe.
- Cosido de bordes entre niveles con faldones (*skirts*).
- **Colisión y altitud reales**: la misma función de altura se evalúa en la CPU para la nave (aterrizar, volar rasante). El supercrucero usa la altitud sobre el terreno.

### B2. Recetas de terreno por planeta (deterministas por semilla)
Funciones combinables: fbm, ridged multifractal (cordilleras), domain warping, cráteres (Voronoi con borde y pico central, en varias escalas), dunas, terrazas, grietas.

| Cuerpo | Receta |
|---|---|
| Tierra | Continentes + cordilleras ridged + océano (nivel del mar), amplitud ~9 km |
| Marte | Llanuras + Olympus Mons (22 km) + un cañón tipo Valles Marineris + cráteres + casquetes |
| Luna / Mercurio | Cráteres en 4 escalas + maria (cuencas lisas y oscuras) |
| Venus | Mesetas volcánicas suaves (bajo nubes opacas) |
| Ío | Calderas volcánicas + lagos de lava emisivos |
| Europa | Hielo liso + grietas lineales (ridged de banda angosta) |
| Calisto / Ganimedes / Rea | Saturación de cráteres / terreno estriado |
| Titán | Dunas + lagos de metano |
| Fobos / Deimos | Asteroide deformado (no esférico) + cráteres |

### B3. Shading de superficie
- Shader propio: el **bioma** sale de altura, latitud, pendiente y humedad (roca en pendientes, nieve en cumbres y polos, arena, vegetación).
- **Detalle multiescala** con ruido en el fragment shader (triplanar), así se ve nítido a 100 m de altura.
- Normales a partir de las derivadas del ruido.
- **Océano** (Tierra, Titán): olas de ruido animadas, reflejo especular del Sol (glint), Fresnel, color según profundidad.
- Lado nocturno de la Tierra: luces de ciudades procedurales en zonas costeras y templadas.
- Ío: lava emisiva. Europa: hielo con especular.

### B4. Atmósfera física (scattering)
- Pasada de **post-proceso a pantalla completa** con raymarching de **Rayleigh + Mie** (single scattering, con absorción de ozono para la Tierra). Usa el depth buffer (hay que reconstruir la profundidad del depth logarítmico).
- Parámetros por planeta en `bodies.js`: radio de la atmósfera, coeficientes β de Rayleigh/Mie, escala de altura, color de absorción.
  - Tierra: cielo azul, atardeceres naranjas.
  - Marte: cielo caramelo con **atardeceres azules**.
  - Venus: opaca, amarilla y densa.
  - Titán: neblina naranja espesa.
- **Perspectiva aérea**: las montañas lejanas se azulan.
- Desde adentro, el cielo se ilumina y las estrellas se desvanecen según la luminancia del cielo. La transición espacio → superficie es continua.

### B5. Nubes
- Tierra: cáscara de nubes procedural animada (domain warping que fluye) con **sombras de nubes** sobre el terreno.
- Más adelante, nubes volumétricas por raymarching cerca de la superficie (es caro, va con preset de calidad).

### B6. Gigantes gaseosos y anillos
- Shader animado en GPU (no textura fija): bandas con **flujo diferencial por latitud**, turbulencia por domain warping, tormentas y vórtices (Gran Mancha Roja, Mancha Oscura).
- Descenso a la atmósfera: niebla que se espesa, oscurecimiento y un "piso" de presión que impide seguir bajando.
- Anillos: iluminación según el ángulo del Sol, **sombra del planeta sobre los anillos y de los anillos sobre el planeta**, y partículas de hielo al cruzarlos.

### B7. Post-proceso y calidad
- Pipeline HDR: bloom, lens flare del Sol, eclipses (sombra de la Luna sobre la Tierra).
- Presets de calidad (Bajo / Medio / Alto / Ultra): resolución de chunks, pasos de raymarch, nubes volumétricas.
- Medidor de FPS en el HUD (F3).

---

## Fases sugeridas (cada una deja el juego funcionando)

1. **Vuelo** (A1–A4 sin sonido): impacto inmediato, bajo riesgo.
2. **Post-proceso + atmósfera por scattering vista desde el espacio** (B4 parcial, B7 bloom): el salto visual más grande por el esfuerzo.
3. **Terreno LOD + colisión real** (B1) con una receta simple, probado en la Luna.
4. **Recetas por planeta + shading de superficie + océano** (B2, B3).
5. **Atmósfera desde adentro, nubes, aterrizaje** (B4 completo, B5).
6. **Gigantes gaseosos animados, anillos con sombras, sonido, gamepad, pulido** (B6, A4 sonido).

## Cambios técnicos de base
- Tal vez convenga pasar a **Vite** (dev server + bundling de workers y GLSL en archivos `.glsl`). Si no, se pueden seguir usando módulos ES nativos con workers `type: "module"`.
- Nuevos módulos: `flight.js` (física de vuelo), `camera.js` (cámara de persecución), `fx/` (polvo, warp, post), `planet/` (quadtree, chunk worker, recetas, shaders), `atmosphere/`.


## HUD de instrumentos
- Tecla U: sci-fi / aviónica / minimalista (se guarda en localStorage).
- `src/physics/` (datos y atmósferas por cuerpo), `src/hud/` (telemetría, instrumentos en canvas, alertas).
- Pendiente: velocidad relativa al aire (hoy ignora la rotación del planeta) y terreno real (usa `ship.nearest.alt`).
