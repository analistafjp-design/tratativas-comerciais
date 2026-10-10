'use strict';
// Rodar com: node --test tests/exporta.test.js   (Node 20+; os testes do script em Python ficam em tests/test_build_data.py)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const site = path.join(__dirname, '..', 'site');
require(path.join(site, 'xlsx.js'));
require(path.join(site, 'pdf.js'));
const Exporta = require(path.join(site, 'exporta.js'));

const read = (name) => JSON.parse(fs.readFileSync(path.join(site, 'data', name), 'utf8'));
const feed = read('summary.json');
const detail = read('analitico.json');

/** O que o painel mostra por mês (mesma conta do summarize de app.js), do mais novo para o mais antigo. */
const panel = [...feed.months].reverse().map((month) => {
  const counted = feed.counts.find((item) => item.month === month);
  const netCents = feed.lines.filter((line) => line.month === month).reduce((total, line) => total + line.cents * line.factor, 0);
  return { month, inc: counted.inc, incCat: counted.incCat, increments: counted.inc + counted.incCat, swaps: counted.cat + counted.incCat, netCents };
});

test('as linhas do analítico fecham com o painel em todos os meses', () => {
  const model = Exporta.buildModel(feed, panel, detail);
  assert.ok(model.totals.ok, 'resumo do analítico diverge do painel');
  assert.strictEqual(model.totals.net, model.totals.shownNet);
  assert.strictEqual(model.rows.length, detail.rows.length);
  assert.deepStrictEqual(model.months.map((item) => item.month), panel.map((item) => item.month));
  assert.notStrictEqual(model.first, model.final);
});

test('nenhum texto do resumo sai com "undefined" ou "NaN"', () => {
  const model = Exporta.buildModel(feed, panel, detail);
  const texts = [model.generated, model.first, model.final, model.lastBr,
    ...Exporta.explanation(feed, model, 'x').flatMap((section) => [section.heading, ...section.lines])];
  for (const text of texts) assert.doesNotMatch(String(text), /undefined|NaN/);
});

test('o Excel e o PDF são gerados', async () => {
  const model = Exporta.buildModel(feed, panel, detail);
  const sheets = Exporta.excelSheets(feed, model, 'x');
  assert.deepStrictEqual(sheets.map((sheet) => sheet.name), ['Resumo', 'Analítico', 'Regras e fonte']);
  assert.strictEqual(sheets[1].rows.length, detail.rows.length + 1);
  const xlsx = Buffer.from(await (await globalThis.TratativasXlsx.build(sheets)).arrayBuffer());
  assert.strictEqual(xlsx.subarray(0, 2).toString(), 'PK');
  const pdf = Buffer.from(await (await Exporta.buildPdf(feed, model, 'x').blob()).arrayBuffer());
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.subarray(-6).toString().includes('%%EOF'));
});

test('o analítico não leva matrícula nem colaborador', () => {
  assert.ok(!detail.columns.some((name) => /matric|colab|nome|mail/i.test(name)));
});
