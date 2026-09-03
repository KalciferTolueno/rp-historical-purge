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
LOG_FORMAT=pretty
DISK_MONITOR_ENABLED=true
DISK_PATH=/
DISK_TRIGGER_PERCENT=90
DISK_REARM_PERCENT=85
DISK_CHECK_SCHEDULE=30 4 * * *
DISK_TRIGGER_COOLDOWN_HOURS=6
DISK_PRESSURE_RETENTION_DAYS=30
```

Desplegar una vez y revisar el log `Purga histórica finalizada`. Los campos
`storageDeleted` y `craDeleted` representan lo que se borraría en `dry-run`.

En la versión segura, la sección **BASE DE DATOS CRA** aparece antes de
**STORAGE**. Si `Fase CRA completa: No`, debe aparecer `Fase Storage omitida:
Sí`; es el comportamiento esperado y evita dejar eventos visibles sin imagen.

Luego cambiar `RUN_ON_START=false`. Si los conteos y rutas protegidas son
coherentes, cambiar `PURGE_MODE=execute` y desplegar nuevamente. La ejecución
real ocurrirá en el siguiente horario programado.

En el mismo primer arranque, revisar el log `Monitor de disco iniciado`.
`totalGB` debe ser cercano a los 376,1 GB que muestra EasyPanel. `totalGiB`
puede ser menor porque usa unidades binarias. Si el tamaño no corresponde al
disco del servidor, dejar `DISK_MONITOR_ENABLED=false`: el contenedor está
observando otro filesystem.

## 4. Operación

- Horario recomendado de retención: domingo 03:30 `America/Santiago`.
- Revisión de disco recomendada: todos los días 04:30 (`DISK_CHECK_SCHEDULE`).
  Si el uso llega a 90%, la purga de emergencia corre a esa hora, no cada 5 minutos.
- Revisar semanalmente que exista un log de finalización.
- Un error de protección o Storage termina la ejecución con un log de nivel `error`.
- Mantener `LOG_FORMAT=pretty` para que la consola sea legible por cualquier operador.
- Si `craPhaseComplete=false`, Storage queda intacto y la próxima ejecución
  continúa con las filas CRA antiguas.
- Antes de borrar Storage, el proceso comprueba las rutas usadas por todos los
  eventos CRA que permanecerán en la aplicación.
- Al alcanzar 90% en la revisión diaria, el monitor usa la retención de emergencia de 30 días.
- Si el disco continúa alto, la siguiente revisión diaria puede repetir; al bajar a 85% se rearma.
- No automatizar `VACUUM FULL`; realizarlo sólo como mantenimiento supervisado.

## 5. Detención inmediata

Para suspender la limpieza, establecer `PURGE_MODE=dry-run` o detener la
Aplicación. Esto no afecta Supabase ni la recepción de alertas.
