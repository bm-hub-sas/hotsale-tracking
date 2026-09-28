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

- El código de este repositorio: `src/`, `scripts/` y `dist/` (lo que se instala en las tiendas).
- El collector `px.hotsale.com.co`, operado por UpSell/BM-Hub, que no está en este repositorio. Los reportes sobre el collector se reciben en el mismo contacto.

## Versiones con soporte

| Versión | Soporte |
|---|---|
| 2.x | Sí |
| 1.0.0-marzo2026 | No. Desinstálela: carga GA4 y Meta en su sitio y envía datos a un endpoint sin autenticación |

## No se consideran vulnerabilidades

- Que el `site_key` sea visible en el código de la tienda. Es público por diseño y no es una contraseña.
- Que cualquiera pueda enviar al collector un evento con un `site_key` válido. Toda medición desde el navegador tiene esa limitación. El collector la mitiga validando el `Origin` y el dominio, limitando peticiones y deduplicando (ver [docs/contrato-collector.md](docs/contrato-collector.md)).
