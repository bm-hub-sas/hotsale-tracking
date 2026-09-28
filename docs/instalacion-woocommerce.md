# Instalación en WooCommerce

Hay dos formas de instalarlo. Si ya usa Google Tag Manager, use la opción A.

Antes de empezar, si tiene la versión de marzo de 2026, elimínela: las etiquetas de GTM "Hotsale UTM Capture" y "Hotsale Conversion Pixel", o los bloques de código equivalentes.

## Opción A — con Google Tag Manager

1. Cree el **Pixel 1** y el **Pixel 2** como indica la [guía de GTM](instalacion-gtm.md).
2. Activador del Pixel 2:
   - Si un plugin (por ejemplo, GTM4WP con el seguimiento de comercio electrónico activado) envía el evento GA4 `purchase` al `dataLayer`, use *Evento personalizado* `purchase`.
   - Si no, agregue el bloque `window.hotsaleOrder` de la sección [Datos del pedido](#datos-del-pedido) y use *Ventana cargada* con la condición *Page Path contiene* `/order-received/`.

## Opción B — sin GTM, con `functions.php`

Agregue este código en el `functions.php` de su tema hijo o con un plugin de fragmentos de código (Code Snippets o similar). En los dos lugares marcados, pegue el contenido completo de cada archivo tal como lo recibió, con sus etiquetas `<script>`.

```php
<?php
// Hot Sale — Pixel 1: todas las páginas.
add_action( 'wp_footer', function () {
	?>
	<!-- PEGUE AQUÍ el contenido de pixel1-todas-las-paginas.html -->
	<?php
}, 10 );

// Hot Sale — Pixel 2: solo en la página de pedido recibido.
add_action( 'wp_footer', function () {
	if ( ! function_exists( 'is_order_received_page' ) || ! is_order_received_page() ) {
		return;
	}
	?>
	<!-- PEGUE AQUÍ el contenido de pixel2-gtm-confirmacion.html -->
	<?php
}, 20 );
```

Además, agregue el bloque de la sección siguiente.

## Datos del pedido

WooCommerce no expone el pedido en el `dataLayer` por defecto. Este código lo deja disponible como `window.hotsaleOrder` en la página de pedido recibido, y solo incluye el número, el valor y la moneda:

```php
<?php
// Hot Sale — expone número, valor y moneda del pedido para el Pixel 2.
add_action( 'woocommerce_thankyou', function ( $order_id ) {
	$order = wc_get_order( $order_id );
	if ( ! $order ) {
		return;
	}
	printf(
		'<script>window.hotsaleOrder = %s;</script>',
		wp_json_encode( array(
			'id'       => (string) $order->get_order_number(),
			'value'    => (float) $order->get_total(),
			'currency' => $order->get_currency(),
		) )
	);
}, 5 );
```

`get_total()` es el total del pedido, con envío e impuestos incluidos.

## Verificar

Siga [docs/pruebas.md](pruebas.md) y compruebe que `order_id` coincide con el número de pedido que ve en WooCommerce. Si usa el checkout por bloques y el envío llega con `order_status: "incomplete"`, revise en la consola del navegador si `window.hotsaleOrder` existe en la página de pedido recibido, y escríbanos.
