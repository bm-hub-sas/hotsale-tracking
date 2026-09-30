# Instalación en VTEX

En VTEX el píxel se instala con **Google Tag Manager**. Necesita GTM activo en la tienda y en el checkout, incluida la página `orderPlaced`. En VTEX IO se configura con la app de Google Tag Manager; en tiendas CMS/Legacy, en la configuración de la tienda.

## Pasos

1. Si tiene las etiquetas de la versión de marzo de 2026 ("Hotsale UTM Capture" y "Hotsale Conversion Pixel"), elimínelas.
2. Cree el **Pixel 1** como indica la [guía de GTM](instalacion-gtm.md#pixel-1--captura), con el activador *All Pages*.
3. Cree el **Pixel 2** como indica la [guía de GTM](instalacion-gtm.md#pixel-2--conversión), con este activador:
   - *Evento personalizado*, nombre del evento: `orderPlaced`.

   En la página de pedido confirmado (`/checkout/orderPlaced`), VTEX envía al `dataLayer` el evento `orderPlaced` con `transactionId`, `transactionTotal` y `transactionCurrency`, y el píxel lee esos tres campos. En VTEX IO, la misma entrada trae además `ecommerce.purchase`: el píxel toma el pedido de ahí y la moneda de `transactionCurrency`. Si su tienda también envía el evento GA4 `purchase`, el píxel toma el más reciente de los dos.
4. Publique el contenedor.

## Verificar

Siga [docs/pruebas.md](pruebas.md) y compruebe que `order_id` coincide con el número de pedido que ve en el administrador de VTEX. Si el envío llega con `order_status: "incomplete"`, revise en la consola del navegador (en la página `orderPlaced`) qué contiene `dataLayer` y escríbanos.

## Límites conocidos

- El toque se guarda en el dominio donde el visitante llega. Si su checkout está en otro dominio (por ejemplo, `secure.tienda.com` o `tienda.vtexcommercestable.com.br`), el navegador no comparte el almacenamiento y la compra no se reporta. Avísenos si es su caso.
