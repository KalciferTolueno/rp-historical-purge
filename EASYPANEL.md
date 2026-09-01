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
```

Desplegar una vez y revisar el log `Purga histórica finalizada`. Los campos
`storageDeleted` y `craDeleted` representan lo que se borraría en `dry-run`.

Luego cambiar `RUN_ON_START=false`. Si los conteos y rutas protegidas son
coherentes, cambiar `PURGE_MODE=execute` y desplegar nuevamente. La ejecución
real ocurrirá en el siguiente horario programado.

## 4. Operación

- Horario recomendado: domingo 03:30 `America/Santiago`.
- Revisar semanalmente que exista un log de finalización.
- Un error de protección o Storage termina la ejecución con un log de nivel `error`.
- Si `storagePhaseComplete=false`, no se tocaron filas CRA en esa ejecución.
- No automatizar `VACUUM FULL`; realizarlo sólo como mantenimiento supervisado.

## 5. Detención inmediata

Para suspender la limpieza, establecer `PURGE_MODE=dry-run` o detener la
Aplicación. Esto no afecta Supabase ni la recepción de alertas.
