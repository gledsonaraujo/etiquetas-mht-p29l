// Envio de bytes crus à impressora térmica pela Web Serial API (navegador).
//
// A impressora é um dispositivo LOCAL (porta COM via USB-serial ou Bluetooth SPP). O único
// caminho de uma página web até ela é a Web Serial API, que escreve bytes direto na porta,
// sem driver de impressora e sem spooler — exatamente o que o TSPL pede: um driver GDI no
// meio rasterizaria e destruiria os comandos.
//
// Suporte: Chrome e Edge de COMPUTADOR, em página https ou aberta do disco. Safari, Firefox
// e celular NÃO implementam a API — a página detecta e diz isso, em vez de um botão morto.
//
// TODO `await` DESTE ARQUIVO TEM PRAZO, e isso não é zelo (defeito real visto na primeira
// impressão com a P29L): o pareamento Bluetooth cria DUAS portas COM, e a de ENTRADA
// (Incoming) aceita `open()` e aceita `write()` — que simplesmente NUNCA resolve, sem erro
// nenhum. O mesmo vale para a impressora desligada ou dormindo. Sem prazo, o botão ficaria
// em "Imprimindo..." para sempre.
//
// ENVIO EM BLOCOS: o buffer de entrada da P29L é de ~1,5 KB — despejar tudo de uma vez
// TRUNCA a impressão sem erro nenhum. 512 bytes por bloco, com respiro.
//
// A primeira escrita numa porta Bluetooth pode levar de 3 a 10 segundos: o rádio só
// conecta quando algo abre a porta. Os prazos abaixo contam com isso.
(function (raiz) {
  'use strict';

  const serialDoNavegador = () =>
    (typeof navigator !== 'undefined' && navigator.serial) ? navigator.serial : null;

  /** Este navegador consegue falar com uma porta serial? */
  function disponivel() {
    return serialDoNavegador() !== null;
  }

  const MSG_SEM_WEB_SERIAL =
    'Este navegador não alcança a porta da impressora. Use o Chrome ou o Edge num computador '
    + '— a impressão térmica fala direto com a porta serial (USB ou Bluetooth), e só eles têm essa ponte.';

  /**
   * NO BLUETOOTH, O CAMINHO CERTO É A ENTRADA COM O NOME DA IMPRESSORA, NÃO A PORTA COM
   * (provado na MHT-P29L real): o Chrome lista a impressora pelo nome ("MHT-P29L: pareado",
   * RFCOMM direto) e pelas portas COM virtuais do Windows. A COM de SAÍDA não abria; a
   * entrada pelo nome imprimiu na primeira. A de Entrada nunca serve.
   */
  const MSG_ESCOLHA_DA_PORTA =
    'Na primeira impressão o navegador pede a porta. No Bluetooth, escolha a opção com o '
    + 'NOME da impressora (ex.: "MHT-P29L: pareado"). Só se ela não aparecer, use a porta COM '
    + 'de SAÍDA (Outgoing — veja em Configurações do Windows → Bluetooth → Mais configurações '
    + '→ aba Portas COM). No cabo USB, escolha a porta USB-serial.';

  const MSG_FALHA_CONEXAO =
    'A impressora não respondeu. Confira, nesta ordem: ela está LIGADA e acordada (aperte o '
    + 'botão de avanço de papel)? Ela não está conectada a OUTRO aparelho (celular, app do '
    + 'fabricante)? O Bluetooth deste computador está ligado? No Bluetooth, a porta escolhida é a '
    + 'que tem o NOME da impressora? Para escolher outra porta, use "Trocar impressora".';

  /** A frase da porta que o navegador RECUSOU abrir (rejeição imediata, não prazo). */
  function mensagemFalhaAbertura(err) {
    const tecnico = err instanceof Error
      ? [err.name, err.message].filter((t) => t && t !== 'Error').join(': ')
      : '';
    return 'Não foi possível conectar à impressora. Confira, nesta ordem: '
      + '(1) ela não está conectada a OUTRO aparelho — a impressora Bluetooth aceita um por '
      + 'vez; desligue o Bluetooth do celular ou feche o app do fabricante; '
      + '(2) ela está ligada e acordada — aperte o botão de avanço de papel; '
      + '(3) nenhuma outra aba ou programa está usando a porta; '
      + '(4) no Bluetooth, a porta escolhida é a que tem o NOME da impressora (ex.: '
      + '"MHT-P29L: pareado"), e não uma porta COM — para escolher outra, use "Trocar impressora".'
      + (tecnico ? ' (Detalhe técnico: ' + tecnico + ')' : '');
  }

  /** O SPP ignora o baud rate na prática, mas alguns firmwares exigem um valor válido. */
  const BAUD_RATE = 9600;
  const BLOCO_BYTES = 512;
  const PAUSA_ENTRE_BLOCOS_MS = 30;

  const PRAZO_ABRIR_MS = 15000;
  const PRAZO_PRIMEIRO_BLOCO_MS = 20000;
  const PRAZO_BLOCO_MS = 10000;
  const PRAZO_FECHAR_MS = 3000;

  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

  /** `Promise.race` com relógio: nenhum caminho deste arquivo fica pendurado para sempre. */
  function comPrazo(promessa, ms, mensagem) {
    return new Promise((resolve, reject) => {
      const relogio = setTimeout(() => reject(new Error(mensagem)), ms);
      promessa.then(
        (v) => { clearTimeout(relogio); resolve(v); },
        (e) => { clearTimeout(relogio); reject(e); },
      );
    });
  }

  async function fecharSemLancar(porta) {
    try { await comPrazo(porta.close(), PRAZO_FECHAR_MS, 'prazo no close'); } catch (e) { /* já caiu */ }
  }

  /** Texto TSPL (ASCII) em bytes. O `& 0x7f` é rede: o texto já chega normalizado. */
  function bytesDoTexto(texto) {
    const b = new Uint8Array(texto.length);
    for (let i = 0; i < texto.length; i++) b[i] = texto.charCodeAt(i) & 0x7f;
    return b;
  }

  /**
   * Abre o seletor de portas para o usuário APONTAR a impressora. Só funciona dentro de um
   * clique. A permissão fica gravada no navegador para esta página — nas próximas vezes a
   * porta é usada sem perguntar.
   */
  async function escolher() {
    const serial = serialDoNavegador();
    if (!serial) throw new Error(MSG_SEM_WEB_SERIAL);
    try {
      await serial.requestPort();
    } catch (e) {
      throw new Error('Nenhuma porta foi selecionada.');
    }
  }

  /**
   * Envia uma ou mais etiquetas à impressora, numa conexão só, e fecha a porta.
   *
   * Cada item de `partes` é um fluxo TSPL completo; entre eles espera `pausaMs(i)` — o
   * respiro para a impressora digerir a etiqueta anterior antes de a próxima encher o
   * buffer. Com UMA porta já autorizada, imprime direto; senão abre o seletor — por isso a
   * chamada tem de partir de um clique. `aoProgredir(feitas, total)` é opcional.
   *
   * A promessa SEMPRE resolve ou rejeita dentro dos prazos deste arquivo.
   */
  async function enviar(partes, opcoes) {
    const serial = serialDoNavegador();
    if (!serial) throw new Error(MSG_SEM_WEB_SERIAL);
    const lista = (Array.isArray(partes) ? partes : [partes]).filter((p) => p && p.length);
    if (!lista.length) return;
    const o = opcoes || {};

    const autorizadas = await serial.getPorts();
    let porta = autorizadas.length === 1 ? autorizadas[0] : null;
    if (!porta) {
      try {
        porta = await serial.requestPort();
      } catch (e) {
        throw new Error('Nenhuma porta foi selecionada. ' + MSG_ESCOLHA_DA_PORTA);
      }
    }

    try {
      await comPrazo(porta.open({ baudRate: BAUD_RATE }), PRAZO_ABRIR_MS, MSG_FALHA_CONEXAO);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // "already open": um envio anterior não fechou (abortado por prazo, aba recarregada
      // no meio) — seguir escrevendo é o certo.
      if (!/already open/i.test(msg)) {
        await fecharSemLancar(porta);
        throw new Error(msg === MSG_FALHA_CONEXAO ? MSG_FALHA_CONEXAO : mensagemFalhaAbertura(err));
      }
    }

    if (!porta.writable) {
      await fecharSemLancar(porta);
      throw new Error('A porta abriu mas não aceita escrita — desligue e ligue a impressora e tente de novo.');
    }

    const escritor = porta.writable.getWriter();
    let primeiro = true;
    try {
      for (let p = 0; p < lista.length; p++) {
        const bytes = typeof lista[p] === 'string' ? bytesDoTexto(lista[p]) : lista[p];
        for (let i = 0; i < bytes.length; i += BLOCO_BYTES) {
          const prazo = primeiro ? PRAZO_PRIMEIRO_BLOCO_MS : PRAZO_BLOCO_MS;
          primeiro = false;
          await comPrazo(escritor.write(bytes.slice(i, i + BLOCO_BYTES)), prazo, MSG_FALHA_CONEXAO);
          if (i + BLOCO_BYTES < bytes.length) await pausa(PAUSA_ENTRE_BLOCOS_MS);
        }
        if (o.aoProgredir) o.aoProgredir(p + 1, lista.length);
        if (p + 1 < lista.length && o.pausaMs) await pausa(o.pausaMs(p));
      }
      // Respiro final: fechar na hora pode descartar o que o firmware ainda não digeriu.
      await pausa(150);
      escritor.releaseLock();
      await fecharSemLancar(porta);
    } catch (err) {
      // A escrita travada não se solta sozinha: aborta, libera e fecha — senão a PRÓXIMA
      // tentativa acharia a porta presa.
      try { await comPrazo(escritor.abort(), PRAZO_FECHAR_MS, 'prazo no abort'); } catch (e) { /* já caiu */ }
      try { escritor.releaseLock(); } catch (e) { /* lock já solto */ }
      await fecharSemLancar(porta);
      throw err instanceof Error ? err : new Error(MSG_FALHA_CONEXAO);
    }
  }

  raiz.Impressora = { disponivel, escolher, enviar, MSG_SEM_WEB_SERIAL, MSG_ESCOLHA_DA_PORTA };
})(typeof self !== 'undefined' ? self : this);
