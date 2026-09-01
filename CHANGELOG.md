# Changelog

## 1.3.0 — 2026-09-01

- Orden seguro ante interrupciones: filas CRA primero y archivos Storage después.
- Storage queda completamente bloqueado mientras exista algún evento CRA antiguo
  eliminable o no se hayan podido comprobar las referencias conservadas.
- Todas las rutas aún utilizadas por CRA se normalizan y protegen antes de borrar.
- Los eventos nuevos recibidos durante la comprobación se incorporan antes de
  cada lote de Storage, sin detener ni modificar la recepción Realtime.
- Procedimientos y eventos vinculados se revalidan durante ambas fases.
- Los límites ya no pueden dejar una fila visible sin imagen: si se alcanza el
  límite CRA sólo quedan archivos sobrantes para una ejecución posterior.
- Logs explican si Storage fue omitido y cuántas imágenes siguen en uso.
- `VACUUM FULL` continúa expresamente fuera de la automatización.

## 1.2.0 — 2026-09-01

- Formato `pretty` predeterminado con bloques ordenados y etiquetas en español.
- Fechas mostradas en la zona horaria configurada y con año completo.
- Motivo y modo de cada ejecución claramente diferenciados.
- Resumen final separado en Protección, Storage y Base de datos CRA.
- Progreso por lotes compacto y opción `LOG_FORMAT=json` para integraciones.

## 1.1.1 — 2026-09-01

- Reporte simultáneo en GB decimales y GiB binarios para comparar correctamente
  la capacidad observada por el contenedor con EasyPanel.

## 1.1.0 — 2026-09-01

- Monitor opcional del filesystem visible desde el contenedor.
- Disparo de purga protegida al alcanzar 90% de uso.
- Retención de emergencia configurable, por defecto 30 días.
- Enfriamiento de 6 horas y rearme al bajar a 85%.
- Registro inicial en GB y GiB de capacidad, uso y espacio disponible para
  validar que se está observando el disco correcto del servidor.

## 1.0.0 — 2026-09-01

- Purga semanal de Storage y `cra_events` por lotes.
- Protección permanente de Procedimientos, imágenes y eventos vinculados.
- Modo `dry-run` seguro y despliegue como Aplicación en EasyPanel.
