'use strict';
/*
 * exporta.js — "Baixar Excel" e "Baixar PDF": o analítico por tratativa, para conferir os números do painel.
 *
 * Lê data/analitico.json (uma linha por tratativa; sem matrícula, nome de cliente ou de colaborador) e monta os
 * arquivos no próprio navegador. O resumo mês a mês é recalculado a partir das linhas do analítico e conferido com
 * o que o painel mostra: no Excel por fórmulas, no PDF pelos mesmos números.
 */
(function (global) {
  const BRL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const INT = new Intl.NumberFormat('pt-BR');
  const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });
  const CODE = { Incremento: 'INC', 'Incremento e troca de categoria': 'INC+TROCA', 'Troca de categoria': 'TROCA', Decremento: 'DEC', 'Alteração de economia': 'ECO' };

  const reais = (cents) => cents / 100;
  const money = (cents) => BRL.format(cents / 100);
  const upper = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const monthLabel = (month) => `${upper(MONTH.format(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1, 1))))}/${month.slice(0, 4)}`;
  const dateBr = (iso) => iso.slice(0, 10).split('-').reverse().join('/');
  const dateTimeBr = (iso) => `${dateBr(iso)} ${iso.slice(11, 16)}`;
  const stamp = (date) => `${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  // ---------------------------------------------------------------- modelo
  /**
   * Recalcula, a partir das linhas do analítico, o que o painel mostra por mês e compara com `panel`
   * (as linhas que o painel exibe, do mais novo para o mais antigo: month, inc, incCat, cat, increments, swaps, netCents).
   */
  function buildModel(feed, panel, detail) {
    const rows = detail.rows.map((row) => Object.fromEntries(detail.columns.map((name, i) => [name, row[i]])));
    const months = panel.map((shown) => {
      const mine = rows.filter((row) => row.date.slice(0, 7) === shown.month);
      const sum = (fn) => mine.reduce((total, row) => total + fn(row), 0);
      const count = (...names) => mine.filter((row) => names.includes(row.class)).length;
      const gain = sum((row) => row.gainCents * row.factor);
      const loss = sum((row) => row.lossCents * row.factor);
      const left = 12 - Number(shown.month.slice(5, 7));
      const item = {
        month: shown.month, key: Number(shown.month.replace('-', '')), label: monthLabel(shown.month), left, gain, loss,
        net: gain + loss, until: (gain + loss) * left,
        inc: count('Incremento'), incCat: count('Incremento e troca de categoria'), cat: count('Troca de categoria'),
        increments: count('Incremento', 'Incremento e troca de categoria'),
        swaps: count('Troca de categoria', 'Incremento e troca de categoria'),
        newEconomies: sum((row) => row.newEconomies), removed: sum((row) => row.removed), shown,
      };
      item.ok = item.net === shown.netCents && item.inc === shown.inc && item.incCat === shown.incCat && item.cat === shown.cat &&
        item.increments === shown.increments && item.swaps === shown.swaps;
      return item;
    });
    const total = (key) => months.reduce((acc, item) => acc + item[key], 0);
    const totals = Object.fromEntries(['inc', 'incCat', 'cat', 'increments', 'swaps', 'newEconomies', 'removed', 'gain', 'loss', 'net', 'until'].map((key) => [key, total(key)]));
    totals.shownNet = months.reduce((acc, item) => acc + item.shown.netCents, 0);
    totals.ok = months.every((item) => item.ok);
    const pending = rows.filter((row) => row.note.startsWith('PENDENTE')).length;
    const repeatedRows = rows.filter((row) => row.repeat).length;
    const last = feed.source.lastDate;
    return {
      rows, months, totals, pending, repeatedRows, last, lastBr: dateBr(last),
      // `months` vem do mais novo para o mais antigo
      first: months.at(-1).label, final: months[0].label, generated: stamp(new Date()),
      repeatedGroups: detail.repeatedGroups || 0, copies: detail.identicalCopies || 0,
    };
  }

  /** Textos explicativos, os mesmos no Excel e no PDF. */
  function explanation(feed, model, billing) {
    const tariffs = Object.entries(feed.tariffsCents).map(([name, cents]) => `${name}: R$ ${money(cents)}`).join(' · ');
    return [
      { heading: 'Fonte', lines: [
        `Frente de serviço Cadastro, ${model.first} a ${model.final}, base até ${model.lastBr}. Os formulários de janeiro e fevereiro não tinham os campos de valor.`,
        `Linhas lidas na planilha: ${INT.format(feed.source.tratativas)} (todas as frentes e meses). Neste analítico: ${INT.format(model.rows.length)} tratativas, as que contam como incremento ou categoria, têm valor ou ficaram pendentes.`,
        `Este arquivo não traz matrícula, nome de cliente nem de colaborador. Para localizar uma tratativa no formulário ou no Power BI, use o Id e a data/hora.`,
      ] },
      { heading: 'Como o valor é calculado', lines: [
        'Valor no mês = ganhos − perdas. Na troca de categoria vale a tarifa nova menos a tarifa anterior, nunca a tarifa cheia. Ex.: Social (R$ 30,12) para Residencial (R$ 85,41) = R$ 55,29.',
        'A triagem é feita no fim do mês, então a primeira fatura cheia é a do mês seguinte. Até dezembro = valor no mês × meses restantes do ano.',
        'As contagens são as do painel Cadastro e Venda e contam tratativas: Incremento (só incremento de economia, sem troca de categoria); Incremento e troca de categoria (o mesmo retorno traz economia e categoria); Troca de categoria (só troca de categoria); Total de incremento = incremento + incremento e troca de categoria; Total de troca de categoria = troca de categoria + incremento e troca de categoria. A tratativa de incremento e troca de categoria entra nos dois totais.',
        'Decremento e alteração de economia sem marcação não entram nessas contagens, mas o valor delas (perdas ou ganhos) entra no valor do mês.',
        'O valor vale pelo número digitado (DE:/PARA:, ANTERIOR/ATUAL × QUANTIDADE), não pela marcação Incremento/Decremento do formulário; a classe (contagens) segue o tipo de ordem e a marcação. CADÚNICO = Social; entidade sem fins lucrativos = Pública; Comércio popular tem tarifa própria.',
        'Quantidade escrita em texto é lida pela convenção do formulário (quantidade = economias que ficaram na categoria ATUAL); sem como seguir a convenção, o texto é lido como antes → depois. A coluna Observação marca essas linhas.',
        `Tarifas por economia/mês: ${tariffs}.`,
        billing,
        'O valor é potencial de faturamento recorrente, não arrecadação comprovada nem conferência de faturas emitidas.',
      ] },
      { heading: 'Pontos para conferir', lines: [
        `Pendências fora dos valores: ${model.pending} (coluna Observação começa com PENDENTE).`,
        `Possíveis repetições: ${model.repeatedGroups} grupos, ${model.repeatedRows} linhas (coluna Repetição): mesma ligação, mesmo mês e mesmo efeito. Foram somadas; confira se são pedidos distintos.`,
        `Linhas idênticas (mesmo Id e mesmo conteúdo) contadas uma vez: ${model.copies}.`,
      ] },
    ];
  }

  const readable = (row) => {
    const parts = [];
    if (row.de || row.para) parts.push(`DE: ${row.de || '-'} | PARA: ${row.para || '-'}`);
    if (row.previous || row.current || row.quantity) parts.push(`ANT: ${row.previous || '-'} | ATUAL: ${row.current || '-'} | QTD: ${row.quantity || '-'}`);
    return parts.join(' / ') || '(sem categorias ou quantidades preenchidas)';
  };
  const rowValue = (row) => (row.gainCents + row.lossCents) * row.factor;
  const fileName = (model, extension) => `tratativas-analitico-${model.last}.${extension}`;

  // ---------------------------------------------------------------- Excel
  const COLUMNS = [
    ['Id', 9], ['Mês (AAAAMM)', 10], ['Data e hora', 17], ['Classe', 24], ['Tipo de ordem de serviço', 34], ['Marcação no Forms', 12],
    ['DE:', 18], ['PARA:', 18], ['ANTERIOR', 14], ['ATUAL', 14], ['QUANTIDADE', 14], ['Como foi lido', 36],
    ['Novas economias', 10], ['Economias retiradas', 10], ['Trocas que aumentam a tarifa', 12], ['Trocas que reduzem a tarifa', 12],
    ['Ganho (R$)', 13], ['Perda (R$)', 13], ['Fator (2 = água e esgoto)', 10], ['Valor no mês (R$)', 14],
    ['Cidade', 16], ['Repetição', 10], ['Observação', 60],
  ];

  function excelSheets(feed, model, billing) {
    const X = global.TratativasXlsx;
    const S = X.STYLE;
    const header = (text) => ({ v: text, s: S.HEADER });
    const last = model.rows.length + 1;
    const range = (letter) => `'Analítico'!$${letter}$2:$${letter}$${last}`;

    // ---- Analítico
    const detailRows = [COLUMNS.map(([title]) => header(title))];
    model.rows.forEach((row, i) => {
      const n = i + 2;
      detailRows.push([
        row.id, Number(row.date.slice(0, 7).replace('-', '')), { v: X.serial(row.date), s: S.DATETIME }, row.class, row.order, row.flag,
        row.de, row.para, row.previous, row.current, row.quantity, row.read,
        row.newEconomies, row.removed, row.swapsUp, row.swapsDown,
        { v: reais(row.gainCents), s: S.MONEY }, { v: reais(row.lossCents), s: S.MONEY }, row.factor,
        { v: reais(rowValue(row)), f: `ROUND((Q${n}+R${n})*S${n},2)`, s: S.MONEY },
        row.city, row.repeat, row.note,
      ]);
    });
    const detailSheet = {
      name: 'Analítico', widths: COLUMNS.map(([, width]) => width), rows: detailRows, freezeRows: 1, freezeCols: 1,
      filter: `A1:${X.letter(COLUMNS.length - 1)}${last}`,
    };

    // ---- Resumo (fórmulas sobre o Analítico), do mês mais novo para o mais antigo
    const heads = ['Mês', 'AAAAMM', 'Incremento', 'Incremento e troca de categoria', 'Troca de categoria', 'Total de incremento',
      'Total de troca de categoria', 'Novas economias', 'Economias retiradas', 'Ganhos (R$)', 'Perdas (R$)', 'Valor no mês (R$)',
      'Meses até dezembro', 'Até dezembro (R$)', 'Painel: valor no mês (R$)', 'Painel: total de incremento',
      'Painel: total de troca de categoria', 'Confere com o painel'];
    const rows = [
      [{ v: 'Tratativas Comerciais — Cadastro', s: S.TITLE }],
      [`Analítico para conferência · ${model.first} a ${model.final} · base até ${model.lastBr} · gerado em ${model.generated}`],
      ['Os números desta aba são fórmulas sobre a aba Analítico. As colunas "Painel" mostram o que o painel exibe, para conferir. Meses do mais novo para o mais antigo.'],
      [],
      heads.map(header),
    ];
    const first = rows.length + 1;
    model.months.forEach((item, i) => {
      const r = first + i;
      const by = (name) => `COUNTIFS(${range('B')},$B${r},${range('D')},"${name}")`;
      rows.push([
        item.label, item.key,
        { v: item.inc, f: by('Incremento'), s: S.INT },                                                     // C
        { v: item.incCat, f: by('Incremento e troca de categoria'), s: S.INT },                             // D
        { v: item.cat, f: by('Troca de categoria'), s: S.INT },                                             // E
        { v: item.increments, f: `C${r}+D${r}`, s: S.INT },                                                 // F
        { v: item.swaps, f: `E${r}+D${r}`, s: S.INT },                                                      // G
        { v: item.newEconomies, f: `SUMIFS(${range('M')},${range('B')},$B${r})`, s: S.INT },                // H
        { v: item.removed, f: `SUMIFS(${range('N')},${range('B')},$B${r})`, s: S.INT },                     // I
        { v: reais(item.gain), f: `ROUND(SUMPRODUCT((${range('B')}=$B${r})*${range('Q')}*${range('S')}),2)`, s: S.MONEY }, // J
        { v: reais(item.loss), f: `ROUND(SUMPRODUCT((${range('B')}=$B${r})*${range('R')}*${range('S')}),2)`, s: S.MONEY }, // K
        { v: reais(item.net), f: `ROUND(J${r}+K${r},2)`, s: S.MONEY },                                      // L
        { v: item.left, f: `12-MOD($B${r},100)`, s: S.INT },                                                // M
        { v: reais(item.until), f: `ROUND(L${r}*M${r},2)`, s: S.MONEY },                                    // N
        { v: reais(item.shown.netCents), s: S.MONEY },                                                      // O
        { v: item.shown.increments, s: S.INT }, { v: item.shown.swaps, s: S.INT },                          // P, Q
        { v: item.ok ? 'OK' : 'DIVERGE', f: `IF(AND(ROUND(L${r}-O${r},2)=0,F${r}=P${r},G${r}=Q${r}),"OK","DIVERGE")` }, // R
      ]);
    });
    const end = first + model.months.length - 1;
    const T = model.totals;
    const sum = (letter, value, style) => ({ v: value, f: `SUM(${letter}${first}:${letter}${end})`, s: style });
    rows.push([
      { v: 'Total', s: S.BOLD }, { s: S.BOLD }, sum('C', T.inc, S.BOLD_INT), sum('D', T.incCat, S.BOLD_INT), sum('E', T.cat, S.BOLD_INT),
      sum('F', T.increments, S.BOLD_INT), sum('G', T.swaps, S.BOLD_INT), sum('H', T.newEconomies, S.BOLD_INT),
      sum('I', T.removed, S.BOLD_INT), sum('J', reais(T.gain), S.BOLD_MONEY), sum('K', reais(T.loss), S.BOLD_MONEY),
      sum('L', reais(T.net), S.BOLD_MONEY), { s: S.BOLD }, sum('N', reais(T.until), S.BOLD_MONEY),
      sum('O', reais(T.shownNet), S.BOLD_MONEY), sum('P', T.increments, S.BOLD_INT), sum('Q', T.swaps, S.BOLD_INT),
      { v: T.ok ? 'OK' : 'DIVERGE', f: `IF(COUNTIF(R${first}:R${end},"OK")=ROWS(R${first}:R${end}),"OK","DIVERGE")`, s: S.BOLD },
    ]);
    rows.push([], [
      { v: 'Soma direta da coluna "Valor no mês" do Analítico (R$)', s: S.BOLD }, ...Array(10).fill(null),
      { v: reais(T.net), f: `ROUND(SUM(${range('T')}),2)`, s: S.BOLD_MONEY },
    ]);
    const summarySheet = { name: 'Resumo', widths: [14, 9, 11, 14, 11, 12, 14, 12, 12, 14, 14, 16, 10, 16, 16, 14, 16, 14], rows };

    // ---- Regras e fonte
    const text = [[{ v: 'Regras de cálculo e fonte dos dados', s: S.TITLE }], []];
    for (const section of explanation(feed, model, billing)) {
      text.push([{ v: section.heading, s: S.SECTION }]);
      for (const line of section.lines) text.push([{ v: line, s: S.WRAP }]);
      text.push([]);
    }
    text.push([{ v: 'Colunas do Analítico', s: S.SECTION }]);
    for (const line of [
      'Id e Data e hora: identificam a linha no formulário (ordem do mais novo para o mais antigo). Classe: Incremento, Incremento e troca de categoria ou Troca de categoria (contam nas colunas do Resumo, como no painel Cadastro e Venda); Decremento e Alteração de economia só entram no valor.',
      'Tipo de ordem, Marcação, DE:, PARA:, ANTERIOR, ATUAL, QUANTIDADE: como foram digitados. Como foi lido: o que o cálculo entendeu (+ economias novas, − retiradas, N× troca de categoria).',
      'Ganho e Perda: soma dos efeitos positivos e negativos da tratativa. Fator: 2 quando a ligação fatura água e esgoto (hoje 1: o cruzamento com a base de clientes ainda não foi aplicado). Valor no mês = (Ganho + Perda) × Fator.',
      'Repetição: linhas com o mesmo código (R01, R02...) são da mesma ligação, no mesmo mês, com o mesmo efeito. Observação: leitura especial aplicada ou pendência.',
    ]) text.push([{ v: line, s: S.WRAP }]);
    const rulesSheet = { name: 'Regras e fonte', widths: [150], rows: text };

    return [summarySheet, detailSheet, rulesSheet];
  }

  // ---------------------------------------------------------------- PDF
  function buildPdf(feed, model, billing) {
    const doc = global.TratativasPdf.create({
      title: `Tratativas Comerciais - analítico para conferência (base até ${model.lastBr})`,
      footer: `Tratativas Comerciais · Cadastro · base até ${model.lastBr} · gerado em ${model.generated}`,
      author: 'Tratativas Comerciais',
    });
    doc.title('Tratativas Comerciais — analítico para conferência');
    doc.text(`Cadastro · ${model.first} a ${model.final} · base até ${model.lastBr} · gerado em ${model.generated}`, { size: 9.5, gray: 0.3 });

    doc.heading('Resumo por mês');
    const right = (title, width) => ({ title, width, align: 'right' });
    const body = model.months.map((item) => [
      item.label, INT.format(item.inc), INT.format(item.incCat), INT.format(item.cat), INT.format(item.increments), INT.format(item.swaps),
      INT.format(item.newEconomies), INT.format(item.removed), money(item.gain), money(item.loss), money(item.net),
      String(item.left), money(item.until), money(item.shown.netCents), item.ok ? 'OK' : 'DIVERGE',
    ]);
    const T = model.totals;
    body.push({ bold: true, cells: [
      'Total', INT.format(T.inc), INT.format(T.incCat), INT.format(T.cat), INT.format(T.increments), INT.format(T.swaps),
      INT.format(T.newEconomies), INT.format(T.removed), money(T.gain), money(T.loss), money(T.net),
      '', money(T.until), money(T.shownNet), T.ok ? 'OK' : 'DIVERGE',
    ] });
    doc.table({
      size: 7.5,
      columns: [{ title: 'Mês', width: 13 }, right('Incr.', 6), right('Incr. e troca', 7), right('Troca cat.', 7), right('Total incr.', 7),
        right('Total troca', 7), right('Novas econ.', 6), right('Retir.', 6), right('Ganhos R$', 12), right('Perdas R$', 12),
        right('Valor no mês R$', 13), right('Meses', 5), right('Até dez. R$', 12), right('Painel R$', 12), { title: 'Confere', width: 8 }],
      rows: body,
    });
    doc.paragraph('Incr. = incremento de economia; Incr. e troca = incremento e troca de categoria; Troca cat. = só troca de categoria; Total incr. = Incr. + Incr. e troca; Total troca = Troca cat. + Incr. e troca. Novas econ. e Retir. = quantidade de economias novas e retiradas. Meses do mais novo para o mais antigo.', { size: 7 });
    doc.paragraph(T.ok
      ? 'Conferência: a soma das linhas do analítico fecha com o painel em todos os meses (valor e contagens), diferença de R$ 0,00.'
      : 'ATENÇÃO: a soma das linhas do analítico NÃO fecha com o painel em algum mês (veja a coluna Confere). Não use este arquivo como prova até corrigir.');

    for (const section of explanation(feed, model, billing)) {
      doc.heading(section.heading);
      for (const line of section.lines) doc.paragraph(`• ${line}`);
    }

    doc.heading('Analítico por tratativa');
    doc.paragraph('Classe: INC = incremento, INC+TROCA = incremento e troca de categoria, TROCA = troca de categoria, DEC = decremento, ECO = alteração de economia sem marcação. Valor = (ganho + perda) × fator. Tipo de ordem, marcação do formulário, cidade e a leitura completa estão no Excel. Rep. igual = mesma ligação, mês e efeito.');
    const rows = model.rows.map((row) => [
      String(row.id), dateTimeBr(row.date), CODE[row.class] || '-', readable(row), row.read || '-', money(rowValue(row)), row.repeat, row.note,
    ]);
    rows.push({ bold: true, cells: ['', 'TOTAL', '', `${INT.format(model.rows.length)} tratativas`, '', money(T.net), '', ''] });
    doc.table({
      size: 7,
      columns: [right('Id', 6), { title: 'Data e hora', width: 16 }, { title: 'Classe', width: 9 }, { title: 'Informado no formulário', width: 46 },
        { title: 'Como foi lido', width: 38 }, right('Valor R$', 11), { title: 'Rep.', width: 4 }, { title: 'Observação', width: 33 }],
      rows,
    });
    return doc;
  }

  // ---------------------------------------------------------------- tela
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /** Liga os botões. `context()` devolve { feed, panel, billing } do que está na tela. */
  function attach(context) {
    const excel = document.querySelector('#baixar-excel');
    const pdf = document.querySelector('#baixar-pdf');
    const status = document.querySelector('#export-status');
    if (!excel || !pdf) return;
    let detail = null;
    const say = (text, error) => { status.textContent = text; status.classList.toggle('erro', Boolean(error)); };

    async function run(button, work) {
      excel.disabled = pdf.disabled = true;
      const label = button.textContent;
      button.textContent = 'Gerando…';
      say('');
      try {
        if (!detail) {
          const response = await fetch('./data/analitico.json', { cache: 'no-cache' });
          if (!response.ok) throw new Error(`analitico.json: HTTP ${response.status}`);
          detail = await response.json();
        }
        const { feed, panel, billing } = context();
        const model = buildModel(feed, panel, detail);
        await work(feed, model, billing);
        say(model.totals.ok ? '' : 'Atenção: as linhas do analítico não fecham com o painel. Não use o arquivo como prova.', !model.totals.ok);
      } catch (error) {
        say(`Não foi possível gerar o arquivo: ${error.message}`, true);
      } finally {
        button.textContent = label;
        excel.disabled = pdf.disabled = false;
      }
    }

    excel.addEventListener('click', () => run(excel, async (feed, model, billing) => {
      download(await global.TratativasXlsx.build(excelSheets(feed, model, billing)), fileName(model, 'xlsx'));
    }));
    pdf.addEventListener('click', () => run(pdf, async (feed, model, billing) => {
      download(await buildPdf(feed, model, billing).blob(), fileName(model, 'pdf'));
    }));
  }

  const api = { attach, buildModel, excelSheets, buildPdf, explanation };
  global.TratativasExporta = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
