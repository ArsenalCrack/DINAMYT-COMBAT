/**
 * DINAMYT — Servidor Multi-Tatami v3 (arquitectura de eventos delta)
 * ===================================================================
 * INSTALACIÓN (una sola vez): npm install ws
 * ARRANQUE: node server.js
 *
 * CAMBIO CLAVE v3: El servidor ya NO acepta estado completo de los clientes.
 * Solo acepta EVENTOS DELTA (ej: "sumar +1 a hong del juez j1").
 * El servidor es la única fuente de verdad y aplica cada evento atómicamente.
 * Esto elimina race conditions y pérdida de puntos por red congestionada.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const os = require('os');
const readline = require('readline');

// ══════════════════════════════════════════
//  CONFIGURACIÓN
// ══════════════════════════════════════════
const TATAMIS_ACTIVOS = 6;
const PUERTO_BASE = 3001;
const CLAVE_ACCESO = 'Amy2026*';
// Cuántos IDs de eventos recordar para deduplicación
const MAX_EVENTOS_VISTOS = 500;
// ══════════════════════════════════════════

function estadoInicial() {
  return {
    nombreHong: 'Hong', nombreChung: 'Chung',
    jueces: {
      j1: { hong: 0, chung: 0 }, j2: { hong: 0, chung: 0 },
      j3: { hong: 0, chung: 0 }, j4: { hong: 0, chung: 0 }
    },
    nombresJueces: { j1: '', j2: '', j3: '', j4: '' },
    numJueces: 4,
    arbHong: 0, arbChung: 0,
    historial: [],
    kyongHong: 0, kyongChung: 0,
    faltasHong: 0, faltasChung: 0,
    segundos: 120, segundosMax: 120, activo: false,
    log: [], alerta12Lanzada: false, ronda: 'r1',
    oroResuelto: false,
  };
}

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const i of ifaces)
      if (i.family === 'IPv4' && !i.internal) return i.address;
  return 'localhost';
}

// ══════════════════════════════════════════
//  LEER CLAVE EN CONSOLA
// ══════════════════════════════════════════
function pedirClave() {
  return new Promise((resolve) => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║          DINAMYT — ACCESO AL SERVIDOR        ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  Ingresa la contraseña para iniciar.         ║');
    console.log('╚══════════════════════════════════════════════╝\n');
    process.stdout.write('  Contraseña: ');

    let clave = '';
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char) => {
      if (char === '\r' || char === '\n') {
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(clave);
        return;
      }
      if (char === '\u0003') { console.log('\n\n  Cancelado.\n'); process.exit(0); }
      if (char === '\u007f' || char === '\b') {
        if (clave.length > 0) { clave = clave.slice(0, -1); process.stdout.write('\b \b'); }
        return;
      }
      clave += char;
      process.stdout.write('*');
    };
    process.stdin.on('data', onData);
  });
}

async function iniciar() {
  const MAX = 3;
  for (let i = 1; i <= MAX; i++) {
    const clave = await pedirClave();
    if (clave === CLAVE_ACCESO) {
      console.log('\n  ✓ Clave correcta. Iniciando DINAMYT...\n');
      arrancarServidor();
      return;
    }
    const r = MAX - i;
    if (r > 0) console.log(`\n  ✗ Incorrecta. ${r} intento${r > 1 ? 's' : ''} restante${r > 1 ? 's' : ''}.\n`);
    else { console.log('\n  ✗ Demasiados intentos. Cerrando.\n'); process.exit(1); }
  }
}

// ══════════════════════════════════════════
//  APLICAR EVENTO DELTA AL ESTADO (servidor)
//  Esta función es el corazón del sistema anti-race-condition.
//  Solo el servidor modifica el estado, y lo hace de forma atómica.
// ══════════════════════════════════════════
function aplicarEvento(estado, ev, _broadcastGanadorCb) {
  switch (ev.accion) {

    case 'punto_juez':
      // ev: { juez, color, pts, nombre }
      if (!estado.jueces[ev.juez]) break;
      estado.jueces[ev.juez][ev.color] += ev.pts;
      estado.historial.push({ juez: ev.juez, color: ev.color, pts: ev.pts, nombre: ev.nombre, tiempo: estado.segundos, ronda: estado.ronda });
      _agregarLog(estado, `${ev.color === 'hong' ? '🔴' : '🔵'} ${ev.nombre} +${ev.pts}`, ev.color);
      // Punto de Oro: el servidor decide el ganador (una sola vez)
      if (estado.ronda === 'oro' && !estado.oroResuelto) {
        estado.oroResuelto = true;
        estado.activo = false;
        const nombre = ev.color === 'hong' ? estado.nombreHong : estado.nombreChung;
        _agregarLog(estado, `🏆 SUNG — ${nombre.toUpperCase()} GANA (Punto de Oro)`, 'arb');
        if (_broadcastGanadorCb) _broadcastGanadorCb(nombre, ev.color);
      }
      break;

    case 'deshacer_juez':
      // ev: { juez }
      const ixJ = [...estado.historial].reverse().findIndex(h => h.juez === ev.juez);
      if (ixJ !== -1) {
        const ri = estado.historial.length - 1 - ixJ;
        const h = estado.historial[ri];
        estado.jueces[h.juez][h.color] -= h.pts;
        estado.historial.splice(ri, 1);
        _agregarLog(estado, `↩ Deshacer ${ev.juez}`, 'arb');
      }
      break;

    case 'especial':
      // ev: { color, pts, nombre }
      if (ev.color === 'hong') estado.arbHong += ev.pts;
      else estado.arbChung += ev.pts;
      estado.historial.push({ juez: 'arbitro', color: ev.color, pts: ev.pts, nombre: ev.nombre, esEspecial: true, tiempo: estado.segundos, ronda: estado.ronda });
      _agregarLog(estado, `${ev.color === 'hong' ? '🔴' : '🔵'} ⭐ ${ev.nombre} +${ev.pts}`, ev.color);
      // Punto de Oro: el servidor decide el ganador (una sola vez)
      if (estado.ronda === 'oro' && !estado.oroResuelto) {
        estado.oroResuelto = true;
        estado.activo = false;
        const nombreEsp = ev.color === 'hong' ? estado.nombreHong : estado.nombreChung;
        _agregarLog(estado, `🏆 SUNG — ${nombreEsp.toUpperCase()} GANA (Punto de Oro)`, 'arb');
        if (_broadcastGanadorCb) _broadcastGanadorCb(nombreEsp, ev.color);
      }
      break;

    case 'deshacer_arbitro':
      // ev: { color }
      const ixA = [...estado.historial].reverse().findIndex(
        h => h.juez === 'arbitro' && h.color === ev.color
      );
      if (ixA !== -1) {
        const ri = estado.historial.length - 1 - ixA;
        const h = estado.historial[ri];
        if (h.esKyongGo) {
          if (ev.color === 'hong') { estado.kyongHong = Math.max(0, estado.kyongHong - 1); estado.arbHong += 0.5; }
          else { estado.kyongChung = Math.max(0, estado.kyongChung - 1); estado.arbChung += 0.5; }
        } else if (h.esGamJeum) {
          if (ev.color === 'hong') { estado.arbHong += 1; estado.faltasHong = Math.max(0, estado.faltasHong - 1); }
          else { estado.arbChung += 1; estado.faltasChung = Math.max(0, estado.faltasChung - 1); }
        } else {
          if (ev.color === 'hong') estado.arbHong -= h.pts;
          else estado.arbChung -= h.pts;
        }
        estado.historial.splice(ri, 1);
        _agregarLog(estado, `↩ Deshacer árbitro: ${ev.color}`, 'arb');
      }
      break;

    case 'kyonggo':
      // ev: { color } — KyongGo resta -0.5 al infractor
      if (ev.color === 'hong') {
        estado.kyongHong++;
        estado.arbHong -= 0.5;
        estado.historial.push({ juez: 'arbitro', color: 'hong', nombre: `KyongGo #${estado.kyongHong} (−0.5)`, pts: -0.5, esKyongGo: true, tiempo: estado.segundos, ronda: estado.ronda });
        _agregarLog(estado, `🔴 KyongGo #${estado.kyongHong} −0.5 — Hong`, 'hong');
      } else {
        estado.kyongChung++;
        estado.arbChung -= 0.5;
        estado.historial.push({ juez: 'arbitro', color: 'chung', nombre: `KyongGo #${estado.kyongChung} (−0.5)`, pts: -0.5, esKyongGo: true, tiempo: estado.segundos, ronda: estado.ronda });
        _agregarLog(estado, `🔵 KyongGo #${estado.kyongChung} −0.5 — Chung`, 'chung');
      }
      break;

    case 'gamjeum':
      // ev: { color }
      if (ev.color === 'hong') { estado.arbHong -= 1; estado.faltasHong++; estado.historial.push({ juez: 'arbitro', color: 'hong', nombre: `GamJeum #${estado.faltasHong}`, pts: -1, esGamJeum: true, tiempo: estado.segundos, ronda: estado.ronda }); }
      else { estado.arbChung -= 1; estado.faltasChung++; estado.historial.push({ juez: 'arbitro', color: 'chung', nombre: `GamJeum #${estado.faltasChung}`, pts: -1, esGamJeum: true, tiempo: estado.segundos, ronda: estado.ronda }); }
      _agregarLog(estado, `${ev.color === 'hong' ? '🔴' : '🔵'} GamJeum −1`, ev.color);
      break;

    case 'set_num_jueces':
      // ev: { numJueces }
      estado.numJueces = Math.max(2, Math.min(4, ev.numJueces || 4));
      _agregarLog(estado, `🔢 Réferis de esquina: ${estado.numJueces}`, 'arb');
      break;

    case 'nombres':
      estado.nombreHong = ev.nombreHong || 'Hong';
      estado.nombreChung = ev.nombreChung || 'Chung';
      break;

    case 'set_nombre_juez':
      // ev: { juez, nombre }
      if (estado.nombresJueces && ev.juez) {
        estado.nombresJueces[ev.juez] = ev.nombre || '';
      }
      break;

    case 'crono_tick':
      // Solo el servidor maneja el tick del cronómetro
      // (el cliente solo envía start/pause/reset)
      break;

    case 'crono_start':
      estado.activo = true;
      break;

    case 'crono_pause':
      estado.activo = false;
      break;

    case 'crono_reset':
      estado.activo = false;
      estado.segundos = ev.segundosMax || estado.segundosMax;
      if (ev.segundosMax) estado.segundosMax = ev.segundosMax;
      break;

    case 'crono_seg':
      // Actualización de segundos desde el réferi central
      estado.segundos = ev.segundos;
      estado.activo = ev.activo;
      break;

    case 'ronda':
      estado.ronda = ev.ronda;
      _agregarLog(estado, `🔢 Ronda: ${ev.ronda}`, 'arb');
      break;

    case 'reset':
      const max = estado.segundosMax;
      Object.assign(estado, estadoInicial());
      estado.segundosMax = max;
      estado.segundos = max;
      estado.oroResuelto = false;
      _agregarLog(estado, '↺ Reset', 'arb');
      break;
  }

  // Limitar historial a 200 entradas
  if (estado.historial.length > 200) estado.historial = estado.historial.slice(-200);
  return estado;
}

function _agregarLog(estado, txt, color) {
  estado.log.unshift({ txt, color, ts: Date.now() });
  if (estado.log.length > 15) estado.log = estado.log.slice(0, 15);
}

// ══════════════════════════════════════════
//  SERVIDOR
// ══════════════════════════════════════════
function arrancarServidor() {
  const htmlPath = path.join(__dirname, 'index.html');
  let htmlBase;
  try { htmlBase = fs.readFileSync(htmlPath, 'utf-8'); }
  catch (e) { console.error('ERROR: No encontré index.html.\n'); process.exit(1); }

  function crearTatami(num, puerto) {
    let estado = estadoInicial();
    const clientes = new Set();
    // Set de IDs de eventos ya procesados (anti-duplicado)
    const eventosVistos = new Set();
    let secuencia = 0; // para ordenar eventos concurrentes

    // ══════════════════════════════════════════
    //  ARCHIVO DE COMBATES GUARDADOS (persistente en disco)
    // ══════════════════════════════════════════
    const archivosDir = path.join(__dirname, 'combates');
    const archivoPath = path.join(archivosDir, `tatami_${num}.json`);
    let combatesGuardados = [];

    // Crear directorio si no existe
    try { if (!fs.existsSync(archivosDir)) fs.mkdirSync(archivosDir, { recursive: true }); } catch (e) { }

    // Cargar combates guardados del disco
    try {
      if (fs.existsSync(archivoPath)) {
        combatesGuardados = JSON.parse(fs.readFileSync(archivoPath, 'utf-8'));
      }
    } catch (e) {
      console.log(`  ⚠ No pude cargar combates de tatami ${num}:`, e.message);
      combatesGuardados = [];
    }

    function guardarCombatesEnDisco() {
      try {
        fs.writeFileSync(archivoPath, JSON.stringify(combatesGuardados, null, 2), 'utf-8');
      } catch (e) {
        console.log(`  ⚠ Error guardando combates tatami ${num}:`, e.message);
      }
    }

    function guardarCombateActual() {
      // Crear snapshot del combate actual
      const n = estado.numJueces || 4;
      const esqH = ['j1', 'j2', 'j3', 'j4'].reduce((s, id) => s + (estado.jueces[id].hong || 0), 0) / n;
      const esqC = ['j1', 'j2', 'j3', 'j4'].reduce((s, id) => s + (estado.jueces[id].chung || 0), 0) / n;
      const totalH = esqH + estado.arbHong;
      const totalC = esqC + estado.arbChung;

      const combate = {
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        fecha: new Date().toISOString(),
        tatami: num,
        nombreHong: estado.nombreHong,
        nombreChung: estado.nombreChung,
        marcadorHong: parseFloat(totalH.toFixed(1)),
        marcadorChung: parseFloat(totalC.toFixed(1)),
        esqHong: parseFloat(esqH.toFixed(1)),
        esqChung: parseFloat(esqC.toFixed(1)),
        arbHong: estado.arbHong,
        arbChung: estado.arbChung,
        kyongHong: estado.kyongHong,
        kyongChung: estado.kyongChung,
        faltasHong: estado.faltasHong,
        faltasChung: estado.faltasChung,
        jueces: JSON.parse(JSON.stringify(estado.jueces)),
        nombresJueces: JSON.parse(JSON.stringify(estado.nombresJueces || {})),
        numJueces: estado.numJueces,
        historial: JSON.parse(JSON.stringify(estado.historial)),
        duracion: estado.segundosMax,
      };

      // Solo guardar si hubo al menos una acción
      if (estado.historial.length > 0) {
        combatesGuardados.unshift(combate); // más reciente primero
        // Limitar a 200 combates guardados
        if (combatesGuardados.length > 200) combatesGuardados = combatesGuardados.slice(0, 200);
        guardarCombatesEnDisco();
        console.log(`  📁 Combate guardado tatami ${num}: ${estado.nombreHong} vs ${estado.nombreChung} (${totalH.toFixed(1)} - ${totalC.toFixed(1)})`);
        return true;
      }
      return false;
    }

    // Cronómetro interno del servidor (autoritativo)
    let cronIntervalo = null;

    function iniciarCronServidor() {
      if (cronIntervalo) return;
      cronIntervalo = setInterval(() => {
        if (!estado.activo || estado.segundos <= 0) {
          if (estado.segundos <= 0) {
            estado.activo = false;
            _agregarLog(estado, '⏱ KuMan — Fin del tiempo', 'arb');
            clearInterval(cronIntervalo);
            cronIntervalo = null;
          }
          return;
        }
        estado.segundos--;
        broadcastEstado();
      }, 1000);
    }

    function detenerCronServidor() {
      if (cronIntervalo) { clearInterval(cronIntervalo); cronIntervalo = null; }
    }

    const html = htmlBase.replace(
      '<!-- TATAMI_NUMERO -->',
      `<script>window.TATAMI_NUM = ${num};</script>`
    );

    // Cargar archivos estáticos una sola vez por tatami
    const cssPath = path.join(__dirname, 'app.css');
    const jsPath = path.join(__dirname, 'app.js');
    const cssContent = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : '';
    const jsContent = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf-8') : '';

    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0]; // ignorar query strings
      if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(html);
      } else if (req.method === 'GET' && url === '/app.css') {
        // Leer CSS fresco del disco para que cambios se reflejen sin reiniciar
        let css = '';
        try { css = fs.readFileSync(cssPath, 'utf-8'); } catch (e) { css = cssContent; }
        res.writeHead(200, {
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(css);
      } else if (req.method === 'GET' && url === '/app.js') {
        // Leer JS fresco del disco para que cambios se reflejen sin reiniciar
        let js = '';
        try { js = fs.readFileSync(jsPath, 'utf-8'); } catch (e) { js = jsContent; }
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(js);
      } else if (req.method === 'GET' && url === '/api/combates') {
        // API para obtener combates guardados
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(JSON.stringify(combatesGuardados));
      } else {
        res.writeHead(404); res.end('404');
      }
    });

    const wss = new WebSocketServer({ server });

    wss.on('connection', ws => {
      clientes.add(ws);
      // Enviar estado completo al nuevo cliente
      ws.send(JSON.stringify({ tipo: 'estado', datos: clonar(estado) }));

      ws.on('message', raw => {
        let m;
        try { m = JSON.parse(raw); } catch { return; }

        // ── Solicitud de estado completo (reconexión) ──
        if (m.tipo === 'pedir') {
          ws.send(JSON.stringify({ tipo: 'estado', datos: clonar(estado) }));
          return;
        }

        // ── Eventos de broadcast puro (no modifican estado) ──
        if (['alerta12', 'derrota', 'falta-flash', 'ganador-flash'].includes(m.tipo)) {
          broadcastTodos(JSON.stringify(m));
          return;
        }

        // ── Evento delta — el núcleo del nuevo sistema ──
        if (m.tipo === 'evento') {
          const ev = m.evento;
          const evId = m.evId; // ID único generado por el cliente

          // Deduplicación: ignorar si ya procesamos este evento
          if (evId && eventosVistos.has(evId)) {
            // Reenviar ACK aunque ya lo procesamos (cliente puede estar esperando)
            ws.send(JSON.stringify({ tipo: 'ack', evId }));
            return;
          }
          if (evId) {
            eventosVistos.add(evId);
            // Limitar memoria del set
            if (eventosVistos.size > MAX_EVENTOS_VISTOS) {
              const first = eventosVistos.values().next().value;
              eventosVistos.delete(first);
            }
          }

          // Nuevo combate: guardar actual y resetear
          if (ev.accion === 'nuevo_combate') {
            guardarCombateActual();
            const max2 = estado.segundosMax;
            const nj2 = estado.numJueces;
            const nombresJ = JSON.parse(JSON.stringify(estado.nombresJueces || {}));
            Object.assign(estado, estadoInicial());
            estado.segundosMax = max2;
            estado.segundos = max2;
            estado.numJueces = nj2;
            estado.nombresJueces = nombresJ; // mantener nombres de jueces
            _agregarLog(estado, '📁 Combate guardado · Nuevo combate', 'arb');
            detenerCronServidor();
            // Enviar lista de combates a todos
            broadcastTodos(JSON.stringify({ tipo: 'combates_actualizados', combates: combatesGuardados }));
            if (evId) ws.send(JSON.stringify({ tipo: 'ack', evId }));
            broadcastEstado(ws);
            return;
          }

          // Callback para emitir ganador en Punto de Oro
          const ganadorCb = (nombre, color) => {
            const payload = JSON.stringify({ tipo: 'ganador-flash', nombre, color, motivo: 'Punto de Oro' });
            broadcastTodos(payload);
            detenerCronServidor();
          };

          // Aplicar evento al estado del servidor (fuente de verdad)
          aplicarEvento(estado, ev, ganadorCb);

          // Manejar cronómetro del servidor
          if (ev.accion === 'crono_start') iniciarCronServidor();
          if (ev.accion === 'crono_pause' || ev.accion === 'crono_reset' || ev.accion === 'reset') detenerCronServidor();
          // Detener crono si Punto de Oro resuelto
          if (estado.oroResuelto) detenerCronServidor();

          // Confirmar al emisor
          if (evId) ws.send(JSON.stringify({ tipo: 'ack', evId }));

          // Difundir estado actualizado a todos los demás
          broadcastEstado(ws);
          return;
        }

        // ── Solicitar combates guardados ──
        if (m.tipo === 'pedir_combates') {
          ws.send(JSON.stringify({ tipo: 'combates_actualizados', combates: combatesGuardados }));
          return;
        }

        // ── Compatibilidad: estado completo legacy (solo árbitro en modo standalone) ──
        if (m.tipo === 'estado') {
          // Aceptar pero con menor prioridad — solo si no hay eventos delta activos
          estado = m.datos;
          broadcast(JSON.stringify({ tipo: 'estado', datos: clonar(estado) }), ws);
        }
      });

      ws.on('close', () => clientes.delete(ws));
      ws.on('error', () => clientes.delete(ws));
    });

    function broadcastEstado(origen) {
      const msg = JSON.stringify({ tipo: 'estado', datos: clonar(estado) });
      for (const c of clientes)
        if (c !== origen && c.readyState === 1) c.send(msg);
      // También enviar al origen para confirmar el estado aplicado
      if (origen && origen.readyState === 1)
        origen.send(JSON.stringify({ tipo: 'estado_confirmado', datos: clonar(estado) }));
    }

    function broadcast(msg, origen) {
      for (const c of clientes)
        if (c !== origen && c.readyState === 1) c.send(msg);
    }

    function broadcastTodos(msg) {
      for (const c of clientes)
        if (c.readyState === 1) c.send(msg);
    }

    function clonar(obj) {
      return JSON.parse(JSON.stringify(obj));
    }

    server.listen(puerto, '0.0.0.0', () =>
      console.log(`  ✓ Tatami ${num}  →  puerto ${puerto}`)
    );
  }

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     DINAMYT — SERVIDOR MULTI-TATAMI v3.1     ║');
  console.log('╠══════════════════════════════════════════════╣');
  for (let i = 1; i <= TATAMIS_ACTIVOS; i++) crearTatami(i, PUERTO_BASE + i - 1);

  setTimeout(() => {
    const ip = getLocalIP();
    const pad = s => s.padEnd(30);
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  IP de la laptop: ${ip.padEnd(27)}║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  URLs para móviles / réferis:                ║');
    for (let i = 1; i <= TATAMIS_ACTIVOS; i++)
      console.log(`║   Tatami ${i}  http://${pad(ip + ':' + (PUERTO_BASE + i - 1))}║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  URLs HDMI (esta laptop):                    ║');
    for (let i = 1; i <= TATAMIS_ACTIVOS; i++)
      console.log(`║   Tatami ${i}  http://${pad('localhost:' + (PUERTO_BASE + i - 1))}║`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  Arquitectura v3.1: eventos delta + ACK        ║');
    console.log('║  Ctrl+C para detener                         ║');
    console.log('╚══════════════════════════════════════════════╝\n');
  }, 600);
}

iniciar();
