# RP Historical Purge

Aplicación privada y sin interfaz web para automatizar la retención histórica de
Recinto Protegido en Supabase self-hosted. Está diseñada para ejecutarse como una
sola **Aplicación** en EasyPanel.

## Garantías de seguridad

- El modo predeterminado es `dry-run`: al desplegar por primera vez no elimina nada.
- Nunca elimina filas de `procedures`.
- Conserva todas las imágenes referenciadas por `procedures.image_url`.
- Conserva también los eventos CRA vinculados por `procedures.event_id` y sus imágenes.
- Sólo considera objetos antiguos bajo `images/events/`; no toca `tickets/` ni `referential/`.
- Elimina archivos únicamente mediante la API oficial de Supabase Storage.
- Si no puede leer Procedimientos o Storage, aborta y no continúa con CRA.
- Storage se completa antes de comenzar a borrar filas históricas de `cra_events`.
- Trabaja por lotes, con pausa y límites por ejecución para reducir presión sobre PostgREST.
- No ejecuta `VACUUM FULL`, no instala triggers y no modifica la recepción Realtime.

## Variables

Copiar los nombres desde `.env.example`. Las dos variables obligatorias son:

- `SUPABASE_URL`: API de Kong, por ejemplo `http://192.168.1.205:8000`.
- `SUPABASE_SERVICE_ROLE_KEY`: secreto configurado únicamente en EasyPanel.

La configuración recomendada inicial es:

```env
PURGE_MODE=dry-run
RETENTION_DAYS=60
PURGE_SCHEDULE=30 3 * * 0
TZ=America/Santiago
RUN_ON_START=true
MAX_STORAGE_DELETES_PER_RUN=5000
MAX_CRA_DELETES_PER_RUN=50000
BATCH_DELAY_MS=150
```

Después de revisar el primer log, cambiar `RUN_ON_START=false` y, cuando la
vista previa sea correcta, `PURGE_MODE=execute`.

## Ejecución local de vista previa

```bash
npm ci
npm run build
PURGE_MODE=dry-run npm run start:once
```

En PowerShell:

```powershell
$env:PURGE_MODE = 'dry-run'
npm run start:once
```

## Comportamiento de los límites

Si se alcanza `MAX_STORAGE_DELETES_PER_RUN`, la tarea se detiene antes de borrar
filas CRA. La siguiente ejecución continúa limpiando Storage. Sólo cuando la fase
Storage termina se habilita la purga de `cra_events`.

Los eventos vinculados a Procedimientos se conservan permanentemente. Esto evita
que una fila antigua de Procedimientos que depende de su `event_id` pierda la
imagen en una ejecución futura.

## Despliegue

Ver [EASYPANEL.md](EASYPANEL.md). La aplicación no escucha puertos y no necesita
dominio público.
