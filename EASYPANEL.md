# Despliegue en EasyPanel

## 1. Crear la aplicación

1. Crear una **Aplicación** llamada `rp-historical-purge`.
2. Elegir este repositorio como fuente y construcción mediante `Dockerfile`.
3. Mantener una sola réplica.
4. No configurar dominio, puerto ni proxy público.
5. Política de reinicio: `unless-stopped` o equivalente.

No agregar este servicio al Docker Compose de Supabase.

## 2. Variables privadas

Configurar en EasyPanel las variables de `.env.example`. La clave
`SUPABASE_SERVICE_ROLE_KEY` debe marcarse como secreta y nunca copiarse a Git.

Si el contenedor comparte la red Docker del proyecto Supabase, se puede usar la
URL interna de Kong. Si no comparte red, usar la URL LAN existente. No usar la
URL de Studio terminada en `/project/default`.

## 3. Primera puesta en marcha

Usar inicialmente:

```env
PURGE_MODE=dry-run
RUN_ON_START=true
RETENTION_DAYS=60
DISK_MONITOR_ENABLED=true
DISK_PATH=/
DISK_TRIGGER_PERCENT=90
DISK_REARM_PERCENT=85
DISK_CHECK_INTERVAL_MINUTES=5
DISK_TRIGGER_COOLDOWN_HOURS=6
DISK_PRESSURE_RETENTION_DAYS=30
```

Desplegar una vez y revisar el log `Purga histórica finalizada`. Los campos
`storageDeleted` y `craDeleted` representan lo que se borraría en `dry-run`.

Luego cambiar `RUN_ON_START=false`. Si los conteos y rutas protegidas son
coherentes, cambiar `PURGE_MODE=execute` y desplegar nuevamente. La ejecución
real ocurrirá en el siguiente horario programado.

En el mismo primer arranque, revisar el log `Monitor de disco iniciado`.
`totalGiB` debe ser cercano al tamaño del disco que muestra EasyPanel. Para el
servidor actual se esperan aproximadamente 376 GiB. Si no coincide, dejar
`DISK_MONITOR_ENABLED=false`: el contenedor está observando otro filesystem.

## 4. Operación

- Horario recomendado: domingo 03:30 `America/Santiago`.
- Revisar semanalmente que exista un log de finalización.
- Un error de protección o Storage termina la ejecución con un log de nivel `error`.
- Si `storagePhaseComplete=false`, no se tocaron filas CRA en esa ejecución.
- Al alcanzar 90%, el monitor usa la retención de emergencia de 30 días.
- Si el disco continúa alto, espera 6 horas antes de repetir; al bajar a 85% se rearma.
- No automatizar `VACUUM FULL`; realizarlo sólo como mantenimiento supervisado.

## 5. Detención inmediata

Para suspender la limpieza, establecer `PURGE_MODE=dry-run` o detener la
Aplicación. Esto no afecta Supabase ni la recepción de alertas.
