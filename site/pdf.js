'use strict';
/*
 * pdf.js — gera PDF (A4 paisagem) no navegador, sem bibliotecas.
 *
 * Texto em fontes padrão do PDF (Helvetica e Courier, codificação WinAnsi), tabelas em fonte monoespaçada, para o
 * alinhamento ficar exato. Uso:
 *   const doc = TratativasPdf.create({ title, footer });
 *   doc.title('...'); doc.text('...'); doc.heading('...'); doc.paragraph('...');
 *   doc.table({ columns: [{ title, width, align }], rows: [[...]], size: 7 });
 *   const blob = await doc.blob();
 */
(function (global) {
  const PAGE = { width: 841.89, height: 595.28, margin: 36, top: 40, bottom: 44 };
  const FONT = { sans: 'F1', sansBold: 'F2', mono: 'F3', monoBold: 'F4' };
  const SPECIAL = { '→': '->', '←': '<-', '−': '-', '…': '...', '≥': '>=', '≤': '<=', '≠': '!=', '✓': 'ok', ' ': ' ', ' ': ' ' };
  const CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

  /** Texto → string de bytes WinAnsi (um caractere por byte), sem os caracteres que quebrariam o PDF. */
  function winAnsi(text) {
    let out = '';
    for (const original of String(text === null || text === undefined ? '' : text)) {
      const ch = SPECIAL[original] !== undefined ? SPECIAL[original] : original;
      for (const c of ch) {
        const code = c.codePointAt(0);
        if (CP1252[c] !== undefined) out += String.fromCharCode(CP1252[c]);
        else if (code < 32) out += ' ';
        else if (code < 256 && !(code >= 0x80 && code < 0xa0)) out += c;
        else out += '?';
      }
    }
    return out;
  }

  const escapeText = (binary) => binary.replace(/[\\()]/g, (c) => `\\${c}`);
  const fix = (n) => (Math.round(n * 100) / 100).toString();

  /** Quebra em linhas de até `width` caracteres, por palavras (palavra maior que a linha é cortada). */
  function wrap(text, width) {
    const lines = [];
    for (const paragraph of String(text === null || text === undefined ? '' : text).split('\n')) {
      let line = '';
      for (let word of paragraph.split(/\s+/).filter(Boolean)) {
        while (word.length > width) {
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, width));
          word = word.slice(width);
        }
        if (!line) line = word;
        else if (line.length + 1 + word.length <= width) line += ` ${word}`;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }

  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new CompressionStream('deflate'); // formato zlib, o que o FlateDecode espera
      const writer = stream.writable.getWriter();
      writer.write(bytes).catch(() => {});
      writer.close().catch(() => {});
      return new Uint8Array(await new Response(stream.readable).arrayBuffer());
    } catch (error) {
      return null;
    }
  }

  const toBytes = (binary) => Uint8Array.from(binary, (c) => c.charCodeAt(0) & 0xff);

  function create({ title = 'Documento', footer = '', author = '' } = {}) {
    const pages = [];
    let ops = null;
    let y = 0;

    function newPage() {
      ops = [];
      pages.push(ops);
      y = PAGE.height - PAGE.top;
    }
    newPage();

    const room = (height) => { if (y - height < PAGE.bottom) newPage(); };

    function put(font, size, x, baseline, text, gray) {
      const color = gray === undefined ? '0 g' : `${gray} g`;
      ops.push(`BT ${color} /${font} ${fix(size)} Tf ${fix(x)} ${fix(baseline)} Td (${escapeText(winAnsi(text))}) Tj ET`);
    }
    const fill = (x, bottom, width, height, gray) => ops.push(`${gray} g ${fix(x)} ${fix(bottom)} ${fix(width)} ${fix(height)} re f`);

    const api = {
      title(text) {
        room(24);
        put(FONT.sansBold, 17, PAGE.margin, y - 15, text, 0.08);
        y -= 24;
      },
      text(text, { size = 9, bold = false, gray } = {}) {
        room(size * 1.5);
        put(bold ? FONT.sansBold : FONT.sans, size, PAGE.margin, y - size, text, gray);
        y -= size * 1.5;
      },
      heading(text) {
        room(40);
        y -= 8;
        put(FONT.sansBold, 11.5, PAGE.margin, y - 11, text, 0.1);
        y -= 17;
        ops.push(`0.8 G 0.6 w ${fix(PAGE.margin)} ${fix(y + 3)} m ${fix(PAGE.width - PAGE.margin)} ${fix(y + 3)} l S`);
        y -= 4;
      },
      paragraph(text, { size = 8 } = {}) {
        const chars = Math.floor((PAGE.width - 2 * PAGE.margin) / (0.6 * size));
        for (const line of wrap(text, chars)) {
          room(size * 1.4);
          put(FONT.mono, size, PAGE.margin, y - size, line);
          y -= size * 1.4;
        }
        y -= size * 0.4;
      },
      spacer(height) { y -= height; },
      pageBreak() { newPage(); },
      /**
       * columns: [{ title, width (caracteres), align: 'left' | 'right' }]; rows: [[texto...]] ou { cells, bold }.
       * Linhas longas quebram dentro da coluna. O cabeçalho se repete a cada página.
       */
      table({ columns, rows, size = 7, zebra = true }) {
        const charWidth = 0.6 * size;
        const lineHeight = size * 1.3;
        const gap = 2;
        const cell = (text, column) => (column.align === 'right' ? text.padStart(column.width) : text.padEnd(column.width));
        const layout = (cells) => cells.map((text, i) => wrap(text, columns[i].width));
        const draw = (wrapped, bold, shade) => {
          const count = Math.max(...wrapped.map((lines) => lines.length));
          const height = count * lineHeight + 2;
          room(height);
          if (shade) fill(PAGE.margin - 2, y - height + 1, PAGE.width - 2 * PAGE.margin + 4, height, 0.955);
          for (let n = 0; n < count; n++) {
            const line = columns.map((column, i) => cell(wrapped[i][n] || '', column)).join(' '.repeat(gap));
            put(bold ? FONT.monoBold : FONT.mono, size, PAGE.margin, y - size - n * lineHeight - 1, line, 0.05);
          }
          y -= height;
        };
        const header = () => {
          const wrapped = layout(columns.map((column) => column.title));
          const count = Math.max(...wrapped.map((lines) => lines.length));
          const height = count * lineHeight + 4;
          room(height + lineHeight * 3);
          fill(PAGE.margin - 2, y - height, PAGE.width - 2 * PAGE.margin + 4, height, 0.88);
          for (let n = 0; n < count; n++) {
            const line = columns.map((column, i) => cell(wrapped[i][n] || '', column)).join(' '.repeat(gap));
            put(FONT.monoBold, size, PAGE.margin, y - size - n * lineHeight - 2, line, 0.05);
          }
          y -= height + 1;
        };
        header();
        let index = 0;
        for (const row of rows) {
          const cells = Array.isArray(row) ? row : row.cells;
          const bold = !Array.isArray(row) && row.bold;
          const wrapped = layout(cells);
          const count = Math.max(...wrapped.map((lines) => lines.length));
          if (y - (count * lineHeight + 2) < PAGE.bottom) { newPage(); header(); }
          draw(wrapped, bold, zebra && index % 2 === 1 && !bold);
          index++;
        }
        y -= size * 0.8;
      },
      pageCount: () => pages.length,
      /** Monta o arquivo. */
      async blob() {
        const total = pages.length;
        const footers = pages.map((_, i) => {
          const label = `Página ${i + 1} de ${total}`;
          const x = PAGE.width - PAGE.margin - label.length * 0.5 * 8;
          return [
            `0.8 G 0.6 w ${fix(PAGE.margin)} 34 m ${fix(PAGE.width - PAGE.margin)} 34 l S`,
            `BT 0.35 g /${FONT.sans} 8 Tf ${fix(PAGE.margin)} 22 Td (${escapeText(winAnsi(footer))}) Tj ET`,
            `BT 0.35 g /${FONT.sans} 8 Tf ${fix(x)} 22 Td (${escapeText(winAnsi(label))}) Tj ET`,
          ];
        });
        const chunks = [];
        const offsets = [];
        let length = 0;
        const push = (data) => {
          const bytes = typeof data === 'string' ? toBytes(data) : data;
          chunks.push(bytes);
          length += bytes.length;
        };
        const object = (number, body) => { offsets[number] = length; push(`${number} 0 obj\n${body}\nendobj\n`); };

        const firstPage = 8;
        const kids = pages.map((_, i) => `${firstPage + 2 * i} 0 R`).join(' ');
        const now = new Date();
        const stamp = `D:${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}` +
          `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}00`;

        push('%PDF-1.4\n%âãÏÓ\n');
        object(1, '<< /Type /Catalog /Pages 2 0 R >>');
        object(2, `<< /Type /Pages /Kids [${kids}] /Count ${total} >>`);
        [['F1', 'Helvetica'], ['F2', 'Helvetica-Bold'], ['F3', 'Courier'], ['F4', 'Courier-Bold']].forEach(([, name], i) => {
          object(3 + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
        });
        object(7, `<< /Title (${escapeText(winAnsi(title))}) /Author (${escapeText(winAnsi(author))}) /Creator (Tratativas Comerciais) /CreationDate (${stamp}) >>`);
        for (let i = 0; i < total; i++) {
          const content = toBytes([...pages[i], ...footers[i]].join('\n'));
          const packed = await deflate(content);
          const page = firstPage + 2 * i;
          object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
            `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${page + 1} 0 R >>`);
          offsets[page + 1] = length;
          push(`${page + 1} 0 obj\n<< /Length ${(packed || content).length}${packed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`);
          push(packed || content);
          push('\nendstream\nendobj\n');
        }
        const size = firstPage + 2 * total;
        const xref = length;
        push(`xref\n0 ${size}\n0000000000 65535 f \n` +
          offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join(''));
        push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
        return new Blob(chunks, { type: 'application/pdf' });
      },
    };
    return api;
  }

  const api = { create, wrap, winAnsi, PAGE };
  global.TratativasPdf = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
