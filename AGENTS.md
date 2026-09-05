# Guía para agentes — rp-historical-purge

Herramienta **aparte** de Recinto Protegido V5: servicio Node sin UI que corre
en EasyPanel y retiene `cra_events` + imágenes del bucket `images`.

La app React vive en otro repo (`1.9.8`). No mezclar PRs.

## Qué es y qué no es

- **Sí:** cron semanal, emergencia por % de disco, `dry-run` / `execute`.
- **No:** frontend REI, rotación de logs Docker de Kong, `VACUUM`, compose de Supabase.

Contexto de producción y orden CRA→Storage:
en el repo de la app, `docs/runbooks/purga-historica-automatica.md`.

## Lectura

1. `README.md` — garantías y variables.
2. `EASYPANEL.md` — despliegue.
3. `CHANGELOG.md` — v1.3.0 orden seguro; v1.4.0 `DISK_CHECK_SCHEDULE`.

## Invariantes

- Filas CRA antiguas primero; Storage solo si esa fase terminó.
- Nunca borrar `procedures` ni prefijos `tickets/` / `referential/`.
- Eliminar Storage solo con la API oficial, nunca SQL a `storage.objects`.
- `RUN_ON_START=false` en producción.
- Con `DISK_CHECK_SCHEDULE` no consultar el disco cada 5 minutos.

## Versión

`package.json` debe coincidir con el tag git (`v1.4.0` en adelante) y con
`X-Client-Info` en `src/purge-service.ts`.
