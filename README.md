# DINAMYT — Sistema de campeonatos de combate y figuras

DINAMYT es una plataforma web para **gestionar y puntuar campeonatos de hapkido
en vivo**. Permite a un administrador organizar el evento (campeonatos, tatamis,
categorías, llaves y asignación de jueces) y a los jueces centrales puntuar
combates y figuras en tiempo real, mientras el público sigue el marcador en una
pantalla proyectada en TV.

Está pensada para usarse en polideportivos con **internet intermitente**: incluye
un modo sin conexión que permite a cada juez seguir registrando localmente y un
tablero local que el Juez Central proyecta aunque se caiga la red.

---

## Características

- **Roles diferenciados**: administrador y juez central, con autenticación JWT.
- **Tiempo real** vía Socket.IO (namespace `/combate`): el marcador del juez se
  refleja al instante en la pantalla pública y demás dispositivos.
- **Dos modalidades**:
  - **Combate** — motor de puntuación con marcador en vivo.
  - **Figuras** — evaluación por jueces con podio automático.
- **Gestión completa** de campeonatos, hasta **6 tatamis**, categorías canónicas,
  llaves (modelo unificado: `pendiente` / `activa` / `terminada`) y asignación de
  hasta 4 jueces.
- **Pantalla pública** para TV: elige campeonato y tatami y muestra el marcador.
- **Modo sin conexión**: registro local por juez + tablero local del JC (`/tablero`)
  que proyecta a la TV sin servidor en LAN.
- **Reportes** exportables a **Excel y PDF** (openpyxl + reportlab).
- **PWA**: instalable en escritorio y con soporte offline en la pantalla pública.

---

## Arquitectura

```
DINAMYT-COMBAT/
├── backend/          API REST + Socket.IO (Flask)
│   └── app/
│       ├── api/        Endpoints REST (auth, campeonatos, categorias,
│       │               tatamis, llaves, combates, reportes)
│       ├── sockets/    Namespace de tiempo real (/combate)
│       ├── engine/     Motores de puntuación (combate y figuras)
│       ├── models/     Modelos SQLAlchemy (usuario, campeonato, categoria,
│       │               tatami, asignacion, combate, llave)
│       ├── seeds/      Datos iniciales (categorías, admin)
│       └── config.py   Configuración por entorno
└── frontend/         Aplicación web (Next.js)
    └── src/app/        Rutas: /login, /admin, /juez, /tatami,
                        /pantalla (pública), /tablero (local del JC)
```

### Stack

| Capa         | Tecnología                                                        |
| ------------ | ----------------------------------------------------------------- |
| Frontend     | Next.js 16, React 19, TypeScript, Tailwind CSS 4, socket.io-client |
| Backend      | Flask 3, Flask-SocketIO, Flask-SQLAlchemy, Flask-JWT-Extended      |
| Base de datos | PostgreSQL en producción · SQLite en local                       |
| Reportes     | openpyxl (Excel) · reportlab (PDF)                                 |
| Tiempo real  | Socket.IO sobre eventlet (gunicorn, 1 worker)                     |

> ⚠️ **Un solo worker (`-w 1`) es obligatorio**: el estado en vivo de los tatamis
> vive en memoria del proceso. Por diseño no hay escalado multiproceso
> (6 tatamis ≈ 80 conexiones, que un proceso único maneja de sobra).

---

## Desarrollo local

### Requisitos

- Python 3.11+ (en local se usa SQLite, sin necesidad de PostgreSQL)
- Node.js 18+

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows  (source venv/bin/activate en Linux/macOS)
pip install -r requirements.txt
copy .env.example .env          # crea tu .env y ajusta los valores
python run.py
```

El backend levanta:

- API REST en `http://localhost:5000`
- Socket.IO en `http://localhost:5000/combate`

En modo `development` crea las tablas y ejecuta los seeds (categorías + admin)
automáticamente.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Abre `http://localhost:3000`. Configura el `.env.local` con:

```
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_SOCKET_URL=http://localhost:5000
```

---

## Despliegue gratuito en internet

El proyecto se despliega completo usando solo planes gratuitos
(tiempo estimado: 30–45 min).

| Pieza                         | Herramienta                            | Costo  |
| ----------------------------- | -------------------------------------- | ------ |
| Frontend (Next.js)            | [Vercel](https://vercel.com)           | Gratis |
| Backend (Flask + Socket.IO)   | [Render](https://render.com)           | Gratis |
| Base de datos (PostgreSQL)    | [Neon](https://neon.tech)              | Gratis |
| Mantener el backend despierto | [UptimeRobot](https://uptimerobot.com) | Gratis |

### 0. Generar los secretos (en tu PC)

Genera un `JWT_SECRET_KEY` **exclusivo para producción**:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

Elige también una `ADMIN_PASSWORD` fuerte (12+ caracteres, con números y símbolos).

> El backend **se niega a arrancar** en producción si `JWT_SECRET_KEY` o
> `ADMIN_PASSWORD` son débiles o vacíos (ver `app/__init__.py`).

### 1. Base de datos — Neon

Crea un proyecto en <https://neon.tech>, copia la **connection string** y úsala
como `DATABASE_URL`. No la subas a git. (Se usa Neon en vez de SQLite porque el
disco de Render gratis se borra en cada reinicio; en Neon los datos persisten.)

### 2. Backend — Render

**New → Web Service**, conecta el repo `DINAMYT-COMBAT` y configura:

| Campo             | Valor                                                 |
| ----------------- | ----------------------------------------------------- |
| Root Directory    | `backend`                                             |
| Build Command     | `pip install -r requirements.txt`                     |
| **Start Command** | `gunicorn -k eventlet -w 1 -b 0.0.0.0:$PORT wsgi:app` |
| Instance Type     | Free                                                  |

Variables de entorno:

| Variable         | Valor                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `PYTHON_VERSION` | `3.11.9` ⚠️ NO usar 3.12+: el monkey-patching de eventlet se rompe y toda consulta da 500    |
| `FLASK_ENV`      | `production`                                                                                 |
| `DATABASE_URL`   | connection string de Neon                                                                    |
| `JWT_SECRET_KEY` | el secreto generado en el paso 0                                                             |
| `ADMIN_EMAIL`    | `admin@dinamyt.com`                                                                          |
| `ADMIN_PASSWORD` | tu contraseña fuerte                                                                         |
| `ADMIN_NOMBRE`   | `Administrador DINAMYT`                                                                      |
| `FRONTEND_URL`   | tu URL de Vercel (temporalmente `http://localhost:3000`)                                     |

Verifica que responde abriendo
`https://<tu-backend>.onrender.com/api/campeonatos/publico`.

### 3. Frontend — Vercel

**Add New → Project**, importa el repo con **Root Directory** `frontend` y agrega:

| Variable                 | Valor                                  |
| ------------------------ | -------------------------------------- |
| `NEXT_PUBLIC_API_URL`    | `https://<tu-backend>.onrender.com`    |
| `NEXT_PUBLIC_SOCKET_URL` | `https://<tu-backend>.onrender.com`    |

### 4. Conectar las dos partes (CORS)

En Render, cambia `FRONTEND_URL` por tu URL de Vercel (exacta, con `https://` y
sin `/` final). Acepta varios orígenes separados por coma.

### 5. Mantener el backend despierto

El plan gratis de Render apaga el servicio tras 15 min sin tráfico. Crea un
monitor HTTP en <https://uptimerobot.com> apuntando a
`https://<tu-backend>.onrender.com/api/campeonatos/publico` cada 5 minutos.

### Actualizar lo ya desplegado

```powershell
git add .
git commit -m "descripcion del cambio"
git push
```

Render y Vercel detectan el push y se redespliegan solos (~3–5 min).

---

## Solución de problemas

| Síntoma                                         | Causa probable                           | Solución                                                              |
| ----------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| "Error de conexión con el servidor" en el login | Backend dormido o caído                  | Espera 1 min (despierta) o revisa logs en Render                      |
| Errores CORS en la consola del navegador        | `FRONTEND_URL` mal puesta                | Debe ser EXACTAMENTE tu URL de Vercel, con `https://` y sin `/` final |
| El deploy del backend falla con "[SEGURIDAD]"   | Secretos débiles                         | Pon `JWT_SECRET_KEY` y `ADMIN_PASSWORD` fuertes en Render             |
| Pantalla pública no actualiza en vivo           | `NEXT_PUBLIC_SOCKET_URL` mal puesta      | Debe apuntar a la URL de Render, luego redeploy en Vercel             |
| Cambié variables en Vercel y no aplica          | Las `NEXT_PUBLIC_*` se inyectan en build | Redeploy en Vercel después de cambiarlas                              |
