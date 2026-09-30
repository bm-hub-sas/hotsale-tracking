# Seguridad

## Cómo reportar una vulnerabilidad

Escriba a `[correo de seguridad — DEFINIR]`. También puede usar **Security → Report a vulnerability** en este repositorio de GitHub, si está habilitado. **No abra un issue público.**

Incluya:

- la versión del píxel (primera línea del snippet o campo `pixel_version`),
- la plataforma (Shopify, GTM, VTEX, WooCommerce u otra),
- los pasos para reproducir el problema y su impacto.

## Tiempos de respuesta `[CONFIRMAR con BM-Hub]`

- Acuse de recibo: 2 días hábiles.
- Evaluación inicial: 5 días hábiles.
- Durante el evento (19 al 25 de octubre de 2026): acuse de recibo en 24 horas.

Si la corrección cambia el código que los aliados tienen instalado, se publica una versión nueva en [CHANGELOG.md](CHANGELOG.md), con su SHA-256, y se avisa a los aliados. El código instalado en una tienda no cambia por sí solo.

## Alcance

- El código de este repositorio: `src/`, `scripts/`, `collector/` y `dist/` (lo que se instala en las tiendas).
- El collector ([`collector/apps-script.gs`](collector/apps-script.gs)) y la hoja de cálculo donde guarda los datos, operados por UpSell/BM-Hub.

## Versiones con soporte

| Versión | Soporte |
|---|---|
| 2.x | Sí |
| 1.0.0-marzo2026 | No. Desinstálela: carga GA4 y Meta en su sitio y envía datos a un endpoint sin autenticación |

## No se consideran vulnerabilidades

- Que la URL del collector sea visible en el código de la tienda. Es necesaria para enviar los datos y es la misma para todos los aliados.
- Que cualquiera pueda enviar al collector un evento con un dominio registrado. Toda medición desde el navegador tiene esa limitación. El collector la mitiga validando el formato y el dominio, limitando los envíos por minuto, deduplicando y marcando pedidos sospechosos. Las cifras se concilian con cada aliado antes de reportarlas (ver [docs/contrato-collector.md](docs/contrato-collector.md)).
