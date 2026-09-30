# Prueba de canales: Facebook/Instagram pago, Google pago y Google orgánico

`dist-prueba/` es el mismo píxel de Hot Sale con otras listas. Sirve para probar el algoritmo con tráfico real de otras tiendas antes del evento. Usa las mismas tres reglas de producción, cambiando las palabras de Hot Sale por palabras de canal. Así el tráfico de Facebook, Instagram y Google de esas tiendas activa el píxel igual que las campañas de Hot Sale lo harán en producción.

El código es idéntico al de `dist/`: solo cambian la versión (`2.0.1-prueba`) y las listas. Una prueba automática lo verifica.

**No lo instale en aliados de Hot Sale.**

## Qué captura

| Canal | Cómo lo reconoce el píxel | Lo que necesita la campaña |
|---|---|---|
| Facebook / Instagram pago | `utm_source` es `fb`, `ig`, `facebook`, `instagram` o `meta` | En cada anuncio, en *Parámetros de URL*: `utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}` |
| Google pago | `utm_source` es `google` | En Google Ads, *Configuración de la cuenta → Sufijo de URL final*: `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={keyword}` |
| Google orgánico | La visita llega desde `google.com`, `google.com.co` o la app de Google en Android, sin UTM | Nada |
| Palabras clave de canal | Algún UTM **contiene** `facebook`, `fb`, `instagram`, `meta`, `google`, `adwords`, `cpc`, `ppc`, `paid` o `pmax`. Es la misma regla que en producción busca `hotsale`, `ccce` y las demás | Nada. Aparece como `signal = keyword_only` |

Tres cosas quedan fuera:

- Facebook orgánico sin UTM.
- Cualquier otra fuente.
- Los clics de Google Ads **sin** el sufijo: llegan desde Google sin UTM y se ven como orgánicos.

El modelo es el mismo de Hot Sale:

- Cuenta la última visita de uno de estos canales, dentro de 30 días y en el mismo navegador.
- Una visita directa o de otra fuente no la borra.
- Cada visita se asocia a un solo pedido.

## Antes de instalar

1. **La misma hoja de Hot Sale.** La prueba usa la misma aplicación web y la misma hoja. El collector guarda sus filas con `is_test = true`.
2. **Registrar las tiendas.** En la pestaña `aliados`, escriba el nombre y el dominio de cada tienda de prueba.
3. **Filtrar los reportes.** Los reportes de Hot Sale ya excluyen `is_test = true`, así que las ventas de estas tiendas no aparecen en sus cifras. El reporte de la prueba filtra por `aliado`, con las tiendas de prueba.
4. **Instalar.** Use los archivos de `dist-prueba/` con las mismas guías de instalación de `docs/`.
5. **Probar.** Visite la tienda con `?utm_source=fb&utm_medium=paid&hs_test=1` y haga una compra de prueba.

## Cómo se ve cada canal en la hoja

En Looker Studio, filtre por `aliado` (las tiendas de prueba) y cree un campo calculado **Canal** sobre la pestaña `pedidos` (o `toques`):

```
CASE
  WHEN REGEXP_CONTAINS(LOWER(CONCAT(utm_source, " ", utm_campaign)), "facebook|instagram|meta|fb|ig") AND REGEXP_CONTAINS(LOWER(utm_medium), "paid|cpc|ppc|ads") THEN "Facebook/Instagram pago"
  WHEN REGEXP_CONTAINS(LOWER(CONCAT(utm_source, " ", utm_campaign)), "google|adwords|pmax") AND REGEXP_CONTAINS(LOWER(utm_medium), "cpc|ppc|paid") THEN "Google pago"
  WHEN signal = "referrer_only" THEN "Google orgánico"
  ELSE "Otro"
END
```

En este perfil, `referrer_only` significa siempre "llegó desde Google sin UTM", porque la lista de referrers solo tiene dominios de Google. "Otro" agrupa, por ejemplo, Facebook orgánico con UTM (`utm_medium=social`) o el pago de otras plataformas que coincidió por `cpc` o `paid`.

## Qué esperar de los números

Las cifras no van a coincidir con Meta Ads Manager ni con GA4. Esas herramientas cuentan también:

- anuncios vistos sin clic;
- compras en otro dispositivo;
- otras ventanas de atribución.

El píxel cuenta solo el último clic de estos canales, en el mismo navegador. Compare las tendencias y el orden entre canales, no el total exacto.
