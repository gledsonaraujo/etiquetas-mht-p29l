// Etiqueta de produto em TSPL para a impressora térmica Milestone MHT-P29L.
//
// DOMÍNIO PURO: monta os comandos que vão à impressora e, da MESMA montagem, a prévia da
// tela — uma prévia desenhada por conta própria prometeria uma etiqueta e imprimiria outra.
// Nada aqui toca a porta serial, o DOM ou o relógio.
//
// O que a P29L ensinou na prática e virou regra:
//
//  - SÓ ASCII PURO (0x20–0x7E) chega à impressora. O firmware opera em GBK e qualquer
//    byte acima de 0x7F vira o primeiro byte de um ideograma — o acento sai como lixo,
//    SEM ERRO NENHUM. `asciiImpressao()` é a porta única de normalização, e roda ANTES de
//    qualquer conta de largura ('º' vira 'o.', que tem 2 caracteres).
//  - A LARGURA É EM CARACTERES, não em milímetros: `caracteresPorLinha(cfg)`.
//  - O CÓDIGO DE BARRAS SE RESERVA ANTES DO TEXTO: texto primeiro empurraria o código para
//    fora quando o nome cresce. E código que não cabe nem com barra estreita 1 SAI da
//    etiqueta com aviso — truncá-lo imprimiria um código ERRADO, que o leitor leria sem
//    reclamar.
//  - CORTE SEMPRE EM LIMITE DE PALAVRA, sem reticências.
//
// O arquivo serve ao navegador (window.Etiqueta, por <script> clássico — funciona até
// abrindo o index.html direto do disco) e ao Node (require, para os testes).
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.Etiqueta = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // -------------------------------------------------------------------------------------
  // Normalização — a limitação nº 1 do hardware
  // -------------------------------------------------------------------------------------

  /**
   * Reduz qualquer texto ao ASCII imprimível (0x20–0x7E, mais '\n').
   * Os substitutos vêm antes do NFD porque não são acentos. O que sobrar fora da faixa é
   * REMOVIDO, não trocado por '?': um emoji no nome não merece ocupar um caractere.
   */
  function asciiImpressao(s) {
    return String(s == null ? '' : s)
      .replace(/º/g, 'o.').replace(/ª/g, 'a.').replace(/°/g, 'o')
      .replace(/½/g, '1/2').replace(/¼/g, '1/4').replace(/¾/g, '3/4')
      .replace(/[–—]/g, '-').replace(/×/g, 'x')
      .replace(/[“”„]/g, '"').replace(/[‘’]/g, "'")
      .replace(/…/g, '...')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\x20-\x7e\n]/g, '');
  }

  /** `R$ 1.234,56` em ASCII puro. */
  function moedaImpressao(valor) {
    const n = Number(valor) || 0;
    const partes = Math.abs(n).toFixed(2).split('.');
    const milhar = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '-' : '') + 'R$ ' + milhar + ',' + partes[1];
  }

  /** Quebra texto respeitando palavras; palavra maior que a largura é cortada seca. */
  function quebrarTexto(texto, largura) {
    const linhas = [];
    let atual = '';
    for (const palavra of String(texto || '').split(/\s+/).filter(Boolean)) {
      const p = palavra.length > largura ? palavra.slice(0, largura) : palavra;
      if (atual.length + p.length + (atual ? 1 : 0) <= largura) {
        atual += (atual ? ' ' : '') + p;
      } else {
        if (atual) linhas.push(atual);
        atual = p;
      }
    }
    if (atual) linhas.push(atual);
    return linhas;
  }

  /** Corta em limite de PALAVRA, nunca no meio e nunca com reticências. */
  function truncarPalavra(texto, largura) {
    const t = String(texto || '').trim();
    if (t.length <= largura) return t;
    const corte = t.slice(0, largura);
    const espaco = corte.lastIndexOf(' ');
    return (espaco > 0 ? corte.slice(0, espaco) : corte).trimEnd();
  }

  /** Duas colunas na mesma linha: esquerda + preenchimento + direita, na largura exata. */
  function duasColunas(esq, dir, colunas, preenchimento) {
    const pre = preenchimento || ' ';
    let e = esq;
    let espaco = colunas - e.length - dir.length;
    if (espaco < 1) {
      e = e.slice(0, Math.max(0, colunas - dir.length - 1));
      espaco = colunas - e.length - dir.length;
    }
    return e + pre.repeat(Math.max(1, espaco)) + dir;
  }

  // -------------------------------------------------------------------------------------
  // Configuração — geometria e calibração
  // -------------------------------------------------------------------------------------

  /** 203 DPI ≈ 8 dots/mm. */
  const DOTS_POR_MM = 8;

  /**
   * A calibração que a GWORK usa no GWise (Estoque → Configurações → Etiquetas), medida na
   * MHT-P29L real: etiqueta 50×30 mm, gap 3 mm. Ela é o padrão desta página.
   *
   * - `offset_x_mm`: distância do dot 0 da cabeça à borda esquerda da etiqueta. NÃO SE
   *   ESTIMA — se mede com a régua ou a moldura (a estimativa geométrica dava 24 mm; o real
   *   era 0).
   * - `densidade` 0–15: código de barras que não lê pede densidade MENOR, não maior.
   * - `velocidade` em polegadas/s: mais devagar = mais nítido.
   * - `direcao` 0 ou 1: se a etiqueta sair de cabeça para baixo, troque.
   * - `fonte`: na P29L só a "2" é confiável (a "1" corta a base, a "3" não existe).
   * - métricas da fonte em dots, MEDIDAS e pessimistas de propósito.
   * - `pausa_por_etiqueta_ms`: respiro entre etiquetas de uma lista, para não estourar o
   *   buffer de ~1,5 KB da impressora enquanto ela ainda está imprimindo a anterior.
   */
  const CONFIG_PADRAO = Object.freeze({
    largura_mm: 50, altura_mm: 30, gap_mm: 3, offset_x_mm: 0, margem_mm: 2,
    densidade: 8, velocidade: 2, direcao: 1,
    fonte: '2', fonte_largura_dots: 13, fonte_altura_dots: 40, entrelinha_dots: 2,
    pausa_por_etiqueta_ms: 1000,
  });

  const numeroOu = (v, padrao) => {
    const n = Number(v);
    return v !== '' && v != null && Number.isFinite(n) ? n : padrao;
  };
  const prende = (v, min, max) => Math.min(max, Math.max(min, v));

  /** Lê uma configuração qualquer (localStorage, JSON importado); torto cai no padrão. */
  function lerConfig(c) {
    const p = CONFIG_PADRAO;
    if (!c || typeof c !== 'object') return Object.assign({}, p);
    return {
      largura_mm: prende(numeroOu(c.largura_mm, p.largura_mm), 10, 120),
      altura_mm: prende(numeroOu(c.altura_mm, p.altura_mm), 5, 200),
      gap_mm: prende(numeroOu(c.gap_mm, p.gap_mm), 0, 15),
      offset_x_mm: prende(numeroOu(c.offset_x_mm, p.offset_x_mm), 0, 60),
      margem_mm: prende(numeroOu(c.margem_mm, p.margem_mm), 0, 15),
      densidade: prende(Math.trunc(numeroOu(c.densidade, p.densidade)), 0, 15),
      velocidade: prende(Math.trunc(numeroOu(c.velocidade, p.velocidade)), 1, 8),
      direcao: c.direcao === 0 || c.direcao === '0' ? 0 : 1,
      fonte: /^[1-8]$/.test(String(c.fonte)) ? String(c.fonte) : p.fonte,
      fonte_largura_dots: prende(Math.trunc(numeroOu(c.fonte_largura_dots, p.fonte_largura_dots)), 4, 80),
      fonte_altura_dots: prende(Math.trunc(numeroOu(c.fonte_altura_dots, p.fonte_altura_dots)), 8, 160),
      entrelinha_dots: prende(Math.trunc(numeroOu(c.entrelinha_dots, p.entrelinha_dots)), 0, 60),
      pausa_por_etiqueta_ms: prende(Math.trunc(numeroOu(c.pausa_por_etiqueta_ms, p.pausa_por_etiqueta_ms)), 0, 10000),
    };
  }

  // -------------------------------------------------------------------------------------
  // TSPL
  // -------------------------------------------------------------------------------------

  const mmParaDots = (v) => Math.round(v * DOTS_POR_MM);

  /** Quantos caracteres da fonte configurada cabem na largura útil da etiqueta. */
  function caracteresPorLinha(cfg) {
    const util = mmParaDots(cfg.largura_mm - 2 * cfg.margem_mm);
    return Math.max(1, Math.floor(util / Math.max(1, cfg.fonte_largura_dots)));
  }

  /** Largura estimada de um Code128 em dots: 11 módulos por símbolo + start, DV e stop. */
  function larguraCode128(dados, estreita) {
    return (11 * (dados.length + 3) + 13) * estreita;
  }

  /** Texto TSPL vai entre aspas duplas — a aspa no conteúdo viraria fim de string. */
  const textoTspl = (s) => asciiImpressao(s).replace(/"/g, "'");

  /** O cabeçalho obrigatório de toda etiqueta: geometria, densidade e limpeza do buffer. */
  function cabecalhoTspl(cfg) {
    return [
      'SIZE ' + cfg.largura_mm + ' mm,' + cfg.altura_mm + ' mm',
      'GAP ' + cfg.gap_mm + ' mm,0 mm',
      'DIRECTION ' + cfg.direcao,
      'REFERENCE 0,0',
      'DENSITY ' + prende(Math.trunc(cfg.densidade), 0, 15),
      'SPEED ' + prende(Math.trunc(cfg.velocidade), 1, 8),
      'SET TEAR ON',
      'CLS',
    ];
  }

  /** Junta os comandos no fio: ASCII terminado em CRLF, com o PRINT no fim. */
  function renderTspl(cmds, copias) {
    const n = prende(Math.trunc(copias) || 1, 1, 100);
    return cmds.concat(['PRINT 1,' + n]).join('\r\n') + '\r\n';
  }

  /**
   * Etiqueta de identificação de produto: nome (até 2 linhas), SKU + preço e Code128 no
   * rodapé — a mesma do GWise.
   *
   * O código codifica `codigo_barras` ou, sem ele, o SKU — o que um leitor de balcão
   * procuraria. Devolve, além do TSPL, a GEOMETRIA de cada elemento (em dots, relativa à
   * borda esquerda da etiqueta) para a prévia desenhar exatamente o que foi montado.
   *
   * @param {{nome:string, sku?:string, codigo_barras?:string, preco_venda?:number|null}} produto
   * @param {object} cfg  saída de `lerConfig`
   * @param {{copias:number, incluirCodigo:boolean, incluirPreco:boolean}} opcoes
   */
  function montarEtiquetaProduto(produto, cfg, opcoes) {
    const cmds = cabecalhoTspl(cfg);
    const linhas = [];
    const avisos = [];
    const elementos = [];

    const chars = caracteresPorLinha(cfg);
    const xPrevia = mmParaDots(cfg.margem_mm);
    const x0 = mmParaDots(cfg.offset_x_mm + cfg.margem_mm);
    const larguraUtil = mmParaDots(cfg.largura_mm - 2 * cfg.margem_mm);
    const alturaLinha = cfg.fonte_altura_dots + cfg.entrelinha_dots;
    let teto = mmParaDots(cfg.altura_mm - cfg.margem_mm);

    // 1. Reservar o código ANTES do texto.
    let codigo = null;
    if (opcoes.incluirCodigo) {
      const dado = asciiImpressao(produto.codigo_barras || produto.sku || '').trim();
      if (!dado) {
        avisos.push('Produto sem código de barras e sem SKU — a etiqueta sai só com texto.');
      } else {
        const estreita = larguraCode128(dado, 2) <= larguraUtil ? 2
          : larguraCode128(dado, 1) <= larguraUtil ? 1 : 0;
        if (estreita === 0) {
          avisos.push('O código "' + dado + '" não cabe na largura da etiqueta e ficou de fora — truncá-lo imprimiria um código errado.');
        } else {
          const ALT_BARRAS = 40;
          const yBarras = teto - ALT_BARRAS;
          codigo = dado;
          cmds.push('BARCODE ' + x0 + ',' + yBarras + ',"128",' + ALT_BARRAS + ',0,0,' + estreita + ',' + (estreita * 2) + ',"' + textoTspl(dado) + '"');
          elementos.push({ tipo: 'barras', x: xPrevia, y: yBarras, altura: ALT_BARRAS, estreita: estreita, dado: dado });
          teto = yBarras - cfg.entrelinha_dots;
        }
      }
    }

    // 2. Texto com cursor vertical: escreve enquanto couber acima do código.
    let cursor = mmParaDots(cfg.margem_mm);
    const escrever = (texto) => {
      if (!texto || cursor + cfg.fonte_altura_dots > teto) return false;
      cmds.push('TEXT ' + x0 + ',' + cursor + ',"' + cfg.fonte + '",0,1,1,"' + textoTspl(texto) + '"');
      linhas.push(texto);
      elementos.push({ tipo: 'texto', x: xPrevia, y: cursor, texto: textoTspl(texto) });
      cursor += alturaLinha;
      return true;
    };

    const nome = asciiImpressao(produto.nome || '').trim();
    const linhasNome = quebrarTexto(nome, chars);
    for (const l of linhasNome.slice(0, 2)) escrever(l);
    if (linhasNome.length > 2) avisos.push('O nome não coube em duas linhas — o restante ficou de fora: "' + linhasNome.slice(2).join(' ') + '".');

    const sku = asciiImpressao(produto.sku || '').trim();
    const precoNum = produto.preco_venda == null || produto.preco_venda === '' ? null : Number(produto.preco_venda);
    const preco = opcoes.incluirPreco && precoNum != null && precoNum > 0 ? moedaImpressao(precoNum) : null;
    let ok = true;
    if (sku && preco) ok = escrever(duasColunas(sku, preco, chars));
    else if (sku) ok = escrever(truncarPalavra(sku, chars));
    else if (preco) ok = escrever(duasColunas('', preco, chars));
    if (!ok) avisos.push('A linha do SKU/preço não coube acima do código de barras.');

    return { tspl: renderTspl(cmds, opcoes.copias), linhas: linhas, codigo: codigo, avisos: avisos, elementos: elementos };
  }

  // -------------------------------------------------------------------------------------
  // Calibração — os utilitários que descobrem os números da configuração
  // -------------------------------------------------------------------------------------

  /** Faz a impressora medir o gap sozinha. Ela avança algumas etiquetas — uma vez por rolo. */
  function montarGapDetect(cfg) {
    return [
      'SIZE ' + cfg.largura_mm + ' mm,' + cfg.altura_mm + ' mm',
      'GAP ' + cfg.gap_mm + ' mm,0 mm',
      'SET TEAR ON',
      'GAPDETECT',
    ].join('\r\n') + '\r\n';
  }

  /** Marcas a cada 5 mm ao longo de toda a cabeça; o menor número visível é o offset. */
  function montarRegua(cfg) {
    const cmds = cabecalhoTspl(cfg);
    for (let v = 0; v <= 71; v += 5) {
      const x = mmParaDots(v);
      cmds.push('BAR ' + x + ',' + mmParaDots(2) + ',2,' + mmParaDots(6));
      cmds.push('TEXT ' + (x + 3) + ',' + mmParaDots(9) + ',"' + cfg.fonte + '",0,1,1,"' + v + '"');
    }
    cmds.push('TEXT 0,' + mmParaDots(17) + ',"' + cfg.fonte + '",0,1,1,"REGUA mm - leia o MENOR numero visivel"');
    return renderTspl(cmds, 1);
  }

  /** Retângulo da área útil — com o offset certo, a moldura aparece inteira e centrada. */
  function montarMoldura(cfg) {
    const cmds = cabecalhoTspl(cfg);
    const x1 = mmParaDots(cfg.offset_x_mm + cfg.margem_mm);
    const x2 = mmParaDots(cfg.offset_x_mm + cfg.largura_mm - cfg.margem_mm);
    cmds.push('BOX ' + x1 + ',' + mmParaDots(cfg.margem_mm) + ',' + x2 + ',' + mmParaDots(cfg.altura_mm - cfg.margem_mm) + ',2');
    cmds.push('TEXT ' + (x1 + 16) + ',' + (mmParaDots(cfg.margem_mm) + 8) + ',"' + cfg.fonte + '",0,1,1,"BORDA OK off=' + cfg.offset_x_mm + 'mm"');
    return renderTspl(cmds, 1);
  }

  /** Uma amostra de cada fonte interna ("1" a "5"), para medir as métricas. */
  function montarAmostraFontes(cfg) {
    const cmds = cabecalhoTspl(cfg);
    const amostra = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    ['1', '2', '3', '4', '5'].forEach((f, i) => {
      const y = mmParaDots(1 + i * 5.5);
      cmds.push('BAR ' + mmParaDots(cfg.offset_x_mm) + ',' + y + ',' + mmParaDots(1.5) + ',2');
      cmds.push('TEXT ' + mmParaDots(cfg.offset_x_mm + 2.5) + ',' + y + ',"' + f + '",0,1,1,"' + f + ':' + amostra + '"');
    });
    return renderTspl(cmds, 1);
  }

  /** Etiqueta de exemplo com a configuração atual — o teste de ponta a ponta. */
  function montarEtiquetaTeste(cfg) {
    return montarEtiquetaProduto(
      { nome: 'Etiqueta de teste', sku: 'TESTE-123', preco_venda: 1234.56 },
      cfg,
      { copias: 1, incluirCodigo: true, incluirPreco: true },
    ).tspl;
  }

  // -------------------------------------------------------------------------------------
  // Code128 — SÓ para a prévia na tela
  // -------------------------------------------------------------------------------------
  //
  // Quem gera o código impresso é a própria impressora (comando BARCODE "128"); isto aqui
  // desenha o mesmo dado no subconjunto B para a prévia ter as barras na largura certa.
  // O firmware pode escolher outro subconjunto para sequências de dígitos, então a largura
  // impressa pode ser MENOR que a desenhada — nunca maior que a estimativa usada na
  // decisão de caber (`larguraCode128`).

  const PADROES_128 = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
  ];
  const START_B = 104;
  const STOP = 106;

  /**
   * Larguras alternadas (barra, espaço, barra, ...) em MÓDULOS do Code128-B do dado, com
   * start, dígito verificador e stop. Caractere fora de 0x20–0x7E não existe no subconjunto
   * B — e já foi removido por `asciiImpressao` antes de chegar aqui.
   */
  function modulosCode128(dado) {
    const valores = [START_B];
    for (const ch of String(dado)) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) throw new Error('Caractere fora do Code128-B: ' + JSON.stringify(ch));
      valores.push(c - 32);
    }
    let soma = valores[0];
    for (let i = 1; i < valores.length; i++) soma += valores[i] * i;
    valores.push(soma % 103, STOP);
    const larguras = [];
    for (const v of valores) for (const d of PADROES_128[v]) larguras.push(Number(d));
    return larguras;
  }

  // -------------------------------------------------------------------------------------
  // Lista de etiquetas — importação de planilha (CSV)
  // -------------------------------------------------------------------------------------

  /** Número no formato brasileiro ("1.234,56") ou internacional ("1234.56"). */
  function numeroBR(v) {
    let s = String(v == null ? '' : v).trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** Lê CSV com `;` ou `,` (o que aparecer mais no cabeçalho), aspas duplas e CRLF. */
  function lerCsv(texto) {
    const t = String(texto || '').replace(/^﻿/, '');
    const primeira = t.split(/\r?\n/, 1)[0] || '';
    const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
    const linhas = [];
    let linha = [];
    let campo = '';
    let aspas = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (aspas) {
        if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; }
        else if (ch === '"') aspas = false;
        else campo += ch;
      } else if (ch === '"') aspas = true;
      else if (ch === sep) { linha.push(campo); campo = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && t[i + 1] === '\n') i++;
        linha.push(campo); campo = '';
        if (linha.some((c) => c.trim() !== '')) linhas.push(linha);
        linha = [];
      } else campo += ch;
    }
    linha.push(campo);
    if (linha.some((c) => c.trim() !== '')) linhas.push(linha);
    return linhas;
  }

  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  /** Cabeçalhos aceitos — inclui os da planilha de produtos exportada pelo GWise. */
  const COLUNAS_CSV = {
    nome: ['nome', 'descricao', 'produto'],
    sku: ['sku', 'codigo', 'codigo interno'],
    codigo_barras: ['codigo de barras', 'codigo_barras', 'ean', 'gtin', 'codigo barras'],
    preco_venda: ['preco de venda', 'preco_venda', 'preco', 'valor'],
    copias: ['copias', 'quantidade', 'qtd', 'qtde', 'etiquetas'],
  };

  /**
   * Converte um CSV em itens de etiqueta. Linha sem nome é RECUSADA com o número dela,
   * nunca descartada em silêncio.
   * @returns {{itens: Array<object>, erros: string[]}}
   */
  function itensDoCsv(texto) {
    const linhas = lerCsv(texto);
    const erros = [];
    if (!linhas.length) return { itens: [], erros: ['O arquivo está vazio.'] };
    const cab = linhas[0].map(semAcento);
    const indice = {};
    for (const chave of Object.keys(COLUNAS_CSV)) {
      indice[chave] = cab.findIndex((c) => COLUNAS_CSV[chave].includes(c));
    }
    if (indice.nome < 0) {
      return { itens: [], erros: ['A planilha precisa de uma coluna "Nome" no cabeçalho (aceitas também: Descrição, Produto).'] };
    }
    const itens = [];
    linhas.slice(1).forEach((l, i) => {
      const cel = (k) => (indice[k] >= 0 ? String(l[indice[k]] || '').trim() : '');
      const nome = cel('nome');
      if (!nome) { erros.push('Linha ' + (i + 2) + ': sem nome — ignorada.'); return; }
      const copias = numeroBR(cel('copias'));
      itens.push({
        nome: nome,
        sku: cel('sku'),
        codigo_barras: cel('codigo_barras'),
        preco_venda: numeroBR(cel('preco_venda')),
        copias: copias && copias >= 1 ? Math.min(100, Math.trunc(copias)) : 1,
      });
    });
    return { itens: itens, erros: erros };
  }

  return {
    asciiImpressao, moedaImpressao, quebrarTexto, truncarPalavra, duasColunas,
    DOTS_POR_MM, CONFIG_PADRAO, lerConfig, mmParaDots, caracteresPorLinha, larguraCode128,
    cabecalhoTspl, renderTspl, montarEtiquetaProduto,
    montarGapDetect, montarRegua, montarMoldura, montarAmostraFontes, montarEtiquetaTeste,
    PADROES_128, modulosCode128, numeroBR, lerCsv, itensDoCsv,
  };
});
