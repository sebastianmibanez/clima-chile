# gatito.cl — rediseño móvil

Build listo para commitear y desplegar como sitio estático.

## Qué hay
- `index.html` — la pantalla completa (hoy, 7 días, detalle por hora, comunas, aire y polen) con selector de tema arena / cacao / noche.
- `support.js` — runtime que necesita `index.html`.
- `gatos/` — solo los stickers que la pantalla usa (6 archivos): color-19.png, pose-01.svg, pose-09.svg, pose-10.svg, pose-12.svg, pose-19.svg.

## Cómo publicarlo
Copia esta carpeta al repo (por ejemplo `sitio/nuevo/`), commitea y despliega. Sin build ni dependencias; las fuentes vienen de Google Fonts.

## Datos
Los valores son los de `sitio/datos-ejemplo.json` (Puente Alto). Para producción, reemplázalos por la respuesta real del ensamble calibrado.

## Repertorio completo
Las 22 poses (`pose-01..22.svg` en vector y `color-01..22.png`) están en `gatos/` del proyecto de diseño.
