
// ════════════════════════════════════════════════
// ESTADO GLOBAL
// ════════════════════════════════════════════════
const E = {
  nombreHong: 'Hong',
  nombreChung: 'Chung',
  // Puntos por juez de esquina (j1..j4) por color
  jueces: {
    j1: { hong: 0, chung: 0 },
    j2: { hong: 0, chung: 0 },
    j3: { hong: 0, chung: 0 },
    j4: { hong: 0, chung: 0 },
  },
  // Nombres de los réferis de esquina
  nombresJueces: { j1: '', j2: '', j3: '', j4: '' },
  // Cuántos réferis de esquina activos (2–4)
  numJueces: 4,
  // Puntos árbitro (especiales)
  arbHong: 0,
  arbChung: 0,
  // Historial para deshacer (por juez)
  historial: [],
  // Kyong-Go (advertencias)
  kyongHong: 0,
  kyongChung: 0,
  // Faltas (GamJeum) contadas
  faltasHong: 0,
  faltasChung: 0,
  // Cronómetro
  segundos: 120,
  segundosMax: 120,
  activo: false,
  // Log
  log: [],
  // Alerta 12 ya lanzada en este combate
  alerta12Lanzada: false,
  // Ronda actual: 'r1' | 'r2' | 'oro'
  ronda: 'r1',
  // Punto de Oro resuelto (servidor controla esto)
  oroResuelto: false,
};

let miRol = null;
let intervalo = null;

// Combates guardados (recibidos del servidor)
let combatesGuardados = [];

// ════════════════════════════════════════════════
// WEBSOCKET — CONEXIÓN AL SERVIDOR LOCAL
// ════════════════════════════════════════════════
let ws = null;
let wsReconectando = false;

function conectarWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[WS] Conectado');
    wsReconectando = false;
    mostrarEstadoConexion(true);
    // Solicitar estado completo al reconectar
    ws.send(JSON.stringify({ tipo: 'pedir' }));
    // Limpiar cola de eventos pendientes (serán redundantes con el estado fresco)
    if (typeof colaEventos !== 'undefined') {
      colaEventos.forEach(e => clearTimeout(e.timer));
      colaEventos.clear();
    }
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    // ACK: el servidor confirmó nuestro evento
    if (msg.tipo === 'ack') {
      recibirAck(msg.evId);
      return;
    }
    // Estado confirmado — SIEMPRE aplicar (el servidor procesó nuestro evento)
    if (msg.tipo === 'estado_confirmado') {
      aplicarEstado(msg.datos);
      return;
    }
    // Estado broadcast de otro dispositivo — solo aplicar si no tenemos cola pendiente
    // para no sobrescribir puntos locales aún no confirmados
    if (msg.tipo === 'estado') {
      if (colaEventos.size === 0) {
        aplicarEstado(msg.datos);
      }
      // Si hay cola pendiente, ignorar — el servidor nos mandará estado_confirmado
      return;
    }
    if (msg.tipo === 'alerta12') {
      mostrarAlerta12(msg.hong, msg.chung, msg.lider);
    } else if (msg.tipo === 'derrota') {
      mostrarDerrota(msg.perdedor, msg.razon);
    } else if (msg.tipo === 'falta-flash' && miRol === 'pantalla') {
      _mostrarFaltaFlash(msg.ico, msg.titulo, msg.sub, msg.tipoFalta);
    } else if (msg.tipo === 'ganador-flash') {
      // Mostrar ganador en pantalla de proyección
      _mostrarGanadorPantalla(msg.nombre, msg.color, msg.motivo);
      // Flash en todos los dispositivos
      flash('🏆', `SUNG — ${(msg.nombre || '').toUpperCase()}`);
      // Pausar cronómetro
      if (typeof pausarCrono === 'function' && E.activo) pausarCrono();
    } else if (msg.tipo === 'combates_actualizados') {
      // Actualizar lista de combates guardados
      combatesGuardados = msg.combates || [];
      renderCombatesGuardados();
    }
  };

  ws.onclose = () => {
    mostrarEstadoConexion(false);
    if (!wsReconectando) {
      wsReconectando = true;
      console.log('[WS] Desconectado, reintentando en 2s...');
      setTimeout(conectarWS, 2000);
    }
  };

  ws.onerror = () => { ws.close(); };
}

function mostrarEstadoConexion(online) {
  document.querySelectorAll('.dot').forEach(d => {
    d.style.background = online ? '#00C46A' : '#FF4444';
  });
  document.querySelectorAll('.live-dot span').forEach(s => {
    s.textContent = online ? 'EN VIVO' : 'RECONECTANDO...';
  });
}

// Iniciar conexión WS apenas carga la página
conectarWS();

// ════════════════════════════════════════════════
// FÓRMULA MARCADOR COMPUESTO
// Cada réferi de esquina contribuye 1/4 del punto.
// Ej: +1 = 0.25 por réferi. Si los 4 marcan +1, total = 1.0
// marcadorFinal = promedio(esquinas) + arbitro
// ════════════════════════════════════════════════
function sumaRawEsquinas(color) {
  // Suma bruta de puntos marcados por los 4 réferis (sin dividir)
  return ['j1', 'j2', 'j3', 'j4'].reduce((s, id) => s + (E.jueces[id][color] || 0), 0);
}

function promedioEsquinas(color) {
  // Divide entre el número de réferis de esquina activos
  const n = E.numJueces || 4;
  return sumaRawEsquinas(color) / n;
}

// Alias — sumaEsquinas ahora devuelve el promedio (valor real de contribución)
function sumaEsquinas(color) { return promedioEsquinas(color); }

function marcadorFinal(color) {
  const esq = promedioEsquinas(color);
  const arb = color === 'hong' ? E.arbHong : E.arbChung;
  return esq + arb;
}

function marcadorDisplay(color) {
  const val = marcadorFinal(color);
  if (val === 0) return '0';
  return val.toFixed(1);
}

// ════════════════════════════════════════════════
// ROL
// ════════════════════════════════════════════════
function setRol(rol) {
  miRol = rol;
  document.getElementById('rol-screen').style.display = 'none';

  if (rol.startsWith('j')) {
    document.getElementById('vista-juez').classList.add('activa');
    const labels = {
      j1: '🔴 RÉFERI ESQUINA 1',
      j2: '🔴 RÉFERI ESQUINA 2',
      j3: '🔵 RÉFERI ESQUINA 3',
      j4: '🔵 RÉFERI ESQUINA 4',
    };
    const colors = { j1: 'hong', j2: 'hong', j3: 'chung', j4: 'chung' };
    document.getElementById('juez-hdr-titulo').textContent = labels[rol];
    document.getElementById('juez-hdr-titulo').className = 'hdr-titulo ' + colors[rol];
    // Restaurar nombre del réferi
    const inp = document.getElementById('juez-nombre-input');
    if (inp) {
      // Primero intentar desde el estado del servidor
      const serverName = E.nombresJueces && E.nombresJueces[rol] ? E.nombresJueces[rol] : '';
      // Luego desde localStorage como fallback
      const savedName = localStorage.getItem('dmt_juez_nombre_' + rol) || '';
      inp.value = serverName || savedName;
      // Si hay nombre guardado localmente pero no en el servidor, enviarlo
      if (savedName && !serverName) {
        setTimeout(() => setNombreJuez(savedName), 500);
      }
    }
  } else if (rol === 'arbitro') {
    document.getElementById('vista-arbitro').classList.add('activa');
    // Solicitar combates guardados
    setTimeout(() => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ tipo: 'pedir_combates' }));
    }, 300);
  } else if (rol === 'pantalla') {
    document.getElementById('vista-pantalla').classList.add('activa');
    setTimeout(() => {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => { });
    }, 600);
  }
  renderAll();
}

// ════════════════════════════════════════════════
// ENVÍO AL SERVIDOR (reemplaza BroadcastChannel)
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
// PERSISTENCIA localStorage
// Cada dispositivo guarda su rol y estado propio.
// Al recargar, recupera la sesión automáticamente.
// ════════════════════════════════════════════════
const LS_ROL = 'dmt_rol';
const LS_STATE = 'dmt_estado';

function guardar() {
  try {
    const datos = { ...E, jueces: JSON.parse(JSON.stringify(E.jueces)) };
    datos.activo = false; // no persistir cronómetro activo
    localStorage.setItem(LS_STATE, JSON.stringify(datos));
    if (miRol) localStorage.setItem(LS_ROL, miRol);
  } catch (e) { }
}

function cargarLocal() {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (!raw) return false;
    const datos = JSON.parse(raw);
    Object.assign(E, datos);
    E.jueces = datos.jueces;
    return true;
  } catch (e) { return false; }
}

function emitir() {
  const datos = { ...E, jueces: JSON.parse(JSON.stringify(E.jueces)) };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ tipo: 'estado', datos }));
  }
  guardar();
}

function aplicarEstado(datos) {
  Object.assign(E, datos);
  E.jueces = datos.jueces;
  // Limpiar cola — el servidor tiene el estado correcto
  if (typeof colaEventos !== 'undefined') {
    colaEventos.forEach(e => clearTimeout(e.timer));
    colaEventos.clear();
  }
  guardar();
  renderAll();
}

// Al cargar, detectar sesión previa y mostrar banner de recuperación
(function restaurarSesion() {
  const rolGuardado = localStorage.getItem(LS_ROL);
  const hayEstado = cargarLocal();
  if (rolGuardado && hayEstado) {
    const rolLabel = {
      j1: 'Réferi Esquina 1 · Hong', j2: 'Réferi Esquina 2 · Hong',
      j3: 'Réferi Esquina 3 · Chung', j4: 'Réferi Esquina 4 · Chung',
      arbitro: 'Réferi Central', pantalla: 'Pantalla'
    };
    const banner = document.createElement('div');
    banner.id = 'restore-banner';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9000;' +
      'background:#0F0F1A;border-top:3px solid #E8A800;padding:16px 20px;' +
      'display:flex;align-items:center;justify-content:space-between;gap:12px;' +
      'font-family:Barlow Condensed,sans-serif;font-size:1rem;color:#EEE;' +
      'box-shadow:0 -4px 30px rgba(0,0,0,.6)';
    banner.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<span style="font-size:1.5rem">🔄</span>' +
      '<div>' +
      '<div style="font-family:Bebas Neue,cursive;font-size:1.2rem;letter-spacing:.06em;color:#E8A800">SESIÓN GUARDADA DETECTADA</div>' +
      '<div style="font-size:.85rem;color:#9090B0">Rol anterior: <strong style="color:#EEE">' + (rolLabel[rolGuardado] || rolGuardado) + '</strong> · ¿Recuperar puntos?</div>' +
      '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-shrink:0">' +
      '<button id="btn-restaurar" style="background:#E8A800;border:none;border-radius:8px;padding:10px 22px;' +
      'font-family:Bebas Neue,cursive;font-size:1rem;letter-spacing:.06em;color:#1A0F00;cursor:pointer">' +
      '↺ RECUPERAR</button>' +
      '<button id="btn-ignorar" style="background:transparent;border:1px solid #333;border-radius:8px;padding:10px 16px;' +
      'font-family:Bebas Neue,cursive;font-size:.9rem;color:#666;cursor:pointer">' +
      'IGNORAR</button>' +
      '</div>';
    document.body.appendChild(banner);
    document.getElementById('btn-restaurar').onclick = () => {
      restaurarRol(rolGuardado);
      banner.remove();
    };
    document.getElementById('btn-ignorar').onclick = () => {
      localStorage.removeItem(LS_ROL);
      localStorage.removeItem(LS_STATE);
      banner.remove();
    };
  }
})();


// ════════════════════════════════════════════════
// SISTEMA DE EVENTOS DELTA v3
// ────────────────────────────────────────────────
// Cada acción genera un evento con ID único.
// El cliente reintenta hasta recibir ACK del servidor.
// El servidor aplica el evento atómicamente → no hay race conditions.
// En modo standalone (BroadcastChannel) funciona igual pero sin ACK.
// ════════════════════════════════════════════════

const colaEventos = new Map(); // evId → { ev, intentos, timer }
const ACK_TIMEOUT = 1800;  // ms antes de reintentar
const MAX_INTENTOS = 8;     // reintentos antes de mostrar alerta

function genId() {
  // ID único: rol + timestamp + random
  return (miRol || '?') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

// Enviar evento delta — el núcleo del nuevo sistema
function enviarEvento(accion, datos) {
  const evId = genId();
  const ev = { accion, ...datos };

  // 1. Aplicar localmente de inmediato (optimistic update)
  try {
    aplicarEventoLocal(ev);
  } catch (err) {
    console.error('[DINAMYT] Error aplicando evento localmente:', err);
  }
  renderAll();
  guardar();

  // 2. Encolar para envío con reintentos
  const intento = () => {
    const entrada = colaEventos.get(evId);
    if (!entrada) return; // ya fue confirmado

    if (entrada.intentos >= MAX_INTENTOS) {
      colaEventos.delete(evId);
      // Si después de todos los intentos no hubo ACK, pedir estado completo
      console.warn('[DINAMYT] Sin ACK para', evId, '— pidiendo estado completo');
      solicitarEstado();
      return;
    }

    entrada.intentos++;

    // Enviar por WS o BroadcastChannel según modo
    if (typeof ws !== 'undefined' && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ tipo: 'evento', evId, evento: ev }));
    } else if (typeof canal !== 'undefined') {
      try {
        canal.postMessage({ tipo: 'evento', evId, evento: ev });
        // En modo canal no hay ACK, confirmar inmediatamente
        colaEventos.delete(evId);
        return;
      } catch (e) { }
    }

    // Programar reintento
    entrada.timer = setTimeout(intento, ACK_TIMEOUT * Math.min(entrada.intentos, 3));
  };

  colaEventos.set(evId, { ev, intentos: 0, timer: null });
  intento();
}

// Recibir ACK del servidor — cancelar reintentos
function recibirAck(evId) {
  const entrada = colaEventos.get(evId);
  if (entrada) {
    clearTimeout(entrada.timer);
    colaEventos.delete(evId);
  }
}

// Aplicar evento delta localmente (mismo código que el servidor)
function aplicarEventoLocal(ev) {
  switch (ev.accion) {
    case 'punto_juez':
      if (E.jueces[ev.juez]) E.jueces[ev.juez][ev.color] += ev.pts;
      E.historial.push({ juez: ev.juez, color: ev.color, pts: ev.pts, nombre: ev.nombre, tiempo: E.segundos, ronda: E.ronda });
      agregarLog(`${ev.color === 'hong' ? '🔴' : '🔵'} ${ev.nombre} +${ev.pts}`, ev.color);
      verificarAlerta12();
      // Punto de Oro: el SERVIDOR decide el ganador, no el cliente
      break;
    case 'deshacer_juez': {
      const ix = [...E.historial].reverse().findIndex(h => h.juez === ev.juez);
      if (ix !== -1) {
        const ri = E.historial.length - 1 - ix;
        const h = E.historial[ri];
        E.jueces[h.juez][h.color] -= h.pts;
        E.historial.splice(ri, 1);
        agregarLog('↩ Deshacer réferi', 'arb');
      }
      break;
    }
    case 'especial':
      if (ev.color === 'hong') E.arbHong += ev.pts; else E.arbChung += ev.pts;
      E.historial.push({ juez: 'arbitro', color: ev.color, pts: ev.pts, nombre: ev.nombre, esEspecial: true, tiempo: E.segundos, ronda: E.ronda });
      agregarLog(`${ev.color === 'hong' ? '🔴' : '🔵'} ⭐ ${ev.nombre} +${ev.pts}`, ev.color);
      verificarAlerta12();
      // Punto de Oro: el SERVIDOR decide el ganador, no el cliente
      break;
    case 'deshacer_arbitro': {
      const ix = [...E.historial].reverse().findIndex(h => h.juez === 'arbitro' && h.color === ev.color);
      if (ix !== -1) {
        const ri = E.historial.length - 1 - ix;
        const h = E.historial[ri];
        if (h.esKyongGo) {
          if (ev.color === 'hong') { E.kyongHong = Math.max(0, E.kyongHong - 1); E.arbHong += 0.5; }
          else { E.kyongChung = Math.max(0, E.kyongChung - 1); E.arbChung += 0.5; }
        } else if (h.esGamJeum) {
          if (ev.color === 'hong') { E.arbHong += 1; E.faltasHong = Math.max(0, E.faltasHong - 1); }
          else { E.arbChung += 1; E.faltasChung = Math.max(0, E.faltasChung - 1); }
        } else {
          if (ev.color === 'hong') E.arbHong -= h.pts; else E.arbChung -= h.pts;
        }
        E.historial.splice(ri, 1);
        agregarLog(`↩ Deshacer árbitro: ${ev.color}`, 'arb');
      }
      break;
    }
    case 'kyonggo':
      // KyongGo resta -0.5 al infractor
      if (ev.color === 'hong') {
        E.kyongHong++;
        E.arbHong -= 0.5;
        E.historial.push({ juez: 'arbitro', color: 'hong', nombre: `KyongGo #${E.kyongHong} (−0.5)`, pts: -0.5, esKyongGo: true, tiempo: E.segundos, ronda: E.ronda });
        agregarLog(`🔴 KyongGo #${E.kyongHong} −0.5 — Hong`, 'hong');
        flashFaltaProyeccion('⚠️', 'KYONGGO −0.5', `🔴 HONG · Advertencia #${E.kyongHong} → −0.5`, 'adv');
        if (E.kyongHong >= 6) setTimeout(() => dispararDerrota('Hong', '6 advertencias'), 300);
      } else {
        E.kyongChung++;
        E.arbChung -= 0.5;
        E.historial.push({ juez: 'arbitro', color: 'chung', nombre: `KyongGo #${E.kyongChung} (−0.5)`, pts: -0.5, esKyongGo: true, tiempo: E.segundos, ronda: E.ronda });
        agregarLog(`🔵 KyongGo #${E.kyongChung} −0.5 — Chung`, 'chung');
        flashFaltaProyeccion('⚠️', 'KYONGGO −0.5', `🔵 CHUNG · Advertencia #${E.kyongChung} → −0.5`, 'adv');
        if (E.kyongChung >= 6) setTimeout(() => dispararDerrota('Chung', '6 advertencias'), 300);
      }
      break;
    case 'gamjeum':
      if (ev.color === 'hong') { E.arbHong -= 1; E.faltasHong++; E.historial.push({ juez: 'arbitro', color: 'hong', nombre: `GamJeum #${E.faltasHong}`, pts: -1, esGamJeum: true, tiempo: E.segundos, ronda: E.ronda }); agregarLog('🔴 GamJeum −1', 'hong'); if (E.faltasHong >= 3) setTimeout(() => dispararDerrota('Hong', '3 GamJeum'), 300); }
      else { E.arbChung -= 1; E.faltasChung++; E.historial.push({ juez: 'arbitro', color: 'chung', nombre: `GamJeum #${E.faltasChung}`, pts: -1, esGamJeum: true, tiempo: E.segundos, ronda: E.ronda }); agregarLog('🔵 GamJeum −1', 'chung'); if (E.faltasChung >= 3) setTimeout(() => dispararDerrota('Chung', '3 GamJeum'), 300); }
      break;
    case 'nombres':
      E.nombreHong = ev.nombreHong || 'Hong';
      E.nombreChung = ev.nombreChung || 'Chung';
      break;
    case 'set_nombre_juez':
      if (!E.nombresJueces) E.nombresJueces = { j1:'', j2:'', j3:'', j4:'' };
      if (ev.juez) E.nombresJueces[ev.juez] = ev.nombre || '';
      break;
    case 'crono_start': E.activo = true; break;
    case 'crono_pause': E.activo = false; break;
    case 'crono_reset':
      E.activo = false;
      if (ev.segundosMax) { E.segundosMax = ev.segundosMax; }
      E.segundos = ev.segundosMax || E.segundosMax;
      break;
    case 'crono_seg': E.segundos = ev.segundos; E.activo = ev.activo; break;
    case 'ronda': E.ronda = ev.ronda; break;
    case 'set_num_jueces':
      E.numJueces = Math.max(2, Math.min(4, ev.numJueces || 4));
      agregarLog(`🔢 Réferis esquina: ${E.numJueces}`, 'arb');
      break;
    case 'reset':
      clearInterval(intervalo); intervalo = null;
      const mx = E.segundosMax;
      const nj = E.numJueces;
      const njNames = JSON.parse(JSON.stringify(E.nombresJueces || {}));
      Object.assign(E, {
        jueces: { j1: { hong: 0, chung: 0 }, j2: { hong: 0, chung: 0 }, j3: { hong: 0, chung: 0 }, j4: { hong: 0, chung: 0 } },
        nombresJueces: njNames,
        numJueces: nj,
        arbHong: 0, arbChung: 0, historial: [], kyongHong: 0, kyongChung: 0,
        faltasHong: 0, faltasChung: 0, segundos: mx, activo: false,
        log: [], alerta12Lanzada: false, ronda: 'r1',
        oroResuelto: false,
      });
      E.segundosMax = mx;
      break;
    case 'nuevo_combate':
      // El servidor guarda el combate. Localmente hacemos reset igual que 'reset'
      clearInterval(intervalo); intervalo = null;
      const mx2 = E.segundosMax;
      const nj2 = E.numJueces;
      const njNames2 = JSON.parse(JSON.stringify(E.nombresJueces || {}));
      Object.assign(E, {
        jueces: { j1: { hong: 0, chung: 0 }, j2: { hong: 0, chung: 0 }, j3: { hong: 0, chung: 0 }, j4: { hong: 0, chung: 0 } },
        nombresJueces: njNames2,
        numJueces: nj2,
        arbHong: 0, arbChung: 0, historial: [], kyongHong: 0, kyongChung: 0,
        faltasHong: 0, faltasChung: 0, segundos: mx2, activo: false,
        log: [], alerta12Lanzada: false, ronda: 'r1',
        oroResuelto: false,
      });
      E.segundosMax = mx2;
      agregarLog('📁 Combate guardado · Nuevo combate', 'arb');
      break;
  }
}

function solicitarEstado() {
  if (typeof ws !== 'undefined' && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ tipo: 'pedir' }));
  } else if (typeof canal !== 'undefined') {
    try { canal.postMessage({ tipo: 'pedir' }); } catch (e) { }
  }
}

// Indicador visual de cola pendiente
function actualizarIndicadorRed() {
  const pendientes = colaEventos.size;
  document.querySelectorAll('.dot').forEach(d => {
    d.style.background = pendientes > 0 ? '#FF9800' : '#00C46A';
  });
  document.querySelectorAll('.live-dot span').forEach(s => {
    if (pendientes > 0) s.textContent = `ENVIANDO (${pendientes})`;
    else s.textContent = 'EN VIVO';
  });
}

// Actualizar indicador cada 500ms
setInterval(actualizarIndicadorRed, 500);

function restaurarRol(rol) {
  setRol(rol);
  setTimeout(() => solicitarEstado(), 400);
}

// ════════════════════════════════════════════════
// JUECES DE ESQUINA
// ════════════════════════════════════════════════
function anotarJuez(color, pts, nombre) {
  if (!miRol || !miRol.startsWith('j')) return;
  flash(color === 'hong' ? '🔴' : '🔵', `+${pts} JEUMSU`);
  enviarEvento('punto_juez', { juez: miRol, color, pts, nombre });
}

function deshacerJuez() {
  if (!miRol || !miRol.startsWith('j')) return;
  const hay = E.historial.some(h => h.juez === miRol);
  if (!hay) { flash('⚠️', 'NADA QUE DESHACER'); return; }
  enviarEvento('deshacer_juez', { juez: miRol });
}

// ════════════════════════════════════════════════
// ÁRBITRO — ESPECIALES
// ════════════════════════════════════════════════
function arbEspecial(color, pts, nombre) {
  const emoji = color === 'hong' ? '🔴' : '🔵';
  flashFaltaProyeccion('⭐', `+${pts} PUNTO${pts > 1 ? 'S' : ''}`, `${emoji} ${nombre.toUpperCase()}`, 'especial');
  enviarEvento('especial', { color, pts, nombre });
}

function deshacerArbitro(color) {
  const hay = E.historial.some(h => h.juez === 'arbitro' && h.color === color);
  if (!hay) {
    flash('⚠️', 'NADA QUE DESHACER');
    actualizarLabelDeshacer('Sin acciones del Réferi para ' + color);
    return;
  }
  enviarEvento('deshacer_arbitro', { color });
}

function deshacerEspecial(color) { deshacerArbitro(color); }

function actualizarLabelDeshacer(texto) {
  const el = document.getElementById('arb-ultimo-label');
  if (el) el.textContent = texto;
}

function arbAdvertencia(color, tipo) {
  const num = color === 'hong' ? E.kyongHong + 1 : E.kyongChung + 1;
  // Flash rápido en réferi central
  flash('⚠️', `KYONGGO −0.5 ${color.toUpperCase()}`);
  if (num === 6) flash('🚫', `6ª ADV → DQ ${color.toUpperCase()}`);
  enviarEvento('kyonggo', { color });
}

function arbGamjeum(color) {
  const faltas = (color === 'hong' ? E.faltasHong : E.faltasChung) + 1;
  flashFaltaProyeccion('🚫', 'GAMJEUM', `${color === 'hong' ? '🔴 HONG' : '🔵 CHUNG'} · Falta #${faltas} · −1 punto`, 'falta');
  enviarEvento('gamjeum', { color });
}

function arbDQ(color) {
  const nombre = color === 'hong' ? E.nombreHong : E.nombreChung;
  const rival = color === 'hong' ? E.nombreChung : E.nombreHong;
  const rivalColor = color === 'hong' ? 'chung' : 'hong';
  if (!confirm(`¿Confirmar descalificación de ${nombre}?`)) return;
  if (typeof pausarCrono === 'function') pausarCrono();
  agregarLog(`🚫 DESCALIFICACIÓN — ${nombre.toUpperCase()}`, 'arb');
  // 1. Flash de DESCALIFICADO en pantalla de proyección
  flashFaltaProyeccion('🚫', 'DESCALIFICADO', `${color === 'hong' ? '🔴' : '🔵'} ${nombre.toUpperCase()}`, 'falta');
  // 2. Tras 2.5s mostrar al rival como ganador en pantalla de proyección
  setTimeout(() => {
    const payload = { tipo: 'ganador-flash', nombre: rival, color: rivalColor, motivo: 'DQ — Descalificación del oponente' };
    if (typeof canal !== 'undefined') { try { canal.postMessage(payload); } catch (e) { } }
    if (typeof ws !== 'undefined' && ws && ws.readyState === 1) { ws.send(JSON.stringify(payload)); }
    // Solo la pantalla de proyección muestra el overlay de ganador
    // El réferi central no necesita verlo
  }, 2500);
  renderAll();
  emitir();
}

function actualizarNombres() {
  const nh = document.getElementById('inp-hong').value || 'Hong';
  const nc = document.getElementById('inp-chung').value || 'Chung';
  enviarEvento('nombres', { nombreHong: nh, nombreChung: nc });
}

function resetTotal() {
  if (!confirm('¿Reiniciar marcador? Los puntos se perderán. Si quieres guardarlos, usa "Nuevo Combate" en su lugar.')) return;
  limpiarTodo();
}

function nuevoCombate() {
  if (!confirm('¿Guardar este combate e iniciar uno nuevo?')) return;
  enviarEvento('nuevo_combate', {});
  flash('📁', 'COMBATE GUARDADO');
  // Solicitar la lista actualizada de combates
  setTimeout(() => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ tipo: 'pedir_combates' }));
  }, 500);
}

function setNombreJuez(nombre) {
  if (!miRol || !miRol.startsWith('j')) return;
  enviarEvento('set_nombre_juez', { juez: miRol, nombre: nombre });
  // Guardar localmente para persistencia al recargar
  try { localStorage.setItem('dmt_juez_nombre_' + miRol, nombre); } catch(e) {}
}

function limpiarTodo() {
  clearInterval(intervalo); intervalo = null;
  enviarEvento('reset', {});
}

// ════════════════════════════════════════════════
// CRONÓMETRO
// ════════════════════════════════════════════════
function toggleCrono() {
  if (E.activo) pausarCrono(); else iniciarCrono();
}

function iniciarCrono() {
  if (E.segundos <= 0 || E.activo) return;
  // Solo avisar al servidor que inicie. El servidor es el único cronómetro.
  // El árbitro actualiza su display cuando recibe el estado del servidor cada segundo.
  enviarEvento('crono_start', {});
  E.activo = true;
  renderAll();
}

function pausarCrono() {
  clearInterval(intervalo); intervalo = null;
  enviarEvento('crono_pause', {});
}

function resetCrono() {
  clearInterval(intervalo); intervalo = null;
  enviarEvento('crono_reset', { segundosMax: E.segundosMax });
}

function setDur(seg, btn) {
  clearInterval(intervalo); intervalo = null;
  document.querySelectorAll('.db').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  enviarEvento('crono_reset', { segundosMax: seg });
}

// ════════════════════════════════════════════════
// ALERTA 12 PUNTOS
// ════════════════════════════════════════════════
function verificarAlerta12() {
  if (E.alerta12Lanzada) return;
  const fh = marcadorFinal('hong');
  const fc = marcadorFinal('chung');
  const diff = Math.abs(fh - fc);
  if (diff >= 12) {
    E.alerta12Lanzada = true;
    // Notificar a todos vía canal
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ tipo: 'alerta12', hong: fh.toFixed(1), chung: fc.toFixed(1), lider: fh > fc ? 'Hong' : 'Chung' }));
    }
    mostrarAlerta12(fh.toFixed(1), fc.toFixed(1), fh > fc ? 'Hong' : 'Chung');
  }
}

// alerta12 ya se maneja en ws.onmessage arriba

function mostrarAlerta12(h, c, lider) {
  document.getElementById('alerta-h').textContent = h;
  document.getElementById('alerta-c').textContent = c;
  document.getElementById('alerta-desc').textContent = `${lider} lidera por ≥12 puntos · El Réferi Central evalúa`;
  document.getElementById('alerta-12').classList.add('visible');
}

function cerrarAlerta() {
  document.getElementById('alerta-12').classList.remove('visible');
}

// ════════════════════════════════════════════════
// LOG
// ════════════════════════════════════════════════
function agregarLog(txt, color) {
  E.log.unshift({ txt, color, ts: Date.now() });
  if (E.log.length > 10) E.log = E.log.slice(0, 10);
}

// ════════════════════════════════════════════════
// FLASH
// ════════════════════════════════════════════════
let _flashT = null;
function flash(ico, txt) {
  const el = document.getElementById('flash');
  document.getElementById('flash-ico').textContent = ico;
  document.getElementById('flash-txt').textContent = txt;
  el.classList.add('on');
  clearTimeout(_flashT);
  _flashT = setTimeout(() => el.classList.remove('on'), 1100);
}

// ════════════════════════════════════════════════
// RONDA
// ════════════════════════════════════════════════
function setRonda(r) {
  enviarEvento('ronda', { ronda: r });
}

function setNumJueces(n) {
  enviarEvento('set_num_jueces', { numJueces: n });
}

// ════════════════════════════════════════════════
// VOLVER AL MENÚ
// ════════════════════════════════════════════════
function volverMenu() {
  if (!confirm('¿Volver al menú de roles? Los puntos están guardados y se pueden recuperar.')) return;
  // Ocultar todas las vistas
  document.querySelectorAll('.vista').forEach(v => v.classList.remove('activa'));
  // Mostrar pantalla de rol
  document.getElementById('rol-screen').style.display = '';
  // Detener cronómetro si estaba activo
  if (intervalo) { clearInterval(intervalo); intervalo = null; E.activo = false; }
  miRol = null;
}

// ════════════════════════════════════════════════
// DECLARAR GANADOR (Réferi Central)
// ════════════════════════════════════════════════
function declararGanador(color, automatico) {
  const nombre = color === 'hong' ? E.nombreHong : E.nombreChung;
  if (!automatico && !confirm(`¿Declarar ganador a ${nombre}?`)) return;
  const payload = { tipo: 'ganador-flash', nombre, color };
  if (typeof canal !== 'undefined') {
    try { canal.postMessage(payload); } catch (e) { }
  }
  if (typeof ws !== 'undefined' && ws && ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
  // Pausar cronómetro automáticamente
  if (typeof pausarCrono === 'function') pausarCrono();
  _mostrarGanadorPantalla(nombre, color);
  agregarLog(`🏆 SUNG — ${nombre.toUpperCase()} GANA`, 'arb');
  flash('🏆', `SUNG — ${nombre.toUpperCase()}`);
  emitir();
}

function _mostrarGanadorPantalla(nombre, color, motivo) {
  const el = document.getElementById('ganador-overlay');
  if (!el) return;
  const nm = document.getElementById('ganador-nombre');
  if (nm) { nm.textContent = nombre.toUpperCase(); nm.className = 'ganador-nombre ' + color; }
  // Mostrar motivo si viene (ej: "Descalificación del oponente")
  const sub = document.getElementById('ganador-sub');
  if (sub) sub.textContent = motivo || 'CAMPEONATO HAPKIDO · GHA';
  el.classList.add('visible');
}

// ════════════════════════════════════════════════
// DERROTA AUTOMÁTICA
// ════════════════════════════════════════════════
function dispararDerrota(nombrePerdedor, razon) {
  if (intervalo) { clearInterval(intervalo); intervalo = null; }
  E.activo = false;
  agregarLog(`🚫 DQ AUTOMÁTICA — ${nombrePerdedor}: ${razon}`, 'arb');
  renderAll();
  emitir();

  // Modal de derrota en todos los dispositivos
  const payload = { tipo: 'derrota', perdedor: nombrePerdedor, razon };
  if (typeof canal !== 'undefined') {
    canal.postMessage(payload);
  } else if (typeof ws !== 'undefined' && ws && ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
  mostrarDerrota(nombrePerdedor, razon);

  // Mostrar al rival como ganador en pantalla de proyección tras 2.5s
  const esHong = nombrePerdedor.toLowerCase().includes('hong') ||
    nombrePerdedor === E.nombreHong;
  const rivalColor = esHong ? 'chung' : 'hong';
  const rivalNombre = esHong ? E.nombreChung : E.nombreHong;
  setTimeout(() => {
    const gPayload = { tipo: 'ganador-flash', nombre: rivalNombre, color: rivalColor, motivo: 'DQ — ' + razon };
    if (typeof canal !== 'undefined') { try { canal.postMessage(gPayload); } catch (e) { } }
    if (typeof ws !== 'undefined' && ws && ws.readyState === 1) { ws.send(JSON.stringify(gPayload)); }
    _mostrarGanadorPantalla(rivalNombre, rivalColor, 'DQ — ' + razon);
  }, 2500);
}

function mostrarDerrota(perdedor, razon) {
  // El modal de derrota solo aparece en el réferi central
  // La pantalla de proyección usa el overlay de ganador (ver dispararDerrota)
  if (miRol !== 'arbitro') return;
  document.getElementById('derrota-perdedor').textContent = perdedor.toUpperCase();
  document.getElementById('derrota-razon').textContent = razon;
  document.getElementById('alerta-derrota').classList.add('visible');
}

function cerrarDerrota() {
  document.getElementById('alerta-derrota').classList.remove('visible');
}

// ════════════════════════════════════════════════
// FLASH FALTA GRANDE EN PROYECCIÓN
// Aparece en TODOS los dispositivos, no solo pantalla
// ════════════════════════════════════════════════
let _pffTimer = null;
function flashFaltaProyeccion(ico, titulo, sub, tipo) {
  // Emitir evento al canal para que la pantalla de proyección lo muestre
  const payload = { tipo: 'falta-flash', ico, titulo, sub, tipoFalta: tipo || 'adv' };
  if (typeof canal !== 'undefined') {
    try { canal.postMessage(payload); } catch (e) { }
  }
  if (typeof ws !== 'undefined' && ws && ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
  // Si este dispositivo ES la pantalla, mostrar directamente
  if (miRol === 'pantalla') {
    _mostrarFaltaFlash(ico, titulo, sub, tipo);
  }
}

function _mostrarFaltaFlash(ico, titulo, sub, tipo) {
  const el = document.getElementById('proy-falta-flash');
  if (!el) return;
  document.getElementById('pff-ico').textContent = ico;
  document.getElementById('pff-titulo').textContent = titulo;
  document.getElementById('pff-sub').textContent = sub;
  const box = document.getElementById('pff-box');
  if (box) { box.className = 'pff-box ' + (tipo || 'adv'); }
  el.classList.add('on');
  clearTimeout(_pffTimer);
  _pffTimer = setTimeout(() => el.classList.remove('on'), 3000);
}

// ════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════
const prevScores = { hong: -1, chung: -1 };

function fmt(seg) {
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
}

function renderAll() {
  const mh = marcadorFinal('hong');
  const mc2 = marcadorFinal('chung');
  const mhD = marcadorDisplay('hong');
  const mcD = marcadorDisplay('chung');
  const esqH = promedioEsquinas('hong').toFixed(1);
  const esqC = promedioEsquinas('chung').toFixed(1);

  const t = fmt(E.segundos);
  const urgente = E.segundos <= 10 && E.activo;
  const detenido = !E.activo;

  // ── Juez de esquina ──
  if (miRol && miRol.startsWith('j')) {
    if (miRol && E.jueces[miRol]) {
      const mj = E.jueces[miRol];
      // Mostrar puntos crudos (como si sumara +1, +2, +3)
      setTxt('juez-mis-h', mj.hong);
      setTxt('juez-mis-c', mj.chung);
    }
  }

  // ── Árbitro ──
  if (miRol === 'arbitro') {
    setTxtScore('arb-mc-h', mhD);
    setTxtScore('arb-mc-c', mcD);
    const sumHa = promedioEsquinas('hong');
    const sumCa = promedioEsquinas('chung');
    setTxt('arb-des-h', `Esq: ${sumHa.toFixed(1)} (÷${E.numJueces || 4}) · Arb: ${E.arbHong}`);
    setTxt('arb-des-c', `Esq: ${sumCa.toFixed(1)} (÷${E.numJueces || 4}) · Arb: ${E.arbChung}`);

    const cr = document.getElementById('arb-crono');
    if (cr) {
      cr.textContent = t;
      cr.className = 'crono-display ' + (urgente ? 'urgente' : detenido ? 'pause' : 'activo');
    }
    const cbGo = document.getElementById('cb-go');
    if (cbGo) cbGo.textContent = E.activo ? '⏸ GALLYOE' : '▶ SHECHAK';

    // Chips de jueces — mostrar nombre si está disponible
    ['j1', 'j2', 'j3', 'j4'].forEach((id, i) => {
      const n = i + 1;
      const nombre = (E.nombresJueces && E.nombresJueces[id]) ? E.nombresJueces[id] : '';
      const nomEl = document.getElementById(`chip-${id}-nom`);
      if (nomEl) nomEl.textContent = nombre || id.toUpperCase();
      setTxt(`chip-${id}-h`, `H:${E.jueces[id].hong}`);
      setTxt(`chip-${id}-c`, `C:${E.jueces[id].chung}`);
    });

    // Sync numJueces buttons
    [2, 3, 4].forEach(n => {
      const btn = document.getElementById('nj-' + n);
      if (btn) btn.classList.toggle('on', n === (E.numJueces || 4));
    });

    setTxt('arb-kyong-h', E.kyongHong);
    setTxt('arb-kyong-c', E.kyongChung);
    // Sync ronda buttons
    ['r1', 'r2', 'oro'].forEach(k => {
      const btn = document.getElementById('rb-' + k);
      if (btn) btn.classList.toggle('on', k === (E.ronda || 'r1'));
    });
    // Label de última acción del árbitro
    const ultimaArb = [...E.historial].reverse().find(h => h.juez === 'arbitro');
    actualizarLabelDeshacer(ultimaArb
      ? `Última acción: ${ultimaArb.nombre || 'acción'} — ${ultimaArb.color}`
      : 'Sin acciones registradas aún');

    // Historial detallado
    const histEl = document.getElementById('arb-historial-body');
    if (histEl) {
      const rows = [...E.historial].reverse().slice(0, 30).map(h => {
        const colorEmoji = h.color === 'hong' ? '🔴' : '🔵';
        const colorClass = h.color === 'hong' ? 'lc-hong' : 'lc-chung';
        const juezLabel = h.juez === 'arbitro' ? 'Central' : h.juez.toUpperCase();
        const tiempoStr = h.tiempo !== undefined ? fmt(h.tiempo) : '—';
        const ptsStr = h.pts > 0 ? `+${h.pts}` : `${h.pts}`;
        return `<div class="hist-row ${colorClass}">`
          + `<span class="hist-tiempo">${tiempoStr}</span>`
          + `<span class="hist-juez">${juezLabel}</span>`
          + `<span class="hist-desc">${colorEmoji} ${h.nombre || 'acción'}</span>`
          + `<span class="hist-pts">${ptsStr}</span>`
          + `</div>`;
      }).join('');
      histEl.innerHTML = rows || '<div style="color:var(--gris);text-align:center;padding:8px">Sin acciones aún</div>';
    }

    // Desglose por ronda
    const rondasEl = document.getElementById('arb-rondas-desglose');
    if (rondasEl) {
      const rondas = ['r1', 'r2', 'oro'];
      const rondaNames = { r1: 'Round 1', r2: 'Round 2', oro: 'Punto de Oro' };
      const n = E.numJueces || 4;
      let html = '';
      let hayPuntos = false;
      rondas.forEach(r => {
        const entradas = E.historial.filter(h => h.ronda === r);
        if (entradas.length === 0) return;
        hayPuntos = true;
        // Calcular puntos esquinas por ronda (raw / numJueces)
        let esqHongRaw = 0, esqChungRaw = 0;
        let arbHongR = 0, arbChungR = 0;
        entradas.forEach(h => {
          if (h.juez !== 'arbitro') {
            if (h.color === 'hong') esqHongRaw += h.pts;
            else esqChungRaw += h.pts;
          } else {
            if (h.color === 'hong') arbHongR += h.pts;
            else arbChungR += h.pts;
          }
        });
        const esqH = (esqHongRaw / n).toFixed(1);
        const esqC = (esqChungRaw / n).toFixed(1);
        const totalH = (esqHongRaw / n + arbHongR).toFixed(1);
        const totalC = (esqChungRaw / n + arbChungR).toFixed(1);
        const isCurrentRound = (E.ronda === r);
        html += `<div class="ronda-card ${isCurrentRound ? 'ronda-actual' : ''}">`;
        html += `<div class="ronda-card-header">${rondaNames[r]}${isCurrentRound ? ' <span class="ronda-badge-actual">ACTUAL</span>' : ''}</div>`;
        html += `<div class="ronda-card-scores">`;
        html += `<div class="ronda-score-block"><span class="ronda-lbl-color h">🔴 Hong</span><span class="ronda-score-val h">${totalH}</span><span class="ronda-score-det">Esq:${esqH} Arb:${arbHongR > 0 ? '+' : ''}${arbHongR}</span></div>`;
        html += `<div class="ronda-score-vs">VS</div>`;
        html += `<div class="ronda-score-block"><span class="ronda-lbl-color c">🔵 Chung</span><span class="ronda-score-val c">${totalC}</span><span class="ronda-score-det">Esq:${esqC} Arb:${arbChungR > 0 ? '+' : ''}${arbChungR}</span></div>`;
        html += `</div></div>`;
      });
      rondasEl.innerHTML = hayPuntos ? html : '<div style="color:var(--gris);text-align:center;padding:8px;font-size:.78rem">Sin puntos aún</div>';
    }
  }

  // ── Pantalla ──
  if (miRol === 'pantalla') {
    // Ronda badge
    const rondaLabels = { r1: 'ILHaeJon — ROUND 1', r2: 'EeHaeJon — ROUND 2', oro: '★ PUNTO DE ORO' };
    const pr = document.getElementById('proy-ronda');
    if (pr) { pr.textContent = rondaLabels[E.ronda || 'r1']; pr.className = 'proy-ronda-badge ' + (E.ronda || 'r1'); }
    setTxt('pn-hong', E.nombreHong);
    setTxt('pn-chung', E.nombreChung);

    animScore('ps-hong', mhD, 'hong');
    animScore('ps-chung', mcD, 'chung');

    const sumH = promedioEsquinas('hong');
    const sumC = promedioEsquinas('chung');
    const desgH = `Esq: ${sumH.toFixed(1)} · Arb: +${E.arbHong}` +
      `<br><span style="color:rgba(255,100,80,.5)">Adv: −${(E.kyongHong * 0.5).toFixed(1)} · Falta: −${E.faltasHong}</span>`;
    const desgC = `Esq: ${sumC.toFixed(1)} · Arb: +${E.arbChung}` +
      `<br><span style="color:rgba(255,100,80,.5)">Adv: −${(E.kyongChung * 0.5).toFixed(1)} · Falta: −${E.faltasChung}</span>`;
    const pdH = document.getElementById('pd-hong');
    const pdC = document.getElementById('pd-chung');
    if (pdH) pdH.innerHTML = desgH;
    if (pdC) pdC.innerHTML = desgC;

    const pc = document.getElementById('proy-crono');
    if (pc) {
      pc.textContent = t;
      pc.className = 'proy-crono ' + (urgente ? 'urgente' : detenido ? 'pause' : '');
    }
    const pe = document.getElementById('proy-estado');
    if (pe) {
      pe.textContent = E.activo ? '▶ KAESOK' : (E.segundos === 0 ? '⏱ KUMAN' : '⏸ GALLYOE');
      pe.className = 'proy-estado ' + (E.activo ? 'go' : 'espera');
    }

    // Badges
    renderBadges('pb-hong', E.kyongHong, E.faltasHong);
    renderBadges('pb-chung', E.kyongChung, E.faltasChung);

    // Log
    const logEl = document.getElementById('proy-log');
    if (logEl) {
      logEl.innerHTML = E.log.slice(0, 6).map(l => {
        const cls = l.color === 'hong' ? 'lc-hong' : l.color === 'chung' ? 'lc-chung' : 'lc-arb';
        return `<span class="log-chip ${cls}">${l.txt}</span>`;
      }).join('');
    }
  }
}

function animScore(id, val, color) {
  const el = document.getElementById(id);
  if (!el) return;
  const animar = prevScores[color] !== val;
  el.textContent = val;
  if (parseFloat(val) < 0) el.classList.add('score-negativo');
  else el.classList.remove('score-negativo');
  if (animar) {
    el.classList.remove('boom');
    void el.offsetWidth;
    el.classList.add('boom');
    prevScores[color] = val;
  }
}

function renderBadges(id, adv, faltas) {
  const el = document.getElementById(id);
  if (!el) return;
  let html = '';
  if (adv > 0) html += `<span class="badge badge-adv">KyongGo: ${adv}</span>`;
  if (faltas > 0) html += `<span class="badge badge-falta">GamJeum: ${faltas}</span>`;
  el.innerHTML = html;
}

function setTxt(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setTxtScore(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  if (parseFloat(val) < 0) {
    el.classList.add('score-negativo');
  } else {
    el.classList.remove('score-negativo');
  }
}

// El estado se solicita automáticamente en ws.onopen

// ════════════════════════════════════════════════
// NÚMERO DE TATAMI — inyectado por el servidor
// ════════════════════════════════════════════════
(function initTatami() {
  const num = window.TATAMI_NUM || null;
  if (!num) return;
  document.title = 'DINAMYT — TATAMI ' + num;
  const numLabel = document.getElementById('tatami-num-label');
  if (numLabel) numLabel.textContent = num;
  const badge = document.getElementById('tatami-badge');
  if (badge) badge.style.display = 'block';
  document.querySelectorAll('.tatami-indicator').forEach(el => {
    el.textContent = 'TATAMI ' + num;
    el.style.color = 'var(--gold)';
  });
  const pt = document.getElementById('proy-tatami-txt');
  if (pt) pt.textContent = 'TATAMI ' + num;
})();

// ════════════════════════════════════════════════
// COMBATES GUARDADOS — Render en vista árbitro
// ════════════════════════════════════════════════
function renderCombatesGuardados() {
  const el = document.getElementById('arb-combates-body');
  if (!el) return;
  if (!combatesGuardados || combatesGuardados.length === 0) {
    el.innerHTML = '<div style="color:var(--gris);text-align:center;padding:16px;font-size:.8rem">No hay combates guardados aún.<br>Presiona "Nuevo Combate" para guardar el combate actual.</div>';
    // Update counter
    const counter = document.getElementById('arb-combates-count');
    if (counter) counter.textContent = '0';
    return;
  }
  const counter = document.getElementById('arb-combates-count');
  if (counter) counter.textContent = combatesGuardados.length;

  el.innerHTML = combatesGuardados.slice(0, 50).map((c, i) => {
    const fecha = new Date(c.fecha);
    const fechaStr = fecha.toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' })
      + ' ' + fecha.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
    const ganador = c.marcadorHong > c.marcadorChung ? 'hong'
      : c.marcadorChung > c.marcadorHong ? 'chung' : 'empate';
    const ganadorIcon = ganador === 'hong' ? '🔴' : ganador === 'chung' ? '🔵' : '🤝';
    const ganadorNombre = ganador === 'hong' ? c.nombreHong : ganador === 'chung' ? c.nombreChung : 'Empate';

    // Nombres de jueces
    const nj = c.nombresJueces || {};
    const juecesInfo = ['j1','j2','j3','j4']
      .filter((j, idx) => idx < (c.numJueces || 4))
      .map(j => {
        const nombre = nj[j] || j.toUpperCase();
        const pts = c.jueces && c.jueces[j] ? `H:${c.jueces[j].hong} C:${c.jueces[j].chung}` : '';
        return `<span class="cg-juez-chip">${nombre} <small>${pts}</small></span>`;
      }).join('');

    return `<div class="cg-card">`
      + `<div class="cg-header">`
      + `<span class="cg-fecha">${fechaStr}</span>`
      + `<span class="cg-ganador-badge ${ganador}">${ganadorIcon} ${ganadorNombre}</span>`
      + `</div>`
      + `<div class="cg-scores">`
      + `<div class="cg-comp h">`
      + `<div class="cg-comp-name">🔴 ${c.nombreHong}</div>`
      + `<div class="cg-comp-score">${c.marcadorHong}</div>`
      + `<div class="cg-comp-det">Esq:${c.esqHong} Arb:${c.arbHong}</div>`
      + `</div>`
      + `<div class="cg-vs">VS</div>`
      + `<div class="cg-comp c">`
      + `<div class="cg-comp-name">🔵 ${c.nombreChung}</div>`
      + `<div class="cg-comp-score">${c.marcadorChung}</div>`
      + `<div class="cg-comp-det">Esq:${c.esqChung} Arb:${c.arbChung}</div>`
      + `</div>`
      + `</div>`
      + `<div class="cg-extras">`
      + `<span>Adv: H=${c.kyongHong || 0} C=${c.kyongChung || 0}</span>`
      + `<span>Faltas: H=${c.faltasHong || 0} C=${c.faltasChung || 0}</span>`
      + `<span>Dur: ${Math.floor((c.duracion||120)/60)}:${String((c.duracion||120)%60).padStart(2,'0')}</span>`
      + `</div>`
      + `<div class="cg-jueces">Réferis: ${juecesInfo}</div>`
      + `</div>`;
  }).join('');
}

