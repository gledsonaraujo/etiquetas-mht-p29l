// Testes do domínio puro (src/etiqueta.js). Sem dependência: `node --test`.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../src/etiqueta.js');

const cfg = E.lerConfig(null);
const opcoes = { copias: 1, incluirCodigo: true, incluirPreco: true };

test('o padrão é a calibração da P29L usada no GWise', () => {
  assert.deepEqual(
    { ...cfg },
    {
      largura_mm: 50, altura_mm: 30, gap_mm: 3, offset_x_mm: 0, margem_mm: 2,
      densidade: 8, velocidade: 2, direcao: 1,
      fonte: '2', fonte_largura_dots: 13, fonte_altura_dots: 40, entrelinha_dots: 2,
      pausa_por_etiqueta_ms: 1000,
    },
  );
});

test('lerConfig prende os limites e cai no padrão com valor torto', () => {
  const c = E.lerConfig({ largura_mm: 500, densidade: -3, fonte: '9', direcao: '0', gap_mm: 'abc', margem_mm: '' });
  assert.equal(c.largura_mm, 120);
  assert.equal(c.densidade, 0);
  assert.equal(c.fonte, '2');
  assert.equal(c.direcao, 0);
  assert.equal(c.gap_mm, 3);
  assert.equal(c.margem_mm, 2, 'campo vazio não vira zero');
});

test('só ASCII chega à impressora', () => {
  assert.equal(E.asciiImpressao('Pç nº 3 — ação × 2 “ok” …'), 'Pc no. 3 - acao x 2 "ok" ...');
  assert.equal(E.asciiImpressao('café ☕ 🙂'), 'cafe  ');
  assert.equal(E.asciiImpressao('Tubo ½" 90°'), 'Tubo 1/2" 90o');
  const { tspl } = E.montarEtiquetaProduto({ nome: 'Válvula de pressão ½"', sku: 'VÁL-1', preco_venda: 10 }, cfg, opcoes);
  for (const ch of tspl) {
    const c = ch.charCodeAt(0);
    assert.ok(c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e), 'byte fora do ASCII: ' + c);
  }
});

test('moeda e número no formato brasileiro', () => {
  assert.equal(E.moedaImpressao(1234.5), 'R$ 1.234,50');
  assert.equal(E.moedaImpressao(-3), '-R$ 3,00');
  assert.equal(E.numeroBR('1.234,56'), 1234.56);
  assert.equal(E.numeroBR('R$ 45,90'), 45.9);
  assert.equal(E.numeroBR('12.5'), 12.5);
  assert.equal(E.numeroBR(''), null);
  assert.equal(E.numeroBR('abc'), null);
});

test('caracteres por linha na 50 mm com a fonte medida', () => {
  // (50 - 2×2) mm × 8 = 368 dots ÷ 13 = 28
  assert.equal(E.caracteresPorLinha(cfg), 28);
});

test('etiqueta completa: cabeçalho, código ANTES do texto, PRINT no fim', () => {
  const m = E.montarEtiquetaProduto(
    { nome: 'Filtro de oleo', sku: 'GW-0001', codigo_barras: '7891234567895', preco_venda: 45.9 },
    cfg, { ...opcoes, copias: 3 },
  );
  const linhas = m.tspl.split('\r\n');
  assert.deepEqual(linhas.slice(0, 8), [
    'SIZE 50 mm,30 mm', 'GAP 3 mm,0 mm', 'DIRECTION 1', 'REFERENCE 0,0',
    'DENSITY 8', 'SPEED 2', 'SET TEAR ON', 'CLS',
  ]);
  assert.ok(m.tspl.endsWith('PRINT 1,3\r\n'));
  const iBarras = linhas.findIndex((l) => l.startsWith('BARCODE'));
  const iTexto = linhas.findIndex((l) => l.startsWith('TEXT'));
  assert.ok(iBarras > 0 && iBarras < iTexto, 'o código é reservado antes do texto');
  // teto = (30-2)×8 = 224; barras de 40 dots → y = 184; x = margem 2 mm = 16.
  // EAN de 13 dígitos: (11×16+13)×2 = 378 > 368 dots úteis → barra estreita 1.
  assert.equal(linhas[iBarras], 'BARCODE 16,184,"128",40,0,0,1,2,"7891234567895"');
  assert.deepEqual(m.linhas, ['Filtro de oleo', 'GW-0001' + ' '.repeat(13) + 'R$ 45,90']);
  assert.equal(m.linhas[1].length, 28);
  assert.equal(m.codigo, '7891234567895');
  assert.deepEqual(m.avisos, []);
});

test('sem código de barras, codifica o SKU', () => {
  const m = E.montarEtiquetaProduto({ nome: 'X', sku: 'ABC-9' }, cfg, opcoes);
  assert.equal(m.codigo, 'ABC-9');
});

test('código que não cabe SAI com aviso — nunca truncado', () => {
  const longo = 'A'.repeat(40);
  const m = E.montarEtiquetaProduto({ nome: 'X', codigo_barras: longo }, cfg, opcoes);
  assert.equal(m.codigo, null);
  assert.ok(!m.tspl.includes('BARCODE'));
  assert.equal(m.avisos.length, 1);
  assert.match(m.avisos[0], /não cabe/);
});

test('código médio cai para a barra estreita 1', () => {
  // 18 caracteres: (11×21+13)×2 = 488 > 368; ×1 = 244 ≤ 368
  const m = E.montarEtiquetaProduto({ nome: 'X', codigo_barras: '123456789012345678' }, cfg, opcoes);
  assert.match(m.tspl, /BARCODE 16,184,"128",40,0,0,1,2,/);
});

test('nome longo: duas linhas, em limite de palavra, e aviso do que sobrou', () => {
  const m = E.montarEtiquetaProduto(
    { nome: 'Kit de reparo completo para cadeira odontologica modelo antigo com pedal', sku: 'K1' },
    cfg, { ...opcoes, incluirCodigo: false },
  );
  assert.equal(m.linhas.length, 3);
  for (const l of m.linhas.slice(0, 2)) assert.ok(l.length <= 28);
  assert.equal(m.linhas[0], 'Kit de reparo completo para');
  assert.ok(m.avisos.some((a) => /duas linhas/.test(a)));
});

test('aspas do conteúdo não fecham a string TSPL', () => {
  const m = E.montarEtiquetaProduto({ nome: 'Tubo 1/2" inox' }, cfg, { ...opcoes, incluirCodigo: false });
  assert.ok(m.tspl.includes('"Tubo 1/2\' inox"'));
});

test('preço zero ou ausente não sai; desmarcado também não', () => {
  const zero = E.montarEtiquetaProduto({ nome: 'X', sku: 'S', preco_venda: 0 }, cfg, opcoes);
  assert.ok(!zero.tspl.includes('R$'));
  const desmarcado = E.montarEtiquetaProduto({ nome: 'X', sku: 'S', preco_venda: 9 }, cfg, { ...opcoes, incluirPreco: false });
  assert.ok(!desmarcado.tspl.includes('R$'));
});

test('cópias presas entre 1 e 100', () => {
  assert.ok(E.renderTspl([], 0).endsWith('PRINT 1,1\r\n'));
  assert.ok(E.renderTspl([], 500).endsWith('PRINT 1,100\r\n'));
});

test('a prévia recebe os mesmos elementos que viraram comando', () => {
  const m = E.montarEtiquetaProduto({ nome: 'Filtro', sku: 'GW-1', preco_venda: 5 }, cfg, opcoes);
  const textos = m.tspl.split('\r\n').filter((l) => l.startsWith('TEXT')).length;
  assert.equal(m.elementos.filter((e) => e.tipo === 'texto').length, textos);
  assert.equal(m.elementos.filter((e) => e.tipo === 'barras').length, 1);
});

test('tabela Code128 íntegra (107 símbolos, 11 módulos, stop com 13)', () => {
  assert.equal(E.PADROES_128.length, 107);
  E.PADROES_128.slice(0, 106).forEach((p, i) => {
    assert.equal(p.length, 6, 'símbolo ' + i);
    assert.equal([...p].reduce((s, d) => s + Number(d), 0), 11, 'símbolo ' + i);
  });
  assert.equal([...E.PADROES_128[106]].reduce((s, d) => s + Number(d), 0), 13);
  assert.equal(new Set(E.PADROES_128).size, 107, 'sem símbolos repetidos');
});

test('Code128-B: dígito verificador e largura batem com a estimativa', () => {
  const dado = 'GW-0001';
  const mod = E.modulosCode128(dado);
  const total = mod.reduce((s, v) => s + v, 0);
  assert.equal(total, 11 * (dado.length + 2) + 13, 'start + dados + DV com 11 cada, stop com 13');
  // A estimativa que decide se cabe é PESSIMISTA: nunca menor que o código desenhado.
  assert.ok(total * 2 <= E.larguraCode128(dado, 2));
  // Verificador: start B (104) + Σ valor×posição, mod 103.
  const valores = [...dado].map((c) => c.charCodeAt(0) - 32);
  const dv = (104 + valores.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  const simbolo = mod.slice(6 * (dado.length + 1), 6 * (dado.length + 2)).join('');
  assert.equal(simbolo, E.PADROES_128[dv]);
});

test('Code128-B conhecido: "PJJ123C"', () => {
  // 104 + 48×1 + 42×2 + 42×3 + 17×4 + 18×5 + 19×6 + 35×7 = 879; 879 mod 103 = 55.
  const valores = [...'PJJ123C'].map((c) => c.charCodeAt(0) - 32);
  const dv = (104 + valores.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  assert.equal(dv, 55);
  assert.equal(E.PADROES_128[0], '212222', 'espaço');
  assert.equal(E.PADROES_128[103], '211412', 'start A');
  assert.equal(E.PADROES_128[105], '211232', 'start C');
  const mod = E.modulosCode128('PJJ123C');
  assert.deepEqual(mod.slice(0, 6), [2, 1, 1, 2, 1, 4], 'start B = 211214');
  assert.deepEqual(mod.slice(-7), [2, 3, 3, 1, 1, 1, 2], 'stop = 2331112');
});

test('CSV: cabeçalho do GWise, separador ;, aspas e preço brasileiro', () => {
  const csv = '﻿Nome;SKU;Código de barras;Preço de venda;Cópias\r\n'
    + '"Filtro; de óleo";GW-0001;7891234567895;"1.234,56";3\r\n'
    + ';GW-0002;;1,00;1\r\n'
    + 'Mangueira "flex";GW-0003;;;\r\n';
  const r = E.itensDoCsv(csv);
  assert.equal(r.itens.length, 2);
  assert.deepEqual(r.itens[0], { nome: 'Filtro; de óleo', sku: 'GW-0001', codigo_barras: '7891234567895', preco_venda: 1234.56, copias: 3 });
  assert.equal(r.itens[1].copias, 1);
  assert.equal(r.itens[1].preco_venda, null);
  assert.deepEqual(r.erros, ['Linha 3: sem nome — ignorada.']);
});

test('CSV com vírgula e sem coluna Nome', () => {
  assert.equal(E.itensDoCsv('nome,preco\nA,"2,50"\n').itens[0].preco_venda, 2.5);
  const sem = E.itensDoCsv('sku;preco\nA;1\n');
  assert.equal(sem.itens.length, 0);
  assert.match(sem.erros[0], /Nome/);
});

test('calibração: régua, moldura, gap e fontes são TSPL completos', () => {
  assert.match(E.montarGapDetect(cfg), /GAPDETECT\r\n$/);
  assert.match(E.montarRegua(cfg), /PRINT 1,1\r\n$/);
  assert.match(E.montarMoldura(cfg), /BOX 16,16,384,224,2/);
  assert.equal((E.montarAmostraFontes(cfg).match(/^TEXT /gm) || []).length, 5);
  assert.match(E.montarEtiquetaTeste(cfg), /BARCODE/);
});

const textoOp = { copias: 1, tamanho: 1, alinhamento: 'esquerda', vertical: 'topo', destacarPrimeira: false };

test('texto livre: uma linha por Enter, dentro da área útil, PRINT no fim', () => {
  const m = E.montarEtiquetaTexto({ texto: 'Revisão em\n12/2026' }, cfg, { ...textoOp, copias: 2 });
  const textos = m.tspl.split('\r\n').filter((l) => l.startsWith('TEXT'));
  // margem 2 mm = 16 dots; altura 40 + entrelinha 2 → 2ª linha em y = 58
  assert.deepEqual(textos, ['TEXT 16,16,"2",0,1,1,"Revisao em"', 'TEXT 16,58,"2",0,1,1,"12/2026"']);
  assert.ok(m.tspl.endsWith('PRINT 1,2\r\n'));
  assert.deepEqual(m.avisos, []);
  assert.ok(!m.tspl.includes('BARCODE'));
});

test('texto livre: capacidade da 50×30 no tamanho 1 é 5 linhas; o resto vira aviso', () => {
  const m = E.montarEtiquetaTexto({ texto: 'L1\nL2\nL3\nL4\nL5\nL6 sobra' }, cfg, textoOp);
  assert.deepEqual(m.linhas, ['L1', 'L2', 'L3', 'L4', 'L5']);
  assert.equal(m.avisos.length, 1);
  assert.match(m.avisos[0], /L6 sobra/);
});

test('texto livre: tamanho multiplica a fonte e reduz os caracteres por linha', () => {
  assert.equal(E.caracteresNoTamanho(cfg, 1), 28);
  assert.equal(E.caracteresNoTamanho(cfg, 2), 14);
  const m = E.montarEtiquetaTexto({ texto: 'ABCDEFGHIJ KLMNOP' }, cfg, { ...textoOp, tamanho: 2 });
  assert.deepEqual(m.linhas, ['ABCDEFGHIJ', 'KLMNOP']);
  assert.match(m.tspl, /TEXT 16,16,"2",0,2,2,"ABCDEFGHIJ"/);
  assert.match(m.tspl, /TEXT 16,98,"2",0,2,2,"KLMNOP"/, '16 + 80 + 2');
  assert.equal(E.montarEtiquetaTexto({ texto: 'x' }, cfg, { ...textoOp, tamanho: 9 }).elementos[0].escala, 4);
});

test('texto livre: palavra longa é PARTIDA, nunca perde caractere', () => {
  const serie = 'SN-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const m = E.montarEtiquetaTexto({ texto: serie }, cfg, textoOp);
  assert.equal(m.linhas.join(''), serie);
  assert.ok(m.linhas.every((l) => l.length <= 28));
  const marcas = [];
  assert.deepEqual(E.quebrarSemPerda('ab cdefgh', 4, marcas), ['ab', 'cdef', 'gh']);
  assert.deepEqual(marcas, [false, false, true], 'só "gh" começa no meio de uma palavra');
});

test('texto livre: o aviso do que sobrou remonta a palavra partida sem espaço', () => {
  // tamanho 3 → 9 caracteres; "preventiva" (10) é partida em "preventiv" + "a"
  const m = E.montarEtiquetaTexto({ texto: 'GWORK\nRevisao preventiva' }, cfg, { ...textoOp, tamanho: 3 });
  assert.deepEqual(m.linhas, ['GWORK']);
  assert.match(m.avisos[0], /ficou de fora: "Revisao preventiva"/);
});

test('texto livre: alinhamento centro e direita pela largura medida', () => {
  // largura útil 368; "ABCD" = 4×13 = 52 → folga 316
  const c = E.montarEtiquetaTexto({ texto: 'ABCD' }, cfg, { ...textoOp, alinhamento: 'centro' });
  assert.match(c.tspl, /TEXT 174,16,/);
  const d = E.montarEtiquetaTexto({ texto: 'ABCD' }, cfg, { ...textoOp, alinhamento: 'direita' });
  assert.match(d.tspl, /TEXT 332,16,/);
  const comOffset = E.montarEtiquetaTexto({ texto: 'ABCD' }, E.lerConfig({ offset_x_mm: 3 }), textoOp);
  assert.match(comOffset.tspl, /TEXT 40,16,/, 'o offset entra no comando, não na prévia');
  assert.equal(comOffset.elementos[0].x, 16);
});

test('texto livre: centralizar na vertical desce o bloco', () => {
  // altura útil 208 − 40 de uma linha = 168 → desce 84
  const m = E.montarEtiquetaTexto({ texto: 'Meio' }, cfg, { ...textoOp, vertical: 'centro' });
  assert.match(m.tspl, /TEXT 16,100,/);
});

test('texto livre: 1ª linha em destaque, linha em branco no meio vira espaço', () => {
  const m = E.montarEtiquetaTexto({ texto: '\nTitulo\n\nCorpo\n\n' }, cfg, { ...textoOp, destacarPrimeira: true });
  assert.deepEqual(m.linhas, ['Titulo', '', 'Corpo']);
  const t = m.tspl.split('\r\n').filter((l) => l.startsWith('TEXT'));
  // 16 + 80 (título 2×) + 2 + 40 (linha em branco) + 2 = 140
  assert.deepEqual(t, ['TEXT 16,16,"2",0,2,2,"Titulo"', 'TEXT 16,140,"2",0,1,1,"Corpo"']);
});

test('texto livre vazio: aviso e nenhum TEXT', () => {
  const m = E.montarEtiquetaTexto({ texto: '  \n ' }, cfg, textoOp);
  assert.ok(!m.tspl.includes('TEXT'));
  assert.deepEqual(m.avisos, ['Digite o texto da etiqueta.']);
});

test('texto livre: só ASCII e aspas trocadas', () => {
  const m = E.montarEtiquetaTexto({ texto: 'Atenção: "frágil" ½' }, cfg, textoOp);
  assert.ok(m.tspl.includes(`"Atencao: 'fragil' 1/2"`));
});

test('a página carrega os scripts por <script> clássico (funciona aberta do disco)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!/type=["']module["']/.test(html), 'módulo ES não carrega por file://');
  for (const s of ['src/etiqueta.js', 'src/impressora.js', 'src/app.js']) assert.ok(html.includes(s));
  assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'nenhum recurso externo');
});
