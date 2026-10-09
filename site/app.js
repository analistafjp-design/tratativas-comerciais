'use strict';

const ALL = 'all';
const UNKNOWN_CITY = 'Não identificada';
const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const count = new Intl.NumberFormat('pt-BR');
const monthLong = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });

let feed;
let selected = ALL; // 'all' ou 'AAAA-MM'
let city = '';

// ---------------------------------------------------------------- datas
const upper = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const dateOf = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)); };
const longLabel = (month) => upper(monthLong.format(dateOf(month)));
const nameLabel = (month) => upper(monthName.format(dateOf(month)));
const nextMonth = (month) => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const monthsLeft = (month) => 12 - Number(month.slice(5, 7)); // faturas cheias após o mês da tratativa, até dezembro

/** O último mês é parcial quando a base termina antes do último dia dele. */
function isPartial(month) {
  const last = feed.source.lastDate;
  if (!last || !last.startsWith(month)) return false;
  const [y, m, d] = last.split('-').map(Number);
  return d < new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const withFlag = (month, text) => (isPartial(month) ? `${text} (parcial)` : text);

// ---------------------------------------------------------------- cálculo
const brl = (cents) => money.format(cents / 100);
const valueOf = (line) => line.cents * line.factor; // água + esgoto já aplicado pelo fator da linha

const linesFor = (month) => feed.lines.filter((l) => (month === ALL || l.month === month) && (!city || l.city === city));

function totalsOf(lines) {
  const t = { newEconomies: 0, removedEconomies: 0, swapsUp: 0, swapsDown: 0, gainsCents: 0, lossesCents: 0, netCents: 0 };
  for (const line of lines) {
    const value = valueOf(line);
    const up = line.dir === 'inc';
    t.netCents += value;
    if (up) t.gainsCents += value; else t.lossesCents -= value;
    if (line.kind === 'economia') { if (up) t.newEconomies += line.qty; else t.removedEconomies -= line.qty; }
    else if (up) t.swapsUp += line.qty; else t.swapsDown += line.qty;
  }
  return t;
}

const pendingCount = () => feed.pending
  .filter((p) => (selected === ALL || p.month === selected) && (!city || p.city === city))
  .reduce((sum, p) => sum + p.count, 0);

// ---------------------------------------------------------------- indicadores
function renderKpis(t, untilYearEndCents) {
  $('#new-economies').textContent = count.format(t.newEconomies);
  $('#lost-economies').textContent = `${count.format(t.removedEconomies)} economias retiradas entram nas perdas`;
  $('#category-swaps').textContent = count.format(t.swapsUp);
  $('#category-detail').textContent = `Aumentam a tarifa · ${count.format(t.swapsDown)} reduzem`;
  $('#monthly-net').textContent = brl(t.netCents);
  $('#projection').textContent = brl(untilYearEndCents);

  if (selected === ALL) {
    const [first, last] = [feed.months[0], feed.months.at(-1)];
    $('#monthly-label').textContent = 'Valor mensal acumulado';
    $('#monthly-detail').textContent = `Soma dos meses de ${nameLabel(first).toLowerCase()} a ${nameLabel(last).toLowerCase()}`;
    $('#projection-label').textContent = `Faturamento adicional até dez/${last.slice(0, 4)}`;
    $('#annualized').textContent = `${brl(t.netCents * 12)} em 12 meses, se mantido`;
  } else {
    const left = monthsLeft(selected);
    $('#monthly-label').textContent = `Na fatura cheia de ${nameLabel(nextMonth(selected)).toLowerCase()}`;
    $('#monthly-detail').textContent = 'Ganhos menos perdas, por mês';
    $('#projection-label').textContent = `Até dezembro de ${selected.slice(0, 4)}`;
    $('#annualized').textContent = `${left} ${left === 1 ? 'fatura cheia' : 'faturas cheias'} · ${brl(t.netCents * 12)} em 12 meses`;
  }
}

function tile(label, t, untilYearEndCents, value, flagged) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `tile${value === selected ? ' active' : ''}${t.netCents < 0 ? ' neg' : ''}`;
  button.setAttribute('aria-pressed', String(value === selected));
  const name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = flagged ? `${label} (parcial)` : label;
  const amount = document.createElement('strong');
  amount.className = 'tile-value';
  amount.textContent = brl(t.netCents);
  const counts = document.createElement('span');
  counts.className = 'tile-meta';
  counts.textContent = `${count.format(t.newEconomies)} novas economias · ${count.format(t.swapsUp)} trocas`;
  const projection = document.createElement('span');
  projection.className = 'tile-meta';
  projection.textContent = `${brl(untilYearEndCents)} até dezembro`;
  button.append(name, amount, counts, projection);
  button.addEventListener('click', () => select(selected === value ? ALL : value));
  return button;
}

function renderTiles(perMonth, total) {
  $('#month-tiles').replaceChildren(
    tile('Ano todo', total.totals, total.untilYearEndCents, ALL, false),
    ...perMonth.map((m) => tile(nameLabel(m.month), m.totals, m.untilYearEndCents, m.month, isPartial(m.month))),
  );
}

// ---------------------------------------------------------------- tabelas
function td(text, className) {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

/** Agrupa as linhas por (de → para) como nos quadros do relatório e preenche tabela + total. */
function renderDetail(kind, dir, lines) {
  const groups = new Map();
  for (const line of lines.filter((l) => l.kind === kind && l.dir === dir)) {
    const key = `${line.from}\u0000${line.to}`;
    const group = groups.get(key) || { from: line.from, to: line.to, qty: 0, cents: 0 };
    group.qty += line.qty;
    group.cents += valueOf(line);
    groups.set(key, group);
  }
  const rows = [...groups.values()].sort((a, b) => a.from.localeCompare(b.from, 'pt-BR') || a.to.localeCompare(b.to, 'pt-BR'));
  const id = `${kind === 'economia' ? 'econ' : 'cat'}-${dir}`;
  const body = $(`#${id}-body`);
  const foot = $(`#${id}-foot`);
  body.replaceChildren();
  foot.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr');
    const cell = td('Nenhum movimento no período', 'empty');
    cell.colSpan = 4;
    tr.append(cell);
    body.append(tr);
    return;
  }
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.append(td(row.from), td(row.to), td(count.format(row.qty), 'num'), td(brl(row.cents), `num${row.cents < 0 ? ' neg' : ''}`));
    body.append(tr);
  }
  const sumQty = rows.reduce((s, r) => s + r.qty, 0);
  const sumCents = rows.reduce((s, r) => s + r.cents, 0);
  const tr = document.createElement('tr');
  const label = td('Total');
  label.colSpan = 2;
  tr.append(label, td(count.format(sumQty), 'num'), td(brl(sumCents), `num${sumCents < 0 ? ' neg' : ''}`));
  foot.append(tr);
}

function renderNotes(scope, t) {
  $('#equation').replaceChildren(
    ...[['Ganhos', brl(t.gainsCents)], ['−', null], ['Perdas', brl(t.lossesCents)], ['=', null], ['Resultado', brl(t.netCents)]]
      .map(([label, value]) => {
        const span = document.createElement('span');
        if (value === null) { span.className = 'op'; span.textContent = label; return span; }
        span.className = label === 'Resultado' ? 'eq-result' : 'eq-item';
        const name = document.createElement('small');
        name.textContent = label;
        const amount = document.createElement('strong');
        amount.textContent = value;
        span.append(name, amount);
        return span;
      }),
  );
  $('#detail-title').textContent = `Detalhe · ${scope}`;

  const notes = [];
  const pending = pendingCount();
  if (pending) notes.push(`${count.format(pending)} ${pending === 1 ? 'registro ficou' : 'registros ficaram'} fora do cálculo por dados incompletos ou não reconhecidos.`);
  const unknown = feed.lines
    .filter((l) => l.city === UNKNOWN_CITY && (selected === ALL || l.month === selected))
    .reduce((sum, l) => sum + l.rows, 0);
  if (feed.source.clientsLinked && unknown) notes.push(`${count.format(unknown)} movimentos sem localidade, calculados só com água (1×).`);
  if (!feed.source.clientsLinked) notes.push('Sem cruzamento com a base de clientes: água + esgoto (2×) não aplicado.');
  $('#data-note').textContent = notes.join(' ');
}

// ---------------------------------------------------------------- tela
function render() {
  const perMonth = feed.months.map((month) => {
    const totals = totalsOf(linesFor(month));
    return { month, totals, untilYearEndCents: totals.netCents * monthsLeft(month) };
  });
  const total = {
    totals: totalsOf(linesFor(ALL)),
    untilYearEndCents: perMonth.reduce((sum, m) => sum + m.untilYearEndCents, 0),
  };
  const current = selected === ALL ? total : perMonth.find((m) => m.month === selected);
  const [first, last] = [feed.months[0], feed.months.at(-1)];
  const scope = selected === ALL
    ? `${first.slice(0, 4) === last.slice(0, 4) ? nameLabel(first) : longLabel(first)} a ${longLabel(last).toLowerCase()}`
    : withFlag(selected, longLabel(selected));
  const lines = linesFor(selected);

  $('#period-description').textContent = `${scope}${city ? ` · ${city}` : ''}`;
  renderKpis(current.totals, current.untilYearEndCents);
  renderTiles(perMonth, total);
  renderDetail('economia', 'inc', lines);
  renderDetail('categoria', 'inc', lines);
  renderDetail('economia', 'dec', lines);
  renderDetail('categoria', 'dec', lines);
  renderNotes(scope, current.totals);
  $('#period').value = selected;
}

function select(value) {
  selected = value;
  render();
}

// ---------------------------------------------------------------- inicialização
function setup() {
  const cities = [...new Set(feed.lines.map((l) => l.city))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('#period').replaceChildren(
    new Option('Ano todo', ALL),
    ...feed.months.map((m) => new Option(withFlag(m, longLabel(m)), m)),
  );
  $('#city').replaceChildren(new Option('Todas as localidades', ''), ...cities.map((c) => new Option(c, c)));
  $('#city-label').hidden = !feed.source.clientsLinked;

  $('#period').addEventListener('change', (e) => select(e.target.value));
  $('#city').addEventListener('change', (e) => { city = e.target.value; render(); });

  $('#sample-banner').hidden = !feed.sample;
  $('#status-text').textContent = `Base até ${dayFormat.format(new Date(`${feed.source.lastDate}T00:00:00Z`))}`;
  $('#source-note').textContent = `Fonte: tabela TRATATIVAS (${count.format(feed.source.tratativas)} registros), dados consolidados, sem identificação de clientes.`;

  $('#tariff-rows').replaceChildren(...Object.entries(feed.tariffsCents).map(([name, cents]) => {
    const tr = document.createElement('tr');
    tr.append(td(name), td(brl(cents), 'num'));
    return tr;
  }));
  $('#assumptions-button').addEventListener('click', () => $('#assumptions-dialog').showModal());

  render();
}

fetch('./data/summary.json', { cache: 'no-cache' })
  .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then((data) => {
    feed = data;
    if (!feed.months.length) throw new Error('Não há tratativas com valor na base.');
    setup();
  })
  .catch((error) => {
    $('#status-text').textContent = 'Falha ao carregar';
    const message = document.createElement('p');
    message.className = 'error';
    message.textContent = `Não foi possível carregar os dados do painel: ${error.message}`;
    $('#main').prepend(message);
  });
