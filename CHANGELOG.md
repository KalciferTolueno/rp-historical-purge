# Changelog

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
