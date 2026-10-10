'use strict';
/*
 * xlsx.js — gera arquivos .xlsx (Excel) no navegador, sem bibliotecas.
 *
 * planilhas: [{ name, widths: [largura...], rows: [[célula...]], freezeRows, freezeCols, filter: 'A1:W99' }]
 * célula: null | número | texto | { v: valor, f: 'fórmula sem =', s: estilo }
 *   Com fórmula, `v` é o valor em cache (para leitores que não recalculam); o Excel recalcula ao abrir.
 *   Texto vira sempre texto (nunca fórmula).
 */
(function (global) {
  const enc = new TextEncoder();
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // estilos disponíveis para as células
  const STYLE = { DEFAULT: 0, HEADER: 1, MONEY: 2, INT: 3, DATETIME: 4, BOLD: 5, BOLD_MONEY: 6, WRAP: 7, TITLE: 8, BOLD_INT: 9, SECTION: 10 };

  const STYLES = HEAD + `<styleSheet xmlns="${NS}">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts>' +
    '<fonts count="4">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="15"/><color rgb="FF14296B"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="12"/><color rgb="FF14296B"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFB8C0D8"/></bottom><diagonal/></border>' +
    '<border><left/><right/><top style="thin"><color rgb="FF14296B"/></top><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="11">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="4" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="1" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (text) => String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"]/g, (c) => ESC[c]);

  function letter(index) {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
  }

  /** 'aaaa-mm-dd hh:mm' → número de série do Excel (data e hora). */
  function serial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(iso));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) / 86400000 + 25569;
  }

  function cellXml(ref, cell, cache) {
    if (cell === null || cell === undefined || cell === '') return '';
    const spec = typeof cell === 'object' ? cell : { v: cell };
    const style = spec.s ? ` s="${spec.s}"` : '';
    const value = spec.v;
    const isText = typeof value === 'string';
    if (spec.f) {
      const cached = cache && value !== undefined && value !== null ? `<v>${isText ? esc(value) : value}</v>` : '';
      return `<c r="${ref}"${style}${isText ? ' t="str"' : ''}><f>${esc(spec.f)}</f>${cached}</c>`;
    }
    if (isText) return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
    return '';
  }

  function sheetXml(sheet, cache) {
    const rows = sheet.rows.map((cells, r) => {
      const xml = cells.map((cell, c) => cellXml(letter(c) + (r + 1), cell, cache)).join('');
      return xml ? `<row r="${r + 1}">${xml}</row>` : '';
    }).join('');
    const width = Math.max(1, ...sheet.rows.map((cells) => cells.length));
    const frozenRows = sheet.freezeRows || 0;
    const frozenCols = sheet.freezeCols || 0;
    let view = '<sheetView workbookViewId="0"/>';
    if (frozenRows || frozenCols) {
      const top = letter(frozenCols) + (frozenRows + 1);
      const pane = frozenRows && frozenCols ? 'bottomRight' : frozenRows ? 'bottomLeft' : 'topRight';
      view = `<sheetView workbookViewId="0"><pane${frozenCols ? ` xSplit="${frozenCols}"` : ''}${frozenRows ? ` ySplit="${frozenRows}"` : ''} topLeftCell="${top}" activePane="${pane}" state="frozen"/><selection pane="${pane}"/></sheetView>`;
    }
    const widths = (sheet.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    return HEAD + `<worksheet xmlns="${NS}"><dimension ref="A1:${letter(width - 1)}${Math.max(1, sheet.rows.length)}"/>` +
      `<sheetViews>${view}</sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
      (widths ? `<cols>${widths}</cols>` : '') +
      `<sheetData>${rows}</sheetData>` +
      (sheet.filter ? `<autoFilter ref="${sheet.filter}"/>` : '') +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToHeight="0"/>' +
      '</worksheet>';
  }

  // ---------------------------------------------------------------- ZIP
  const CRC = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Deflate bruto; sem CompressionStream o arquivo vai sem compressão. */
  async function deflate(bytes, format = 'deflate-raw') {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new CompressionStream(format);
      const writer = stream.writable.getWriter();
      writer.write(bytes).catch(() => {});
      writer.close().catch(() => {});
      return new Uint8Array(await new Response(stream.readable).arrayBuffer());
    } catch (error) {
      return null;
    }
  }

  async function zip(files) {
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const day = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let position = 0;
    for (const file of files) {
      const name = enc.encode(file.name);
      const crc = crc32(file.bytes);
      let data = await deflate(file.bytes);
      let method = 8;
      if (!data || data.length >= file.bytes.length) { data = file.bytes; method = 0; }

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, method, true);
      lv.setUint16(10, time, true); lv.setUint16(12, day, true); lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); lv.setUint32(22, file.bytes.length, true); lv.setUint16(26, name.length, true);
      local.set(name, 30);
      parts.push(local, data);

      const entry = new Uint8Array(46 + name.length);
      const ev = new DataView(entry.buffer);
      ev.setUint32(0, 0x02014b50, true); ev.setUint16(4, 20, true); ev.setUint16(6, 20, true); ev.setUint16(8, 0x0800, true);
      ev.setUint16(10, method, true); ev.setUint16(12, time, true); ev.setUint16(14, day, true); ev.setUint32(16, crc, true);
      ev.setUint32(20, data.length, true); ev.setUint32(24, file.bytes.length, true); ev.setUint16(28, name.length, true);
      ev.setUint32(42, position, true);
      entry.set(name, 46);
      central.push(entry);
      position += local.length + data.length;
    }
    const size = central.reduce((total, entry) => total + entry.length, 0);
    const end = new Uint8Array(22);
    const dv = new DataView(end.buffer);
    dv.setUint32(0, 0x06054b50, true); dv.setUint16(8, files.length, true); dv.setUint16(10, files.length, true);
    dv.setUint32(12, size, true); dv.setUint32(16, position, true);
    return new Blob([...parts, ...central, end], { type: TYPE });
  }

  function sheetName(name, used) {
    const base = String(name || 'Planilha').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Planilha';
    let unique = base;
    for (let i = 2; used.has(unique.toLowerCase()); i++) unique = `${base.slice(0, 28)} ${i}`;
    used.add(unique.toLowerCase());
    return unique;
  }

  /** Devolve um Blob .xlsx. `cache: false` omite os valores em cache das fórmulas (só para teste). */
  async function build(sheets, { cache = true } = {}) {
    const used = new Set();
    const names = sheets.map((sheet) => sheetName(sheet.name, used));
    const files = [];
    const add = (name, text) => files.push({ name, bytes: enc.encode(text) });
    add('[Content_Types].xml', HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>');
    add('_rels/.rels', HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    // filtros automáticos precisam de um nome definido por planilha
    const defined = sheets.map((sheet, i) => {
      if (!sheet.filter) return '';
      const [a, b] = sheet.filter.split(':').map((ref) => ref.replace(/([A-Z]+)(\d+)/, '$$$1$$$2'));
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i])}'!${a}:${b}</definedName>`;
    }).join('');
    add('xl/workbook.xml', HEAD + `<workbook xmlns="${NS}" xmlns:r="${NS_R}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
      names.map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets>' + (defined ? `<definedNames>${defined}</definedNames>` : '') + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
    add('xl/_rels/workbook.xml.rels', HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    add('xl/styles.xml', STYLES);
    sheets.forEach((sheet, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet, cache)));
    return zip(files);
  }

  const api = { build, letter, serial, STYLE, TYPE, deflate };
  global.TratativasXlsx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
