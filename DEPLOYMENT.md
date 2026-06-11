# DINAMYT — Guía de despliegue GRATIS en internet

Con esta guía el software queda funcionando de verdad en la web, usando solo
planes gratuitos:

| Pieza                         | Herramienta                            | Costo  |
| ----------------------------- | -------------------------------------- | ------ |
| Frontend (Next.js)            | [Vercel](https://vercel.com)           | Gratis |
| Backend (Flask + Socket.IO)   | [Render](https://render.com)           | Gratis |
| Base de datos (PostgreSQL)    | [Neon](https://neon.tech)              | Gratis |
| Mantener el backend despierto | [UptimeRobot](https://uptimerobot.com) | Gratis |

Tiempo estimado: **30–45 minutos**. Solo necesitas tu cuenta de GitHub
(el repositorio `DINAMYT-COMBAT` ya debe estar subido, cosa que ya está hecha).

---

## PASO 0 — Generar los secretos (en tu PC)

Abre una terminal y genera un secreto JWT nuevo **exclusivo para producción**
(no reutilices el del `.env` local):

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

Guarda ese valor. Decide también la contraseña del administrador de
producción (fuerte: 12+ caracteres, letras, números y símbolo).

---

## PASO 1 — Base de datos gratis en Neon

1. Entra a <https://neon.tech> → **Sign up** con tu cuenta de GitHub.
2. Crea un proyecto: nombre `dinamyt`, región `AWS us-east-2 (Ohio)` (o la más cercana).
3. Al crearlo, Neon te muestra la **Connection string**. Cópiala. Se ve así:

   ```
   postgresql://usuario:contraseña@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

4. Guárdala — es tu `DATABASE_URL`. **No la compartas ni la subas a git.**

> ¿Por qué no SQLite? El disco de Render gratis se borra en cada reinicio.
> Con Neon, los combates guardados y usuarios **persisten para siempre**.

---

## PASO 2 — Backend gratis en Render

1. Entra a <https://render.com> → **Sign up** con GitHub.
2. **New → Web Service** → conecta el repositorio `DINAMYT-COMBAT`.
3. Configura:

   | Campo              | Valor                                                 |
   | ------------------ | ----------------------------------------------------- |
   | Name               | `dinamyt-backend`                                     |
   | Region             | Ohio (igual que Neon)                                 |
   | Branch             | `main`                                                |
   | **Root Directory** | `backend`                                             |
   | Runtime            | Python 3                                              |
   | Build Command      | `pip install -r requirements.txt`                     |
   | **Start Command**  | `gunicorn -k eventlet -w 1 -b 0.0.0.0:$PORT wsgi:app` |
   | Instance Type      | **Free**                                              |

   ⚠️ El `-w 1` (un solo worker) es **obligatorio**: el estado de los
   tatamis vive en memoria del proceso.

4. En **Environment Variables** agrega:

   | Variable         | Valor                                                         |
   | ---------------- | ------------------------------------------------------------- |
   | `PYTHON_VERSION` | `3.12.7`                                                      |
   | `FLASK_ENV`      | `production`                                                  |
   | `DATABASE_URL`   | la connection string de Neon (Paso 1)                         |
   | `JWT_SECRET_KEY` | el secreto generado en el Paso 0                              |
   | `ADMIN_EMAIL`    | `admin@dinamyt.com` (o el que prefieras)                      |
   | `ADMIN_PASSWORD` | tu contraseña fuerte del Paso 0                               |
   | `ADMIN_NOMBRE`   | `Administrador DINAMYT`                                       |
   | `FRONTEND_URL`   | `http://localhost:3000` _(temporal — se cambia en el Paso 4)_ |

5. **Create Web Service** y espera el primer deploy (~5 min).
6. Copia la URL que te asigna, por ejemplo:
   `https://dinamyt-backend.onrender.com`
7. Verifica que responde: abre
   `https://dinamyt-backend.onrender.com/api/campeonatos/publico`
   — debe devolver `[]` o la lista de campeonatos (JSON).

> Nota: el backend **se niega a arrancar** en producción si dejas
> `JWT_SECRET_KEY` o `ADMIN_PASSWORD` débiles o vacíos (protección incluida
> en el código). Si el deploy falla, revisa los logs: te dirá qué falta.

---

## PASO 3 — Frontend gratis en Vercel

1. Entra a <https://vercel.com> → **Sign up** con GitHub.
2. **Add New → Project** → importa `DINAMYT-COMBAT`.
3. Configura:

   | Campo              | Valor                     |
   | ------------------ | ------------------------- |
   | **Root Directory** | `frontend`                |
   | Framework Preset   | Next.js (lo detecta solo) |

4. En **Environment Variables** agrega (usando TU URL de Render del Paso 2):

   | Variable                 | Valor                                  |
   | ------------------------ | -------------------------------------- |
   | `NEXT_PUBLIC_API_URL`    | `https://dinamyt-backend.onrender.com` |
   | `NEXT_PUBLIC_SOCKET_URL` | `https://dinamyt-backend.onrender.com` |

5. **Deploy** y espera (~2 min).
6. Copia la URL final, por ejemplo: `https://dinamyt-combat.vercel.app`

---

## PASO 4 — Conectar las dos partes (CORS)

1. Vuelve a Render → tu servicio → **Environment**.
2. Cambia `FRONTEND_URL` por tu URL de Vercel:

   ```
   https://dinamyt-combat.vercel.app
   ```

   Si quieres seguir probando también desde tu PC, puedes poner varias
   separadas por coma:

   ```
   https://dinamyt-combat.vercel.app,http://localhost:3000
   ```

3. Guarda — Render reinicia el servicio automáticamente.

---

## PASO 5 — Probar que funciona de verdad

1. Abre tu URL de Vercel.
2. Inicia sesión con `ADMIN_EMAIL` / `ADMIN_PASSWORD` (los del Paso 2).
3. Crea un campeonato de prueba con 2 tatamis.
4. Abre la **Pantalla Pública** desde otro dispositivo (tu celular):
   elige campeonato → tatami.
5. Entra como Juez Central al tatami, actívalo, pon nombres y marca puntos:
   deben verse **en vivo** en el celular.
6. Guarda el combate y revisa **Reportes** → exporta Excel/PDF.

Si todo eso funciona, el software está en producción. ✅

---

## PASO 6 — Mantener el backend despierto (importante)

El plan gratis de Render **apaga** el servicio tras 15 minutos sin tráfico;
la siguiente visita tarda ~1 minuto en despertar. Para que esto no pase
durante un campeonato:

1. Entra a <https://uptimerobot.com> → cuenta gratis.
2. **Add New Monitor**:
   - Type: `HTTP(s)`
   - URL: `https://dinamyt-backend.onrender.com/api/campeonatos/publico`
   - Interval: `5 minutes`
3. Listo: UptimeRobot visita el backend cada 5 minutos y nunca se duerme.

---

## Cómo actualizar el software ya desplegado

```powershell
git add .
git commit -m "descripcion del cambio"
git push
```

Render y Vercel detectan el push y **se redespliegan solos** (~3-5 min).

---

## Limitaciones del plan gratis (y cuándo preocuparse)

| Limitación                            | Impacto real                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Render duerme tras 15 min idle        | Resuelto con UptimeRobot (Paso 6)                                                                                                             |
| Disco de Render se borra al reiniciar | El respaldo en vivo de tatamis (`tatami_states.json`) se pierde en un redeploy, pero los combates **guardados** están en Neon y no se pierden |
| Neon gratis: 0.5 GB                   | Miles de campeonatos; sobra                                                                                                                   |
| Render gratis: 750 h/mes              | Suficiente para un servicio siempre activo                                                                                                    |
| Sin escalado multi-proceso            | Por diseño: 6 tatamis ≈ 80 conexiones, el proceso único lo maneja sobrado                                                                     |

## Solución de problemas

| Síntoma                                         | Causa probable                           | Solución                                                              |
| ----------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| "Error de conexión con el servidor" en el login | Backend dormido o caído                  | Espera 1 min (despierta) o revisa logs en Render                      |
| Errores CORS en la consola del navegador        | `FRONTEND_URL` mal puesta                | Debe ser EXACTAMENTE tu URL de Vercel, con `https://` y sin `/` final |
| El deploy del backend falla con "[SEGURIDAD]"   | Secretos débiles                         | Pon `JWT_SECRET_KEY` y `ADMIN_PASSWORD` fuertes en Render             |
| Pantalla pública no actualiza en vivo           | `NEXT_PUBLIC_SOCKET_URL` mal puesta      | Debe apuntar a la URL de Render, luego redeploy en Vercel             |
| Cambié variables en Vercel y no aplica          | Las `NEXT_PUBLIC_*` se inyectan en build | Redeploy en Vercel después de cambiarlas                              |
