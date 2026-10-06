# Instalación con Google Tag Manager

Sirve para cualquier plataforma que tenga GTM en todas sus páginas, incluida la página de confirmación de compra. Si no usa GTM, vaya a [Sin GTM](#sin-gtm).

> **Video tutorial:** el paso a paso de esta instalación está en [este enlace](https://hi.switchy.io/tutopixelhot) (video de Google Tag Manager).

Necesita estos dos archivos, que son los mismos para todas las tiendas:

- `pixel1-todas-las-paginas.html`
- `pixel2-gtm-confirmacion.html`

**Antes de empezar:** si tiene las etiquetas de la versión de marzo de 2026 ("Hotsale UTM Capture" y "Hotsale Conversion Pixel"), elimínelas.

## Pixel 1 — captura

1. **Etiquetas → Nueva → Configuración de la etiqueta → HTML personalizado.**
2. Nombre sugerido: `Hot Sale — Pixel 1 captura`.
3. Pegue el contenido completo de `pixel1-todas-las-paginas.html`.
4. Deje sin marcar *Admitir document.write*.
5. **Activación:** *All Pages* (Todas las páginas).
6. Guarde.

## Pixel 2 — conversión

1. **Etiquetas → Nueva → HTML personalizado.**
2. Nombre sugerido: `Hot Sale — Pixel 2 conversión`.
3. Pegue el contenido completo de `pixel2-gtm-confirmacion.html`.
4. **Activación.** El Pixel 2 debe correr en la página de confirmación **después** de que el pedido está en el `dataLayer`. Use el primer caso que aplique a su tienda:

   | Su tienda… | Activador |
   |---|---|
   | envía el evento GA4 `purchase` al `dataLayer` | *Evento personalizado*, nombre del evento: `purchase` |
   | envía `orderPlaced` (VTEX) o `transactionId` (Universal Analytics) | *Evento personalizado*, nombre del evento: `orderPlaced` (o el evento que use) |
   | no envía ningún evento de compra | *Ventana cargada* (Window Loaded), con la condición *Page Path contiene* `/gracias` (o la ruta de su página de confirmación) |

5. Guarde, revise en **Vista previa** y **publique** el contenedor.

Si el activador se dispara más de una vez en la misma página, no pasa nada: el píxel no envía dos veces el mismo pedido.

### Si el pedido llega incompleto

Si en la [prueba](pruebas.md) el envío llega con `order_status: "incomplete"`, su página de confirmación no expone el pedido en un formato reconocible. Agregue en esa página, **antes** del Pixel 2, este bloque con los datos del pedido (normalmente lo genera su plataforma o su equipo de desarrollo):

```html
<script>
  window.hotsaleOrder = {
    id: 'NUMERO_DE_PEDIDO',   // texto
    value: 250000,            // número, sin separadores de miles
    currency: 'COP'           // código ISO de la moneda
  };
</script>
```

`window.hotsaleOrder` tiene prioridad sobre el `dataLayer`. El píxel solo lee `id`, `value` y `currency`.

### Consentimiento

Si su política exige consentimiento de analítica, tenga en cuenta el momento en que se da. El Pixel 1 solo reconoce la llegada desde Hot Sale **en la página de llegada**, porque es donde están los UTM y el referrer. Si exige `analytics_storage` y el visitante acepta el banner después de que carga la página, el activador *All Pages* ya pasó y esa llegada se pierde.

Para no perderla, agregue al Pixel 1 un segundo activador con el evento que envía su plataforma de consentimiento al aceptar. El píxel no reenvía un toque que ya registró, así que un doble disparo no duplica nada. Los visitantes que rechazan la analítica no se miden.

## Sin GTM

1. **Pixel 1:** pegue `pixel1-todas-las-paginas.html` en la plantilla principal de su sitio, antes de `</body>`, para que aparezca en **todas** las páginas.
2. **Pixel 2:** pegue `pixel2-gtm-confirmacion.html` **solo** en la página de confirmación de compra, antes de `</body>` y después del código que define el pedido (`dataLayer` o `window.hotsaleOrder`).

Ambos archivos ya incluyen las etiquetas `<script>`. Si su plataforma no tiene `dataLayer` en la página de confirmación, defina `window.hotsaleOrder` como en [Si el pedido llega incompleto](#si-el-pedido-llega-incompleto).

## Content-Security-Policy

Si su sitio usa CSP, agregue `https://script.google.com` y `https://script.googleusercontent.com` a `connect-src`. Las etiquetas de HTML personalizado de GTM también necesitan que su CSP permita los scripts de GTM, normalmente con un *nonce*.

## Verificar

Siga [docs/pruebas.md](pruebas.md).
