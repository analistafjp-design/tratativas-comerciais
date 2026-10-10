'use strict';

const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const count = new Intl.NumberFormat('pt-BR');
const monthLong = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });

// ---------------------------------------------------------------- datas
const upper = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const dateOf = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)); };
const nameLabel = (month) => upper(monthName.format(dateOf(month)));
const monthsLeft = (month) => 12 - Number(month.slice(5, 7)); // faturas cheias após o mês da tratativa, até dezembro

/** O último mês é parcial quando a base termina antes do último dia dele. */
function isPartial(feed, month) {
  const last = feed.source.lastDate;
  if (!last || !last.startsWith(month)) return false;
  const [y, m, d] = last.split('-').map(Number);
  return d < new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ---------------------------------------------------------------- cálculo
const brl = (cents) => money.format(cents / 100);

/**
 * Uma linha por mês, do mais novo para o mais antigo, com a separação do painel Cadastro e Venda: incremento,
 * incremento e troca de categoria, troca de categoria, total de incremento e total de troca de categoria. Contam
 * tratativas, e a tratativa de "incremento e troca de categoria" entra nos dois totais. O valor é ganhos − perdas.
 */
function summarize(feed) {
  return [...feed.months].reverse().map((month) => {
    const counted = feed.counts.find((item) => item.month === month);
    const row = {
      month, inc: counted.inc, incCat: counted.incCat, cat: counted.cat, increments: counted.inc + counted.incCat,
      swaps: counted.cat + counted.incCat, netCents: 0,
    };
    for (const line of feed.lines) {
      if (line.month === month) row.netCents += line.cents * line.factor; // água + esgoto já aplicado pelo fator da linha
    }
    row.untilYearEndCents = row.netCents * monthsLeft(month);
    return row;
  });
}

// ---------------------------------------------------------------- tela
function cell(text, label, className) {
  const td = document.createElement('td');
  td.textContent = text;
  td.dataset.label = label;
  if (className) td.className = className;
  return td;
}

/** Célula de valor com barra proporcional ao maior mês, como nas tabelas dos outros painéis. */
function barCell(text, label, cents, max) {
  const td = document.createElement('td');
  td.className = `num taxa${cents < 0 ? ' neg' : ''}`;
  td.dataset.label = label;
  const box = document.createElement('div');
  box.className = 'celula';
  if (cents > 0) {
    const bar = document.createElement('span');
    bar.className = 'barra';
    bar.style.width = `${(100 * cents) / max}%`;
    box.append(bar);
  }
  const value = document.createElement('span');
  value.className = 'valor';
  value.textContent = text;
  box.append(value);
  td.append(box);
  return td;
}

/** Frase do rodapé sobre água + esgoto, conforme o cruzamento com a base de clientes. */
function billingNote({ clientsLinked, billing, coverage }) {
  if (!clientsLinked) return 'Água + esgoto (2×) não aplicado: falta o cruzamento com a base de clientes.';
  if (billing !== 'ligacao') return 'Água + esgoto (valor 2×) em Cordeiro, Miracema e Aperibé.';
  const note = 'Água + esgoto (valor 2×) nas ligações que faturam água e esgoto.';
  if (!coverage || !coverage.total || coverage.found >= coverage.total) return note;
  const pct = Math.floor((100 * coverage.found) / coverage.total);
  return `${note} Ligação encontrada na base de clientes em ${pct}% das tratativas; as demais foram calculadas só com água.`;
}

function render(feed) {
  const rows = summarize(feed);
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const [first, last] = [feed.months[0], feed.months.at(-1)];

  $('#sample-banner').hidden = !feed.sample;
  const from = first.slice(0, 4) === last.slice(0, 4) ? nameLabel(first) : monthLong.format(dateOf(first));
  const lastDate = dayFormat.format(new Date(`${feed.source.lastDate}T00:00:00Z`));
  $('#sub-topo').textContent = `Cadastro · ${from.toLowerCase()} a ${monthLong.format(dateOf(last))} · base até ${lastDate}`;
  $('#hero-sub').textContent = `Ganhos menos perdas de ${from.toLowerCase()} a ${nameLabel(last).toLowerCase()}, valor que se repete a cada fatura`;

  $('#total-inc').textContent = count.format(sum('inc'));
  $('#total-inc-cat').textContent = count.format(sum('incCat'));
  $('#total-cat').textContent = count.format(sum('cat'));
  $('#total-increments').textContent = count.format(sum('increments'));
  $('#total-swaps').textContent = count.format(sum('swaps'));
  $('#total-monthly').textContent = brl(sum('netCents'));
  $('#total-until-label').textContent = `Faturamento até dez/${last.slice(0, 4)}`;
  $('#total-until').textContent = brl(sum('untilYearEndCents'));

  const columns = ['Incremento', 'Incremento e troca de categoria', 'Troca de categoria', 'Total de incremento', 'Total de troca de categoria', 'Na próxima fatura cheia', 'Até dezembro'];
  const max = Math.max(1, ...rows.map((row) => row.netCents));
  $('#months-body').replaceChildren(...rows.map((row) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = nameLabel(row.month);
    if (isPartial(feed, row.month)) {
      const tag = document.createElement('span');
      tag.className = 'etiqueta baixa';
      tag.textContent = 'parcial';
      th.append(tag);
    }
    tr.append(
      th,
      cell(count.format(row.inc), columns[0], 'num'),
      cell(count.format(row.incCat), columns[1], 'num'),
      cell(count.format(row.cat), columns[2], 'num'),
      cell(count.format(row.increments), columns[3], 'num'),
      cell(count.format(row.swaps), columns[4], 'num'),
      barCell(brl(row.netCents), columns[5], row.netCents, max),
      cell(brl(row.untilYearEndCents), columns[6], `num${row.untilYearEndCents < 0 ? ' neg' : ''}`),
    );
    return tr;
  }));

  const rules = [
    'Valor por mês = ganhos − perdas. Na troca de categoria desconta-se a tarifa da categoria anterior.',
    'A primeira fatura cheia é a do mês seguinte à tratativa.',
    'Total de incremento = incremento + incremento e troca de categoria. Total de troca de categoria = troca de categoria + incremento e troca de categoria. A tratativa de incremento e troca de categoria entra nos dois totais.',
    billingNote(feed.source),
  ];
  $('#rules').textContent = rules.join(' ');
}

fetch('./data/summary.json', { cache: 'no-cache' })
  .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then((feed) => {
    if (!feed.months.length) throw new Error('Não há tratativas com valor na base.');
    if (!feed.counts) throw new Error('Dados desatualizados: gere o summary.json de novo.');
    render(feed);
    TratativasExporta.attach(() => ({ feed, panel: summarize(feed), billing: billingNote(feed.source) }));
  })
  .catch((error) => {
    $('#sub-topo').textContent = 'Falha ao carregar';
    const message = document.createElement('div');
    message.className = 'msg erro';
    message.textContent = `Não foi possível carregar os dados do painel: ${error.message}`;
    $('#main').prepend(message);
  });
