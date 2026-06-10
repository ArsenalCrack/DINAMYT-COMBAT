# DINAMYT — Sistema de Puntuación Multi-Tatami v3
## Guía de uso para el campeonato

---

## LO QUE NECESITAS

- Una **laptop** (Windows, Mac o Linux) con Node.js instalado
- Un **celular o router** para crear una red WiFi local (hotspot)
- Los **celulares** de cada réferi conectados a esa red
- Una **TV o proyector** conectado a la laptop por HDMI (para la pantalla de proyección)

> **No se necesita internet durante el campeonato.** Solo se necesita que todos los dispositivos estén conectados a la misma red WiFi local.

---

## INSTALACIÓN (solo la primera vez)

### Paso 1 — Instalar Node.js
Ir a **https://nodejs.org** y descargar la versión **LTS**.
Instalar normalmente. Reiniciar la laptop si lo pide.

### Paso 2 — Copiar la carpeta
Copiar la carpeta `dinamyt-server` a la laptop. Debe contener:
```
dinamyt-server/
  ├── server.js       ← Servidor multi-tatami
  ├── index.html      ← Interfaz HTML compartida
  ├── app.js          ← Lógica del cliente
  ├── app.css         ← Estilos
  └── package.json    ← Dependencias (ws)
```

### Paso 3 — Instalar dependencias (una sola vez, requiere internet)
Abrir una terminal dentro de la carpeta `dinamyt-server` y ejecutar:
```
npm install
```

---

## EL DÍA DEL CAMPEONATO

### Paso 1 — Crear la red WiFi local

**Opción A: Hotspot del celular**
Activar "Zona WiFi" o "Punto de acceso" en el celular.
Conectar la laptop a ese hotspot.

**Opción B: Router WiFi portátil**
Conectar la laptop y todos los celulares al mismo router.

> No es necesario que esa red tenga internet. Basta con que todos estén en la misma red local.

### Paso 2 — Arrancar el servidor
Abrir terminal en la carpeta `dinamyt-server` y ejecutar:
```
node server.js
```

El servidor mostrará algo así:
```
╔══════════════════════════════════════════════╗
║     DINAMYT — SERVIDOR MULTI-TATAMI v3       ║
╠══════════════════════════════════════════════╣
║  ✓ Tatami 1  →  puerto 3001                 ║
║  ✓ Tatami 2  →  puerto 3002                 ║
║  ...                                         ║
╠══════════════════════════════════════════════╣
║  IP de la laptop: 192.168.x.x               ║
╠══════════════════════════════════════════════╣
║  URLs para celulares:                        ║
║   Tatami 1  →  http://192.168.x.x:3001      ║
║   Tatami 2  →  http://192.168.x.x:3002      ║
╚══════════════════════════════════════════════╝
```

### Paso 3 — Conectar los celulares

1. Conectar **todos** los celulares al mismo hotspot/red
2. Abrir el navegador en cada celular (Chrome o Safari)
3. Escribir la URL del tatami correspondiente, ej: `http://192.168.x.x:3001`
4. Seleccionar el **rol** en la pantalla de inicio:

| Rol | Descripción |
|-----|-------------|
| 🥋 Réferi Esquina 1 | Puntos para Hong (rojo) |
| 🥋 Réferi Esquina 2 | Puntos para Hong (rojo) |
| 🥋 Réferi Esquina 3 | Puntos para Chung (azul) |
| 🥋 Réferi Esquina 4 | Puntos para Chung (azul) |
| ⚖️ Réferi Central | Cronómetro, faltas, puntos especiales, control |
| 📺 Pantalla de Proyección | Marcador público para espectadores |

### Paso 4 — Pantalla de proyección (TV/Proyector)
- Conectar la laptop a la TV con HDMI
- Abrir el navegador de la laptop con `http://localhost:3001` (o el tatami que corresponda)
- Seleccionar **"Pantalla de Proyección"** — se activará en pantalla completa automáticamente

---

## CONFIGURACIÓN ANTES DE INICIAR UN COMBATE

El **Réferi Central** debe configurar lo siguiente antes de comenzar:

### 1. Número de réferis de esquina activos
En la sección **"Réferis de Esquina Activos"**, seleccionar cuántos réferis participan:
- **2 Réferis** → la puntuación se divide entre 2
- **3 Réferis** → la puntuación se divide entre 3
- **4 Réferis** → la puntuación se divide entre 4 *(por defecto)*

> ⚠️ Es importante configurar esto **antes de iniciar el cronómetro** para que el marcador sea correcto.

### 2. Nombres de los competidores
Escribir los nombres en los campos de texto en la sección **"Nombres"**.

### 3. Duración del round
Seleccionar la duración del reloj: 30 seg / 1 min / 1:30 / 2 min.

---

## SISTEMA DE PUNTUACIÓN

### Réferi de Esquina
Cada réferi marca los puntos de UN color (según su rol asignado):

| Botón | Puntos |
|-------|--------|
| +1 CUERPO | Golpe o patada al cuerpo |
| +2 GIRO·CUERPO / PAT·CABEZA | Patada giratoria al cuerpo o patada a la cabeza |
| +3 GIRO·CABEZA | Patada giratoria a la cabeza |

### Réferi Central
Puntos especiales otorgados solo por el réferi central:

| Acción | Puntos |
|--------|--------|
| Knock Down | +2 al ganador del KD |
| Derribo / Barrida | +2 al ejecutor |
| Proyección / Lanzamiento | +2 al ejecutor |
| KyongGo (advertencia) | **−0.5** al infractor |
| GamJeum (falta grave) | −1 al infractor |
| 6 KyongGo acumulados | → Descalificación (DQ) automática |
| 3 GamJeum acumulados | → Descalificación (DQ) automática |

### Fórmula del marcador
```
Marcador Final = (Suma puntos esquina ÷ N réferis) + puntos réferi central
```
El marcador en pantalla muestra el total redondeado a 1 decimal.

---

## HISTORIAL DETALLADO

El **Réferi Central** tiene acceso a un historial completo de todas las acciones del combate, mostrando:
- ⏱ **Tiempo** en que ocurrió (ej: `1:23` = a 1 min 23 seg del reloj)
- 👤 **Quién** lo registró (J1, J2, Central...)
- 📋 **Qué** acción fue (nombre del punto o falta)
- 🔢 **Cuántos puntos** sumó o restó

Esto permite verificar la transparencia del marcador en cualquier momento.

---

## ARQUITECTURA DE RED

```
📱 Réferi Esquina 1  ──┐
📱 Réferi Esquina 2  ──┤
📱 Réferi Esquina 3  ──┼──── Red WiFi local ────  💻 Laptop (server.js)
📱 Réferi Esquina 4  ──┤                          ├── Tatami 1 (puerto 3001)
⚖️  Réferi Central   ──┤                          ├── Tatami 2 (puerto 3002)
📺 Pantalla TV        ──┘                          └── ... Tatami N
```

Cada tatami tiene su propio servidor WebSocket independiente.
No hay base de datos, no hay login, no hay internet requerido.

---

## CONFIGURACIÓN DEL SERVIDOR

El archivo `server.js` tiene estas constantes al inicio:
```javascript
const TATAMIS_ACTIVOS = 6;        // Número de tatamis a levantar
const PUERTO_BASE     = 3001;     // Puerto del primer tatami
const CLAVE_ACCESO    = 'Amy2026*'; // Contraseña al arrancar
```

---

## PARA PARAR EL SERVIDOR
En la terminal donde corre el servidor, presionar `Ctrl + C`.

---

## SOLUCIÓN DE PROBLEMAS

**"No puedo conectarme desde el celular"**
- Verificar que el celular y la laptop estén en la **misma red WiFi**
- Desactivar el firewall de Windows temporalmente:
  Panel de control → Firewall → Desactivar para redes privadas
- Revisar que la URL incluya el puerto correcto (ej: `:3001`)

**"La IP cambió"**
- Ocurre si se apaga y vuelve a encender el hotspot
- Releer la nueva IP en la consola al iniciar `node server.js`

**"Un celular se desconectó"**
- El sistema reconecta automáticamente cada 2 segundos
- El punto verde en el header se pone naranja cuando hay eventos pendientes
- Al reconectar, el servidor envía el estado completo automáticamente

**"Los puntos no aparecen en pantalla"**
- Verificar que el indicador esté en verde ("EN VIVO")
- Si el punto está naranja, hay eventos pendientes — revisar WiFi
- Intentar con "↩ DESHACER" y volver a marcar

**"La sesión se perdió al recargar"**
- El sistema guarda la sesión en el dispositivo automáticamente
- Al recargar aparece un banner de recuperación — seleccionar "RECUPERAR"
- Los puntos siguen en el servidor aunque se recargue la página

**"El cronómetro no está sincronizado"**
- El servidor es la fuente de verdad del tiempo
- Cada segundo el servidor actualiza a todos los dispositivos
- Si se ve desincronizado, es momentáneo — se corrige solo al siguiente tick

---

## CONSUMO DE RED
El sistema usa mensajes JSON pequeños (~300 bytes por acción).
**No requiere internet.** Todo el tráfico es local en la red WiFi.
Consumo típico: menos de 1 MB por combate completo.
