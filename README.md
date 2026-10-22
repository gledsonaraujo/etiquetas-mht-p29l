# Etiquetas MHT-P29L

Página web estática que imprime etiquetas na impressora térmica **Milestone MHT-P29L**
(modo etiqueta, TSPL) direto do navegador — sem servidor, sem instalar driver, sem
dependência. Dois tipos de etiqueta:

- **Produto** — a mesma do GWise (Estoque → Etiqueta do produto);
- **Personalizada** — texto livre digitado dentro da área imprimível.

A etiqueta de produto usa a calibração medida na P29L real:

```
┌──────────────────────────────────────┐  50 × 30 mm
│ Filtro de oleo                       │  nome (até 2 linhas, corte em palavra)
│ GW-0001              R$ 45,90        │  SKU + preço de venda
│ ▌▌▐▌▐▐▌▌▐▌▐▐▌▌▐▌▐▐▌▌▐▌▐▐▌▌▐▌▐         │  Code128 (código de barras ou, sem ele, o SKU)
└──────────────────────────────────────┘
```

## Etiqueta personalizada

Escolha **✍️ Personalizada** no topo do formulário e digite qualquer texto. Ele é impresso
dentro da área útil (a etiqueta menos a margem):

```
┌──────────────────────────────────────┐
│               GWORK                  │  1ª linha em destaque (um tamanho acima)
│                                      │  linha em branco = espaço
│         Revisao preventiva           │
│         Proxima: 12/2026             │
└──────────────────────────────────────┘
```

- **Cada Enter começa uma linha**; linha maior que a largura quebra em palavras, e palavra
  maior que a linha é partida — nenhum caractere se perde (importa num número de série).
- **Tamanho** 1× a 4× (o multiplicador da fonte da impressora). Na 50×30 mm: 28 caracteres
  e 5 linhas no 1×; 14 caracteres e 2 linhas no 2×.
- **Alinhamento** esquerda, centro ou direita, e **na altura** no topo ou centralizado.
- **Destacar a 1ª linha**: o título sai um tamanho acima.
- O que não couber na altura **não some em silêncio**: aparece um aviso com o texto que
  ficou de fora.
- Como na etiqueta de produto, acentos saem sem acento (`ç` → `c`) e aspas duplas viram
  simples — limitação do firmware da impressora.

A etiqueta personalizada entra na mesma lista de impressão que a de produto.

## O que a página faz

- **Etiqueta avulsa**: preencha a etiqueta (produto ou texto livre) e as cópias e imprima.
- **Prévia fiel**: a prévia é desenhada a partir da MESMA montagem que vai à impressora,
  e os comandos TSPL ficam visíveis (e copiáveis) logo abaixo.
- **Lista**: junte várias etiquetas e imprima tudo de uma vez, numa conexão só. A lista
  fica salva no navegador.
- **Importar planilha (CSV)**: coluna **Nome** obrigatória; **SKU**, **Código de barras**,
  **Preço de venda** e **Cópias** opcionais. Separador `;` ou `,`, preço no formato
  `1.234,56`. A planilha de produtos exportada pelo GWise é aceita como está. Há um botão
  para baixar o modelo.
- **Configuração e calibração**: geometria, densidade, velocidade, direção e métricas da
  fonte, com os utilitários de calibração (detectar gap, régua, moldura, amostra de fontes
  e etiqueta de teste). A configuração fica salva no navegador e pode ser exportada/
  importada em JSON.

## Requisitos

- **Chrome ou Edge num computador.** A página fala com a impressora pela
  [Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API), que só eles
  implementam. Safari, Firefox e celulares não têm a API — a página avisa.
- A página precisa estar em **https** (GitHub Pages) **ou** aberta direto do disco
  (`index.html`). Em `http://` comum o navegador esconde a API.
- A impressora no modo **etiqueta (CMD=TSPL)**, escolhido no menu do próprio aparelho. Os
  modos cupom (CMD=ESC) e etiqueta são excludentes, e não há troca por software.

## Como conectar

- **Bluetooth:** pareie a impressora no Windows. Na primeira impressão o navegador pede a
  porta — escolha a opção com o **nome da impressora** (ex.: `MHT-P29L: pareado`). Só se ela
  não aparecer, use a porta COM de **saída** (Outgoing); a de entrada (Incoming) nunca
  funciona: ela aceita a conexão e trava a escrita sem erro nenhum.
- **USB:** escolha a porta USB-serial.
- A impressora Bluetooth aceita **um aparelho por vez**: se o celular estiver conectado a
  ela, desligue o Bluetooth dele.
- A permissão fica gravada no navegador; nas próximas vezes a página imprime direto. Para
  apontar outra porta, use **Trocar impressora**.

## Publicar no GitHub Pages

1. Crie o repositório no GitHub e envie este projeto (`git push`).
2. Em **Settings → Pages**, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. A página fica em `https://<usuario>.github.io/<repositorio>/`.

O arquivo `.nojekyll` faz o GitHub servir os arquivos como estão.

## Usar sem publicar

Abra o `index.html` com duplo clique no Chrome/Edge — os scripts são clássicos (não são
módulos ES) justamente para funcionar a partir do disco. Para servir localmente:

```bash
npm start
```

(`http://localhost` também conta como origem segura para a Web Serial.)

## Testes

O domínio da etiqueta (`src/etiqueta.js`) é puro e tem testes sem dependência:

```bash
npm test
```

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | A página |
| `src/etiqueta.js` | Domínio puro: monta o TSPL (produto e texto livre) e os elementos da prévia; calibração; CSV; Code128 da prévia |
| `src/impressora.js` | Envio pela Web Serial, em blocos de 512 bytes e com prazo em todo passo |
| `src/app.js` | A tela: formulário, prévia, lista, configuração |
| `src/estilo.css` | Estilo (claro e escuro) |
| `tests/etiqueta.test.js` | Testes (`node --test`) |

## O que a P29L ensinou (e virou regra no código)

- **Só ASCII chega à impressora.** O firmware opera em GBK: acento vira lixo, sem erro. Todo
  texto passa por `asciiImpressao` (`ç` → `c`, `º` → `o.`, `—` → `-`) **antes** da conta de
  largura.
- **Largura é em caracteres**, não em milímetros: 28 caracteres por linha na 50 mm com a
  fonte 2 (13 dots por caractere).
- **O código de barras é reservado antes do texto**, e código que não cabe **sai da
  etiqueta com aviso** — truncá-lo imprimiria um código errado que o leitor leria sem
  reclamar. Código que o leitor não lê pede **densidade menor**, não maior.
- **Corte sempre em palavra**, sem reticências.
- **Buffer de ~1,5 KB**: o envio é em blocos de 512 bytes, com uma pausa entre etiquetas da
  lista (ajustável em *Pausa por etiqueta*).
- **Todo passo do envio tem prazo**: a porta Bluetooth errada aceita a conexão e trava a
  escrita para sempre; sem prazo, o botão ficaria em "Imprimindo..." eternamente.
- **Offset X se mede, não se estima** (na P29L a estimativa dava 24 mm; o real é 0): use a
  régua e a moldura.
