# DINAMYT v4 — Guia de Despliegue en Produccion

Plataformas recomendadas:
- **Frontend** → [Vercel](https://vercel.com) (Next.js nativo, gratis)
- **Backend** → [Railway](https://railway.app) (Flask + Socket.IO, $5/mes)
- **Base de Datos** → [Supabase](https://supabase.com) PostgreSQL (gratis hasta 500MB) o Railway PostgreSQL

---

## PARTE 1: Preparar el Backend para Produccion

### 1.1 Cambiar SQLite → PostgreSQL

Primero necesitas desinstalar `psycopg2-binary` solo cuando uses Python ≤ 3.13.
Con Python 3.14+, usa `psycopg2` via un wheels precompilado:

```bash
# En el servidor de produccion (Railway usa Python 3.11 por defecto)
pip install psycopg2-binary
```

En `backend/requirements.txt`, agrega:
```
psycopg2-binary==2.9.10
```

### 1.2 Crear `backend/.env.production`

```env
FLASK_ENV=production
SECRET_KEY=TU_SECRETO_SUPER_LARGO_Y_RANDOM_AQUI
JWT_SECRET_KEY=TU_JWT_SECRET_DIFERENTE_AQUI
DATABASE_URL=postgresql://usuario:password@host:5432/dinamyt_db
CORS_ORIGINS=https://tu-app.vercel.app
```

### 1.3 Actualizar `backend/app/config.py`

```python
import os

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret")
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "jwt-dev-secret")
    # Usa DATABASE_URL si existe (produccion), si no SQLite (local)
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL",
        "sqlite:///dinamyt.db"
    ).replace("postgres://", "postgresql://")  # Railway usa postgres://
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
```

### 1.4 Crear `backend/Procfile` (para Railway/Render)

```
web: gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:$PORT run:app
```

### 1.5 Instalar gunicorn + eventlet

```bash
pip install gunicorn eventlet
```

Agrega a `requirements.txt`:
```
gunicorn==23.0.0
eventlet==0.39.0
```

### 1.6 Crear `backend/runtime.txt` (especificar Python)

```
python-3.11.9
```

---

## PARTE 2: Desplegar el Backend en Railway

### Paso 1: Crear cuenta en Railway

Ve a [railway.app](https://railway.app) → Signup con GitHub.

### Paso 2: Crear proyecto Railway con PostgreSQL

1. Click **"New Project"**
2. Click **"Add a Service"** → **"PostgreSQL"**
3. Railway crea la base de datos automaticamente.
4. En la pestana **"Variables"** del servicio PostgreSQL, copia el valor de `DATABASE_URL`.

### Paso 3: Crear servicio Flask

1. En el mismo proyecto → **"Add a Service"** → **"GitHub Repo"**
2. Selecciona tu repositorio de GitHub.
3. Railway detecta el `Procfile` automaticamente.
4. En **"Settings"** → **"Root Directory"** → escribe `backend`

### Paso 4: Variables de entorno del Backend

En Railway → tu servicio Flask → **"Variables"** → agregar:

| Variable | Valor |
|---|---|
| `SECRET_KEY` | genera uno con `python -c "import secrets; print(secrets.token_hex(32))"` |
| `JWT_SECRET_KEY` | igual, otro secreto diferente |
| `DATABASE_URL` | el valor copiado del servicio PostgreSQL |
| `CORS_ORIGINS` | `https://tu-app.vercel.app` (lo pones despues del paso 3) |
| `FLASK_ENV` | `production` |

### Paso 5: Ejecutar migraciones en produccion

En Railway → tu servicio → **"Terminal"** (o Railway CLI):

```bash
python -c "
from app import create_app
app = create_app()
with app.app_context():
    from app.extensions import db
    db.create_all()
    from app.seeds.seed_all import seed_all
    seed_all()
    print('DB lista!')
"
```

### Paso 6: Obtener la URL del backend

Railway te da una URL como: `https://dinamyt-backend-production.up.railway.app`

Anota esta URL, la necesitas en el paso del Frontend.

---

## PARTE 3: Desplegar el Frontend en Vercel

### Paso 1: Crear cuenta en Vercel

Ve a [vercel.com](https://vercel.com) → Signup con GitHub.

### Paso 2: Importar el proyecto

1. **"Add New Project"** → **"Import Git Repository"**
2. Selecciona tu repositorio.
3. En **"Configure Project"**:
   - **Framework Preset**: Next.js (auto-detectado)
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `.next` (default)

### Paso 3: Variables de entorno de Vercel

En Vercel → Settings → Environment Variables:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://dinamyt-backend-production.up.railway.app` |
| `NEXT_PUBLIC_SOCKET_URL` | `https://dinamyt-backend-production.up.railway.app` |

> **Importante**: Las variables con prefijo `NEXT_PUBLIC_` son publicas y se embeben en el bundle del cliente. No pongas secretos ahi.

### Paso 4: Desplegar

Click **"Deploy"**. Vercel compila el proyecto automaticamente.

Tu frontend quedara en: `https://tu-app.vercel.app`

### Paso 5: Actualizar CORS en Railway

Ahora que tienes la URL del frontend, ve a Railway → tu servicio Flask → Variables:

- `CORS_ORIGINS` = `https://tu-app.vercel.app`

Railway re-despliega automaticamente.

---

## PARTE 4: Configurar WebSocket en Produccion

Socket.IO con Railway requiere una configuracion especifica.

### 4.1 Actualizar `backend/app/__init__.py`

Asegurate que CORS y Socket.IO esten configurados correctamente para produccion:

```python
from flask_cors import CORS
from flask_socketio import SocketIO

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    CORS(app,
         origins=app.config["CORS_ORIGINS"],
         supports_credentials=True)

    socketio = SocketIO(
        app,
        cors_allowed_origins=app.config["CORS_ORIGINS"],
        async_mode="eventlet",         # CRITICO para produccion
        ping_timeout=60,
        ping_interval=25,
        logger=False,
        engineio_logger=False,
    )
    ...
```

### 4.2 Actualizar `frontend/src/lib/socket.ts`

```typescript
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5000";

// Para produccion, usa polling primero, luego websocket
const socket = io(SOCKET_URL, {
  namespace: "/combate",
  transports: ["polling", "websocket"],  // polling primero en Railway
  ...
});
```

---

## PARTE 5: Dominio Personalizado (Opcional)

### Frontend (Vercel)

1. Vercel → Settings → Domains → Add Domain
2. Agrega `dinamyt.tudominio.com`
3. Crea un registro CNAME en tu DNS apuntando a `cname.vercel-dns.com`

### Backend (Railway)

1. Railway → Settings → Networking → Custom Domain
2. Agrega `api.dinamyt.tudominio.com`
3. Crea un registro CNAME en tu DNS apuntando al valor que Railway indica

---

## PARTE 6: Variables de Entorno — Resumen Final

### Railway (Backend)
```env
SECRET_KEY=genera_secreto_largo_32_chars
JWT_SECRET_KEY=otro_secreto_diferente_32_chars
DATABASE_URL=postgresql://...  # auto-generado por Railway
CORS_ORIGINS=https://tu-app.vercel.app
FLASK_ENV=production
PORT=5000  # Railway lo pone automatico
```

### Vercel (Frontend)
```env
NEXT_PUBLIC_API_URL=https://dinamyt-backend-production.up.railway.app
NEXT_PUBLIC_SOCKET_URL=https://dinamyt-backend-production.up.railway.app
```

---

## PARTE 7: Checklist de Verificacion

Despues de desplegar, verifica:

- [ ] `https://tu-backend.railway.app/api/auth/login` responde (POST con email/password)
- [ ] `https://tu-app.vercel.app/login` carga correctamente
- [ ] Login con admin@dinamyt.com funciona
- [ ] Pantalla publica se conecta al socket
- [ ] Arbitro puede cambiar marcador en tiempo real
- [ ] Exportar PDF y Excel desde Reportes
- [ ] Categoria Figuras funciona en el tatami

---

## PARTE 8: Costos Estimados

| Servicio | Plan | Costo/mes |
|---|---|---|
| Vercel (Frontend) | Hobby | **Gratis** |
| Railway (Backend Flask) | Starter | ~$5 USD |
| Railway (PostgreSQL) | Starter | ~$5 USD |
| **Total** | | **~$10 USD/mes** |

> Para eventos puntuales (campeonatos), puedes pausar los servicios de Railway entre torneos y solo pagar cuando estes activo.

---

## PARTE 9: Alternativa Gratuita — Render + Supabase

Si quieres **$0/mes**:

- **Backend**: [Render.com](https://render.com) — Free tier (se duerme despues de 15 min inactividad)
- **Base de Datos**: [Supabase](https://supabase.com) — 500MB gratis
- **Frontend**: Vercel — Gratis siempre

> Nota: Render free tier puede tardar 30-60 segundos en "despertar". No recomendado para competencias en tiempo real. Railway es mas confiable para uso en vivo.
