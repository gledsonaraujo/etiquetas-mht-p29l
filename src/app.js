// A tela: formulário, prévia, lista e calibração. Toda a montagem da etiqueta vem de
// `Etiqueta` (src/etiqueta.js) e todo o envio de `Impressora` (src/impressora.js) — esta
// camada só liga os dois ao DOM.
(function () {
  'use strict';

  const E = window.Etiqueta;
  const I = window.Impressora;
  const $ = (id) => document.getElementById(id);

  const CHAVE_CONFIG = 'mht_etiquetas_config';
  const CHAVE_LISTA = 'mht_etiquetas_lista';

  // localStorage pode faltar (janela anônima, armazenamento bloqueado) — a página funciona
  // igual, só não lembra nada na próxima visita.
  const ler = (chave) => {
    try { return JSON.parse(localStorage.getItem(chave) || 'null'); } catch (e) { return null; }
  };
  const gravar = (chave, valor) => {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem memória */ }
  };

  let cfg = E.lerConfig(ler(CHAVE_CONFIG));
  let lista = Array.isArray(ler(CHAVE_LISTA)) ? ler(CHAVE_LISTA) : [];
  let editandoId = null;
  let imprimindo = false;

  const novoId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  // -----------------------------------------------------------------------------------
  // Mensagens
  // -----------------------------------------------------------------------------------

  let relogioMsg = null;
  function mensagem(texto, tipo) {
    const el = $('mensagem');
    el.className = 'alerta alerta-' + (tipo || 'info');
    el.textContent = texto;
    el.hidden = false;
    clearTimeout(relogioMsg);
    if (tipo === 'ok' || tipo === 'info') relogioMsg = setTimeout(() => { el.hidden = true; }, 7000);
  }

  function avisos(alvo, lista_) {
    const el = $(alvo);
    el.replaceChildren();
    for (const a of lista_) {
      const d = document.createElement('div');
      d.className = 'alerta alerta-aviso';
      d.textContent = '⚠️ ' + a;
      el.appendChild(d);
    }
  }

  // -----------------------------------------------------------------------------------
  // Formulário do produto
  // -----------------------------------------------------------------------------------

  function itemDoFormulario() {
    const copias = Math.trunc(Number($('f-copias').value) || 1);
    return {
      nome: $('f-nome').value.trim(),
      sku: $('f-sku').value.trim(),
      codigo_barras: $('f-codigo').value.trim(),
      preco_venda: E.numeroBR($('f-preco').value),
      copias: Math.min(100, Math.max(1, copias)),
      incluirCodigo: $('f-incluir-codigo').checked,
      incluirPreco: $('f-incluir-preco').checked,
    };
  }

  function preencherFormulario(item) {
    $('f-nome').value = item.nome || '';
    $('f-sku').value = item.sku || '';
    $('f-codigo').value = item.codigo_barras || '';
    $('f-preco').value = item.preco_venda != null ? String(item.preco_venda).replace('.', ',') : '';
    $('f-copias').value = item.copias || 1;
    $('f-incluir-codigo').checked = item.incluirCodigo !== false;
    $('f-incluir-preco').checked = item.incluirPreco !== false;
  }

  const montar = (item) => E.montarEtiquetaProduto(item, cfg, {
    copias: item.copias || 1,
    incluirCodigo: item.incluirCodigo !== false,
    incluirPreco: item.incluirPreco !== false,
  });

  // -----------------------------------------------------------------------------------
  // Prévia — desenha os ELEMENTOS que a montagem devolveu, em dots, com papel branco
  // -----------------------------------------------------------------------------------

  const ESCALA = 2;
  function desenhar(montada) {
    const canvas = $('previa');
    const W = E.mmParaDots(cfg.largura_mm);
    const H = E.mmParaDots(cfg.altura_mm);
    canvas.width = W * ESCALA;
    canvas.height = H * ESCALA;
    canvas.style.aspectRatio = W + ' / ' + H;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ESCALA, 0, 0, ESCALA, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Área útil (margem), tracejada.
    const m = E.mmParaDots(cfg.margem_mm);
    ctx.strokeStyle = '#c9cede';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1;
    ctx.strokeRect(m + 0.5, m + 0.5, W - 2 * m - 1, H - 2 * m - 1);
    ctx.setLineDash([]);

    ctx.fillStyle = '#111111';
    // A fonte da tela é esticada para ter EXATAMENTE a largura medida da fonte da
    // impressora — assim o texto que estoura a etiqueta também estoura aqui.
    const tamanho = Math.round(cfg.fonte_altura_dots * 0.62);
    ctx.font = '600 ' + tamanho + 'px ui-monospace, Consolas, "Courier New", monospace';
    ctx.textBaseline = 'top';
    const larguraTela = ctx.measureText('0').width || 1;
    const sx = cfg.fonte_largura_dots / larguraTela;

    for (const el of montada.elementos) {
      if (el.tipo === 'texto') {
        ctx.save();
        ctx.translate(el.x, el.y + Math.max(0, (cfg.fonte_altura_dots - tamanho) / 2));
        ctx.scale(sx, 1);
        ctx.fillText(el.texto, 0, 0);
        ctx.restore();
      } else if (el.tipo === 'barras') {
        let x = el.x;
        E.modulosCode128(el.dado).forEach((largura, i) => {
          const w = largura * el.estreita;
          if (i % 2 === 0) ctx.fillRect(x, el.y, w, el.altura);
          x += w;
        });
      }
    }
  }

  function atualizarPrevia() {
    const item = itemDoFormulario();
    // Formulário vazio mostra um EXEMPLO, dito como exemplo — senão a prévia abriria em
    // branco e com um aviso de "sem código" sobre um produto que ninguém digitou.
    const vazio = !item.nome && !item.sku && !item.codigo_barras;
    const montada = montar(vazio
      ? Object.assign({}, item, { nome: 'Nome do produto', sku: 'GW-0001', preco_venda: 45.9 })
      : item);
    desenhar(montada);
    $('tspl').textContent = montada.tspl;
    $('previa-info').textContent = (vazio ? 'Exemplo · ' : '') + cfg.largura_mm + ' × ' + cfg.altura_mm + ' mm · '
      + E.caracteresPorLinha(cfg) + ' caracteres por linha'
      + (montada.codigo ? ' · código "' + montada.codigo + '" (as barras na tela são aproximadas; quem as gera é a impressora)' : '');
    avisos('previa-avisos', montada.avisos);
    return montada;
  }

  // -----------------------------------------------------------------------------------
  // Lista
  // -----------------------------------------------------------------------------------

  function salvarLista() { gravar(CHAVE_LISTA, lista); }

  function botao(rotulo, titulo, aoClicar) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sec btn-icone';
    b.textContent = rotulo;
    b.title = titulo;
    b.setAttribute('aria-label', titulo);
    b.addEventListener('click', aoClicar);
    return b;
  }

  function desenharLista() {
    const corpo = $('lista-corpo');
    corpo.replaceChildren();
    const total = lista.reduce((s, it) => s + (it.copias || 1), 0);
    $('lista-contador').textContent = lista.length
      ? '— ' + lista.length + (lista.length === 1 ? ' produto, ' : ' produtos, ') + total + (total === 1 ? ' etiqueta' : ' etiquetas')
      : '';
    $('lista-vazia').hidden = lista.length > 0;
    $('btn-imprimir-lista').disabled = !lista.length || imprimindo || !I.disponivel();
    $('btn-limpar-lista').disabled = !lista.length;

    for (const it of lista) {
      const tr = document.createElement('tr');
      if (it.id === editandoId) tr.className = 'selecionada';
      const celula = (texto, classe) => {
        const td = document.createElement('td');
        if (classe) td.className = classe;
        td.textContent = texto;
        tr.appendChild(td);
      };
      celula(it.nome);
      celula(it.sku || '—');
      celula(it.codigo_barras || (it.sku ? '(SKU)' : '—'));
      celula(it.preco_venda != null && it.preco_venda > 0 ? E.moedaImpressao(it.preco_venda) : '—', 'num');

      const tdCopias = document.createElement('td');
      tdCopias.className = 'num';
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = '1'; inp.max = '100'; inp.value = it.copias || 1;
      inp.setAttribute('aria-label', 'Cópias de ' + it.nome);
      inp.addEventListener('change', () => {
        it.copias = Math.min(100, Math.max(1, Math.trunc(Number(inp.value) || 1)));
        inp.value = it.copias;
        salvarLista(); desenharLista();
      });
      tdCopias.appendChild(inp);
      tr.appendChild(tdCopias);

      const tdAcoes = document.createElement('td');
      tdAcoes.className = 'acoes-col';
      tdAcoes.append(
        botao('✏️', 'Editar ' + it.nome, () => {
          editandoId = it.id;
          preencherFormulario(it);
          $('btn-adicionar').textContent = '💾 Salvar na lista';
          atualizarPrevia(); desenharLista();
          $('f-nome').focus();
        }),
        botao('🖨️', 'Imprimir só ' + it.nome, () => imprimir([it])),
        botao('🗑️', 'Remover ' + it.nome, () => {
          lista = lista.filter((x) => x.id !== it.id);
          if (editandoId === it.id) sairDaEdicao();
          salvarLista(); desenharLista();
        }),
      );
      tr.appendChild(tdAcoes);
      corpo.appendChild(tr);
    }
  }

  function sairDaEdicao() {
    editandoId = null;
    $('btn-adicionar').textContent = '➕ Adicionar à lista';
  }

  function adicionarOuSalvar() {
    const item = itemDoFormulario();
    if (!item.nome) { mensagem('Preencha o nome do produto.', 'erro'); $('f-nome').focus(); return; }
    if (editandoId) {
      lista = lista.map((x) => (x.id === editandoId ? Object.assign({ id: x.id }, item) : x));
      mensagem('Etiqueta atualizada na lista.', 'ok');
      sairDaEdicao();
    } else {
      lista.push(Object.assign({ id: novoId() }, item));
      mensagem('"' + item.nome + '" entrou na lista.', 'ok');
    }
    salvarLista(); desenharLista();
  }

  // -----------------------------------------------------------------------------------
  // Impressão
  // -----------------------------------------------------------------------------------

  function marcarImprimindo(sim) {
    imprimindo = sim;
    $('btn-imprimir').disabled = sim || !I.disponivel();
    $('btn-imprimir').textContent = sim ? 'Imprimindo...' : '🖨️ Imprimir';
    document.querySelectorAll('[data-calibrar]').forEach((b) => { b.disabled = sim || !I.disponivel(); });
    desenharLista();
  }

  async function enviar(partes, pausas, sucesso) {
    if (imprimindo) return;
    marcarImprimindo(true);
    try {
      await I.enviar(partes, {
        pausaMs: (i) => pausas[i] || 0,
        aoProgredir: (feitas, total) => {
          if (total > 1) mensagem('Enviando ' + feitas + ' de ' + total + '...', 'info');
        },
      });
      mensagem(sucesso, 'ok');
    } catch (err) {
      mensagem(err instanceof Error ? err.message : 'Falha ao imprimir.', 'erro');
    } finally {
      marcarImprimindo(false);
    }
  }

  function imprimir(itens) {
    const partes = [];
    const pausas = [];
    let comAviso = 0;
    let total = 0;
    for (const it of itens) {
      const m = montar(it);
      if (m.avisos.length) comAviso++;
      partes.push(m.tspl);
      pausas.push(cfg.pausa_por_etiqueta_ms * (it.copias || 1));
      total += it.copias || 1;
    }
    const texto = (total === 1 ? 'Etiqueta enviada' : total + ' etiquetas enviadas') + ' à impressora.'
      + (comAviso ? ' ' + comAviso + (comAviso === 1 ? ' produto saiu' : ' produtos saíram') + ' com aviso — confira a prévia.' : '');
    return enviar(partes, pausas, texto);
  }

  // -----------------------------------------------------------------------------------
  // Configuração
  // -----------------------------------------------------------------------------------

  const CAMPOS_CFG = {
    'cfg-geometria': [
      { k: 'largura_mm', r: 'Largura (mm)', passo: 0.5 },
      { k: 'altura_mm', r: 'Altura (mm)', passo: 0.5 },
      { k: 'gap_mm', r: 'Gap (mm)', passo: 0.5, d: 'Espaço entre etiquetas.' },
      { k: 'offset_x_mm', r: 'Offset X (mm)', passo: 0.5, d: 'Meça com a régua ou a moldura.' },
      { k: 'margem_mm', r: 'Margem (mm)', passo: 0.5 },
    ],
    'cfg-impressao': [
      { k: 'densidade', r: 'Densidade (0–15)', passo: 1, d: 'Código que não lê pede MENOS.' },
      { k: 'velocidade', r: 'Velocidade (1–8)', passo: 1, d: 'Mais devagar = mais nítido.' },
      { k: 'direcao', r: 'Direção', opcoes: [['1', '1 (padrão)'], ['0', '0 (invertida)']], d: 'Saiu de cabeça para baixo? Troque.' },
      { k: 'pausa_por_etiqueta_ms', r: 'Pausa por etiqueta (ms)', passo: 100, d: 'Respiro entre etiquetas da lista.' },
    ],
    'cfg-fonte': [
      { k: 'fonte', r: 'Fonte TSPL', opcoes: ['1', '2', '3', '4', '5', '6', '7', '8'].map((f) => [f, f === '2' ? '2 (confiável na P29L)' : f]) },
      { k: 'fonte_largura_dots', r: 'Largura do caractere (dots)', passo: 1 },
      { k: 'fonte_altura_dots', r: 'Altura do caractere (dots)', passo: 1 },
      { k: 'entrelinha_dots', r: 'Entrelinha (dots)', passo: 1 },
    ],
  };

  function montarCamposConfig() {
    for (const grupo of Object.keys(CAMPOS_CFG)) {
      const alvo = $(grupo);
      alvo.replaceChildren();
      for (const c of CAMPOS_CFG[grupo]) {
        const div = document.createElement('div');
        div.className = 'campo';
        const id = 'cfg-' + c.k;
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = c.r;
        let campo;
        if (c.opcoes) {
          campo = document.createElement('select');
          for (const [v, t] of c.opcoes) {
            const o = document.createElement('option');
            o.value = v; o.textContent = t;
            campo.appendChild(o);
          }
        } else {
          campo = document.createElement('input');
          campo.type = 'number';
          campo.step = String(c.passo);
          campo.inputMode = 'decimal';
        }
        campo.id = id;
        campo.dataset.chave = c.k;
        campo.value = String(cfg[c.k]);
        // Enquanto digita, só recalcula; ao sair do campo, mostra o valor já ajustado aos
        // limites — reescrever durante a digitação brigaria com quem digita "100".
        campo.addEventListener('input', () => aplicarCampo(campo, false));
        campo.addEventListener('change', () => aplicarCampo(campo, true));
        div.append(label, campo);
        if (c.d) {
          const s = document.createElement('small');
          s.textContent = c.d;
          div.appendChild(s);
        }
        alvo.appendChild(div);
      }
    }
  }

  function aplicarCampo(campo, reescrever) {
    const bruto = Object.assign({}, cfg);
    bruto[campo.dataset.chave] = campo.value.replace(',', '.');
    cfg = E.lerConfig(bruto);
    gravar(CHAVE_CONFIG, cfg);
    if (reescrever) campo.value = String(cfg[campo.dataset.chave]);
    atualizarPrevia();
  }

  function recarregarCamposConfig() {
    document.querySelectorAll('[data-chave]').forEach((c) => { c.value = String(cfg[c.dataset.chave]); });
  }

  function baixar(nome, conteudo, tipo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // -----------------------------------------------------------------------------------
  // Ligações
  // -----------------------------------------------------------------------------------

  function iniciar() {
    const ok = I.disponivel();
    const selo = $('estado-serial');
    selo.textContent = ok ? 'Porta serial disponível' : 'Sem porta serial neste navegador';
    selo.className = 'selo ' + (ok ? 'selo-ok' : 'selo-nao');
    if (!ok) {
      $('aviso-serial').textContent = '🖨️ ' + I.MSG_SEM_WEB_SERIAL;
      $('aviso-serial').hidden = false;
    }
    $('btn-trocar').disabled = !ok;
    $('ajuda-porta').textContent = I.MSG_ESCOLHA_DA_PORTA;

    ['f-nome', 'f-sku', 'f-codigo', 'f-preco', 'f-copias', 'f-incluir-codigo', 'f-incluir-preco']
      .forEach((id) => $(id).addEventListener('input', atualizarPrevia));

    $('form-produto').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const item = itemDoFormulario();
      if (!item.nome) { mensagem('Preencha o nome do produto.', 'erro'); $('f-nome').focus(); return; }
      imprimir([item]);
    });
    $('btn-adicionar').addEventListener('click', adicionarOuSalvar);
    $('btn-limpar-form').addEventListener('click', () => {
      preencherFormulario({ copias: 1 });
      sairDaEdicao();
      atualizarPrevia(); desenharLista();
    });

    $('btn-trocar').addEventListener('click', async () => {
      try {
        await I.escolher();
        mensagem('Impressora selecionada. O próximo envio usa a porta escolhida.', 'ok');
      } catch (err) {
        mensagem(err instanceof Error ? err.message : 'Nenhuma porta foi selecionada.', 'info');
      }
    });

    $('btn-copiar-tspl').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('tspl').textContent);
        mensagem('Comandos TSPL copiados.', 'ok');
      } catch (e) {
        mensagem('O navegador não deixou copiar — selecione o texto e use Ctrl+C.', 'aviso');
      }
    });

    // Lista
    $('btn-imprimir-lista').addEventListener('click', () => imprimir(lista));
    $('btn-limpar-lista').addEventListener('click', () => {
      if (!confirm('Esvaziar a lista de etiquetas?')) return;
      lista = [];
      sairDaEdicao();
      salvarLista(); desenharLista();
    });
    $('btn-modelo').addEventListener('click', () => {
      baixar('modelo-etiquetas.csv',
        '﻿Nome;SKU;Código de barras;Preço de venda;Cópias\r\n'
        + 'Filtro de óleo;GW-0001;7891234567895;45,90;2\r\n'
        + 'Mangueira 1/4 x 1m;GW-0002;;12,50;1\r\n',
        'text/csv;charset=utf-8');
    });
    $('arquivo-csv').addEventListener('change', async (ev) => {
      const arq = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!arq) return;
      const texto = await arq.text();
      const r = E.itensDoCsv(texto);
      const opcoes = { incluirCodigo: $('f-incluir-codigo').checked, incluirPreco: $('f-incluir-preco').checked };
      for (const it of r.itens) lista.push(Object.assign({ id: novoId() }, it, opcoes));
      salvarLista(); desenharLista();
      avisos('lista-avisos', r.erros);
      if (r.itens.length) mensagem(r.itens.length + (r.itens.length === 1 ? ' produto importado' : ' produtos importados') + ' de "' + arq.name + '".', 'ok');
      else mensagem('Nenhum produto importado de "' + arq.name + '".', 'erro');
    });

    // Configuração
    montarCamposConfig();
    $('btn-cfg-padrao').addEventListener('click', () => {
      cfg = E.lerConfig(null);
      gravar(CHAVE_CONFIG, cfg);
      recarregarCamposConfig();
      atualizarPrevia();
      mensagem('Configuração padrão restaurada.', 'ok');
    });
    $('btn-cfg-exportar').addEventListener('click', () => {
      baixar('config-etiqueta-mht-p29l.json', JSON.stringify(cfg, null, 2) + '\n', 'application/json');
    });
    $('arquivo-cfg').addEventListener('change', async (ev) => {
      const arq = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!arq) return;
      try {
        cfg = E.lerConfig(JSON.parse(await arq.text()));
        gravar(CHAVE_CONFIG, cfg);
        recarregarCamposConfig();
        atualizarPrevia();
        mensagem('Configuração importada.', 'ok');
      } catch (e) {
        mensagem('O arquivo não é uma configuração válida (JSON).', 'erro');
      }
    });

    const CALIBRACAO = {
      gap: [() => E.montarGapDetect(cfg), 'Detecção de gap enviada — a impressora vai avançar algumas etiquetas.'],
      regua: [() => E.montarRegua(cfg), 'Régua enviada. O menor número visível é o offset X.'],
      moldura: [() => E.montarMoldura(cfg), 'Moldura enviada. Ela deve sair inteira, com folga igual dos dois lados.'],
      fontes: [() => E.montarAmostraFontes(cfg), 'Amostra de fontes enviada.'],
      teste: [() => E.montarEtiquetaTeste(cfg), 'Etiqueta de teste enviada.'],
    };
    document.querySelectorAll('[data-calibrar]').forEach((b) => {
      b.addEventListener('click', () => {
        const [gerar, texto] = CALIBRACAO[b.dataset.calibrar];
        enviar([gerar()], [0], texto);
      });
    });

    marcarImprimindo(false);
    atualizarPrevia();
  }

  iniciar();
})();
