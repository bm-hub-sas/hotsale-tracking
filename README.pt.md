🌐 [Español](README.md) · [English](README.en.md) · **Português**

# Pixel do Hot Sale para lojas parceiras

Este repositório contém o pixel que mede as vendas que as lojas parceiras recebem a partir de [hotsale.com.co](https://hotsale.com.co), o evento da Câmara Colombiana de Comércio Eletrônico (CCCE). O pixel tem duas partes. A **captura** reconhece, na sua loja, uma visita que chega do Hot Sale e a guarda no navegador do visitante. A **conversão** informa o número, o valor e a moeda do pedido na página de confirmação de compra. Cada envio é uma única requisição a um único servidor. Você cola o código de [`Pixels/`](Pixels/), que pode ser verificado com SHA-256.

**Versão atual: 2.0.1** (Hot Sale, de 19 a 23 de outubro de 2026). A versão de março de 2026 ficou na tag [`v1.0.0-marzo2026`](https://github.com/bm-hub-sas/hotsale-tracking/tree/v1.0.0-marzo2026). As mudanças entre versões estão em [CHANGELOG.md](CHANGELOG.md).

> Os guias de instalação em [`docs/`](docs/) estão disponíveis, por enquanto, apenas em espanhol.

---


## 1. Instalação

O código é o mesmo para todas as lojas: são os arquivos de [`Pixels/`](Pixels/). Se você tem instalada a versão de março de 2026 (tags "Hotsale UTM Capture" e "Hotsale Conversion Pixel", ou código no `theme.liquid`), **remova-a antes** de instalar esta.

| Plataforma | O que se instala | Guia |
|---|---|---|
| Shopify | Um único pixel personalizado em *Eventos do cliente*. Nada no `theme.liquid` | [docs/instalacion-shopify.md](docs/instalacion-shopify.md) |
| Google Tag Manager (qualquer plataforma) | Pixel 1 em todas as páginas e Pixel 2 na página de confirmação | [docs/instalacion-gtm.md](docs/instalacion-gtm.md) |
| VTEX | Por meio do GTM | [docs/instalacion-vtex.md](docs/instalacion-vtex.md) |
| WooCommerce | Por meio do GTM ou do `functions.php` | [docs/instalacion-woocommerce.md](docs/instalacion-woocommerce.md) |
| Outra plataforma, sem GTM | Pixel 1 no template principal e Pixel 2 na página de confirmação | [docs/instalacion-gtm.md#sin-gtm](docs/instalacion-gtm.md#sin-gtm) |

**Vídeos tutoriais:** há um para o Google Tag Manager e outro para o Shopify [neste link](https://hi.switchy.io/tutopixelhot).

**Se o seu site usa Content-Security-Policy**, adicione `https://script.google.com` e `https://script.googleusercontent.com` ao `connect-src`. Se não fizer isso, o navegador bloqueia o envio.

## 2. Como verificar a instalação

Acesse a sua loja com `?utm_source=hotsale&hs_test=1`, faça uma compra de teste e confira, nas ferramentas de desenvolvedor do navegador, as duas requisições para `script.google.com`. Os envios de teste não contam nos relatórios. O passo a passo está em [docs/pruebas.md](docs/pruebas.md) (em espanhol).

### Quais dados são enviados

**Nenhum dado pessoal do comprador é enviado.** O pixel não lê nome, e-mail, telefone, endereço, documento nem o conteúdo do carrinho. Da página de confirmação, lê apenas o número, o valor e a moeda do pedido.

O pixel faz dois tipos de envio:

- `touch`: um visitante chegou do Hot Sale. Se o mesmo link (mesmos UTMs) se repetir em menos de 30 minutos, na mesma aba ou em outra, não é reenviado: recarregar a página ou abrir o link duas vezes conta como uma única chegada.
- `purchase`: esse visitante concluiu uma compra.

| Campo | Exemplo | O que é | Em `touch` | Em `purchase` |
|---|---|---|:-:|:-:|
| `event` | `"purchase"` | `touch` ou `purchase` | ✓ | ✓ |
| `store_domain` | `"tienda.com"` | Domínio da página onde o pixel roda | ✓ | ✓ |
| `order_id` | `"12345"` | Identificador do pedido que a sua página expõe. No Shopify é o ID interno do pedido, não o número `#1001`. Vai vazio se a sua página não o expõe | | ✓ |
| `order_value` | `250000` | Valor do pedido. É `0` se faltar ou se for ambíguo | | ✓ |
| `order_value_raw` | `"250000"` | O valor tal como a sua página o expõe, sem interpretar | | ✓ |
| `currency` | `"COP"` | Código de três letras da moeda do pedido. Vai vazio se a sua página não o expõe | | ✓ |
| `order_status` | `"complete"` | `complete` se houver número de pedido e valor maior que 0; caso contrário, `incomplete` | | ✓ |
| `value_source` | `"ecommerce.value"` | De onde o valor foi lido | | ✓ |
| `signal` | `"referrer+utm"` | Por que a visita conta como do Hot Sale (ver §4) | ✓ | ✓ |
| `landed_at` | `"2026-10-19T14:03:22.000Z"` | Hora de chegada vinda do Hot Sale, segundo o relógio do navegador, em UTC | ✓ | ✓ |
| `sent_at` | `"2026-10-19T14:21:05.000Z"` | Hora do envio | ✓ | ✓ |
| `is_test` | `false` | `true` se a URL tinha `hs_test=1` (ver [testes](docs/pruebas.md)) | ✓ | ✓ |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id` | `"hotsale"` | Parâmetros UTM da URL de chegada, de até 200 caracteres cada um | ✓ | ✓ |

Este é um envio `purchase` completo:

```json
{
  "event": "purchase",
  "store_domain": "tienda.com", "order_id": "12345", "order_value": 250000, "order_value_raw": "250000",
  "currency": "COP", "order_status": "complete", "value_source": "ecommerce.value",
  "signal": "referrer+utm", "landed_at": "2026-10-19T14:03:22.000Z", "sent_at": "2026-10-19T14:21:05.000Z",
  "is_test": false, "utm_source": "hotsale", "utm_medium": "referral", "utm_campaign": "hs26oct",
  "utm_content": "", "utm_term": "", "utm_id": ""
}
```

### O que fica guardado no navegador do visitante

O pixel não usa cookies. Usa apenas estas chaves:

| Chave | Onde | Conteúdo | Quando é apagada |
|---|---|---|---|
| `hotsale_touch_v2` | `localStorage` e `sessionStorage` | `v`, `landed_at`, `signal`, `store_domain`, `is_test` e os UTMs | Depois de informar um pedido com número, completo ou não. Também na próxima visita à sua loja, se tiver mais de 30 dias, se estiver corrompida ou se a data estiver mais de um dia no futuro. A cópia no `sessionStorage` é apagada ao fechar a aba |
| `hotsale_sent_<número do pedido>` | `sessionStorage` | `complete` ou `incomplete`. Evita enviar duas vezes o mesmo pedido. Se o pedido não tem número, a chave é `hotsale_sent_` | Ao fechar a aba |

O pixel também apaga a chave `hotsale_data` que a versão de março de 2026 deixava.

## 3. Para onde vão os dados

- **Destino único:** um aplicativo web do Google Apps Script (`https://script.google.com/macros/s/…/exec`). É o único servidor ao qual o pixel se conecta.
- **Onde ficam guardados:** em uma planilha privada do Google da UpSell/BM-Hub, que opera a medição por encomenda da CCCE. A planilha não é compartilhada; os relatórios são feitos no Looker Studio.
- **Retenção:** 6 meses.
- **Quem pode vê-los:** você (o relatório da sua loja), a CCCE e a UpSell/BM-Hub.
- **IP e navegador:** o Google recebe a conexão, como em qualquer serviço web, mas o script não tem acesso ao IP nem aos cabeçalhos da requisição. Recebe apenas o conteúdo do envio.
- **O que o collector rejeita:** envios de domínios que não pertencem a um parceiro cadastrado, com formato diferente do desta versão, com mais de 8 KB, ou mais de 120 por minuto de uma mesma loja. Os pedidos suspeitos ficam marcados para revisão.
- **Formato:** a requisição é um `POST` com corpo `text/plain` (JSON). Não dispara preflight de CORS.

## 4. Regra de atribuição

Uma visita à sua loja conta como **toque do Hot Sale** se pelo menos uma destas condições for cumprida:

- **A — referrer:** a página anterior (`document.referrer`) é exatamente um destes domínios: `hotsale.com.co`, `www.hotsale.com.co`, `hotsale.co` ou `www.hotsale.co`.
- **B — link do Hot Sale:** o parâmetro `utm_source` da URL é exatamente `hotsale`. Não diferencia maiúsculas de minúsculas e ignora espaços no início ou no fim.
- **C — palavra-chave:** algum parâmetro UTM (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` ou `utm_id`) contém uma das palavras-chave das edições anteriores, sem diferenciar maiúsculas de minúsculas. Por exemplo, `utm_campaign=hotsale_newsletter` conta porque contém `hotsale`. A lista é: `hotsale`, `hot_sale`, `hot-sale`, `hot.sale`, `hotsale2026`, `hotsale_2026`, `hotsale-2026`, `hs2026`, `hs_2026`, `hs-2026`, `hotsale_mar`, `hotsale_marzo`, `hotsalemarzo`, `hotsale_oct`, `hotsale_octubre`, `hotsaleoct`, `hotsaleco`, `hotsale_co`, `hotsalecolombia`, `ccce`, `ccceco`, `ccce2026`, `hotsael`, `hotslae`, `hotsalee` e `epsilon`.

Os domínios de A são comparados exatamente: um subdomínio como `blog.hotsale.com.co` não conta. Os UTMs são guardados decodificados, sem espaços no início ou no fim e com no máximo 200 caracteres. Se um parâmetro se repetir na URL, vale o primeiro.

O campo `signal` indica qual condição foi cumprida:

- `referrer+utm`: A, e também B ou C;
- `referrer_only`: somente A;
- `utm_only`: B, sem A;
- `keyword_only`: somente C.

Assim o relatório consegue separar as vendas das campanhas do parceiro para o evento (`keyword_only`, por exemplo `utm_campaign=hotsale_oct` na sua própria newsletter) das que chegam pela plataforma do Hot Sale.

**Modelo: último toque do Hot Sale.**

- Um novo toque do Hot Sale substitui o anterior. O mesmo link seguido novamente em menos de 30 minutos não é um novo toque.
- Uma visita que não é do Hot Sale (Google, suas próprias campanhas, tráfego direto) **não** apaga o toque.
- Cada toque é associado a um único pedido. Depois de informar um pedido com número, completo ou não, o toque é apagado.
- O pixel não informa compras cujo toque tenha mais de 30 dias.
- **Janela do evento:** o relatório conta as compras até 15 dias após o encerramento do evento. O evento vai de 19 a 23 de outubro de 2026, com extensão em 24 e 25 de outubro.
- Os envios com `is_test: true` não contam nos relatórios.

> **Para a sua equipe de marketing:** nas suas próprias campanhas para o evento, inclua `hotsale` em algum UTM (por exemplo, `utm_campaign=hotsale_oct`). Assim essas vendas também contam como do Hot Sale.

**O que este modelo não reivindica:**

- Compras feitas em outro dispositivo ou navegador, porque o toque é guardado no navegador.
- Visitas sem referrer do Hot Sale e sem UTM do Hot Sale. Por exemplo, alguém que viu o Hot Sale e depois digitou a sua URL ou buscou a sua loja no Google.
- Compras feitas depois da janela do evento.
- Um segundo pedido do mesmo visitante sem uma nova chegada vinda do Hot Sale.
- Compras em navegadores que bloqueiam ou apagam o armazenamento, como o modo privado ou o Safari quando apaga o armazenamento de um site após 7 dias sem visitas.

## 5. O que o pixel NÃO faz

- Não lê nem escreve cookies.
- Não carrega scripts de terceiros: nem Google Analytics, nem Meta, nem nenhum outro. O único código que roda é o que você cola.
- Não envia eventos ao seu GA4 nem ao seu pixel da Meta, não chama as suas funções `gtag` ou `fbq` e não adiciona nada ao seu `dataLayer`.
- Não modifica a página: não cria elementos nem insere HTML.
- No GTM/HTML não cria variáveis globais, não registra listeners e não usa temporizadores. No Shopify usa apenas a API de pixels do Shopify (`analytics.subscribe`, `browser.localStorage`, `browser.sessionStorage`, `browser.sendBeacon`) e `fetch` como reserva do envio.
- Não lê dados do comprador nem do carrinho.
- Faz uma única requisição por envio, sempre para a mesma URL.

Estas afirmações são verificadas automaticamente antes de publicar cada versão: a compilação falha se um snippet contiver chamadas a `fbq`, `gtag`, cookies, `dataLayer.push`, temporizadores, listeners, URLs diferentes do collector ou nomes de dados pessoais; e testes no Chromium em páginas com um pixel da Meta e um `gtag` falsos confirmam que essas funções não recebem chamadas, não aparecem variáveis globais, o `dataLayer` não muda e não há requisições além da feita ao collector.

## 6. Como desinstalar

- **GTM:** pause ou exclua as duas tags e publique o contêiner.
- **Shopify:** em *Configurações → Eventos do cliente*, desconecte ou exclua o pixel "Hot Sale".
- **Outras plataformas:** remova os dois blocos de código.

As chaves que restarem nos navegadores dos seus visitantes (§2) deixam de ser lidas e não são enviadas a lugar nenhum.

## 7. Versões e verificação

- Cada snippet indica a sua versão na primeira linha e em `CONFIG.pixelVersion`. Cada envio inclui `pixel_version`.
- O código vive no seu site: não é baixado de nenhum servidor, então não muda a menos que você cole uma nova versão.
- Todos os parceiros recebem exatamente os mesmos arquivos. [`Pixels/SHA256SUMS.txt`](Pixels/SHA256SUMS.txt) tem o SHA-256 de cada um.

Para verificar o arquivo que você recebeu, calcule o SHA-256 dele e compare com `Pixels/SHA256SUMS.txt`:

```sh
shasum -a 256 pixel2-gtm-confirmacion.html                          # macOS / Linux
cd Pixels && shasum -a 256 -c SHA256SUMS.txt                          # todos, em uma cópia do repositório
```

```powershell
Get-FileHash .\pixel2-gtm-confirmacion.html -Algorithm SHA256        # Windows
```

## 8. Contato

- Implementação e dúvidas: sergio@upsellmarketing.co
- Vulnerabilidades: ver [SECURITY.md](SECURITY.md)

---

Licença: [MIT](LICENSE).
