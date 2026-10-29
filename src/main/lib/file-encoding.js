/**
 * Detecção e conversão de encoding/EOL para arquivos do editor.
 * Sem dependência do Electron: recebe Buffer e devolve metadados.
 *
 * Política conservadora: se não for UTF-8/UTF-16 reconhecível, o arquivo
 * abre somente leitura. Nunca deixamos o Monaco gravar U+FFFD por acidente.
 */

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);
const UTF32LE_BOM = Buffer.from([0xff, 0xfe, 0x00, 0x00]);
const UTF32BE_BOM = Buffer.from([0x00, 0x00, 0xfe, 0xff]);

function startsWith(buf, prefix) {
  return buf.length >= prefix.length && buf.subarray(0, prefix.length).equals(prefix);
}

function detectEol(text) {
  if (!text) return 'LF';
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  const cr = (text.match(/\r(?!\n)/g) || []).length;
  if (crlf >= lf && crlf >= cr && crlf > 0) return 'CRLF';
  if (cr > lf && cr > 0) return 'CR';
  return 'LF';
}

function normalizeEol(text, eol = 'LF') {
  const lf = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (eol === 'CRLF') return lf.replace(/\n/g, '\r\n');
  if (eol === 'CR') return lf.replace(/\n/g, '\r');
  return lf;
}

function decodeWindows1252(buf) {
  try {
    return new TextDecoder('windows-1252').decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

function looksUtf16WithoutBom(buf) {
  if (buf.length < 8 || buf.length % 2 !== 0) return null;
  const sample = Math.min(buf.length, 4096);
  let zeroEven = 0;
  let zeroOdd = 0;
  let pairs = 0;
  for (let i = 0; i + 1 < sample; i += 2) {
    pairs++;
    if (buf[i] === 0) zeroEven++;
    if (buf[i + 1] === 0) zeroOdd++;
  }
  if (pairs < 4) return null;
  if (zeroOdd / pairs > 0.3 && zeroEven / pairs < 0.1) return 'utf16le';
  if (zeroEven / pairs > 0.3 && zeroOdd / pairs < 0.1) return 'utf16be';
  return null;
}

function swap16(buf) {
  const copy = Buffer.from(buf);
  if (copy.length % 2 !== 0) return copy;
  return copy.swap16();
}

/**
 * @param {Buffer} buf
 * @param {{ encoding?: string }} [opts] encoding explícito para reabrir
 * @returns {{ text: string, encoding: string, eol: string, binary: boolean, readOnly: boolean, bom: boolean }}
 */
function decodeBuffer(buf, opts = {}) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('decodeBuffer espera um Buffer');
  const forced = opts.encoding || null;

  if (forced === 'windows-1252' || forced === 'latin1') {
    const text = decodeWindows1252(buf);
    return { text, encoding: 'windows-1252', eol: detectEol(text), binary: false, readOnly: false, bom: false };
  }
  if (forced === 'utf8') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text, encoding: 'utf8', eol: detectEol(text), binary: false, readOnly: false, bom: false };
  }
  if (forced === 'utf16le' || forced === 'utf16be') {
    const text = forced === 'utf16le' ? buf.toString('utf16le') : swap16(buf).toString('utf16le');
    return { text, encoding: forced, eol: detectEol(text), binary: false, readOnly: false, bom: false };
  }

  if (buf.length === 0) {
    return { text: '', encoding: 'utf8', eol: 'LF', binary: false, readOnly: false, bom: false };
  }

  if (startsWith(buf, UTF32LE_BOM) || startsWith(buf, UTF32BE_BOM)) {
    return { text: decodeWindows1252(buf), encoding: 'unknown', eol: 'LF', binary: true, readOnly: true, bom: false };
  }

  if (startsWith(buf, UTF8_BOM)) {
    const body = buf.subarray(UTF8_BOM.length);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
      return { text, encoding: 'utf8', eol: detectEol(text), binary: false, readOnly: false, bom: true };
    } catch {
      return { text: decodeWindows1252(body), encoding: 'unknown', eol: 'LF', binary: false, readOnly: true, bom: true };
    }
  }

  if (startsWith(buf, UTF16LE_BOM)) {
    const text = buf.subarray(UTF16LE_BOM.length).toString('utf16le');
    return { text, encoding: 'utf16le', eol: detectEol(text), binary: false, readOnly: false, bom: true };
  }

  if (startsWith(buf, UTF16BE_BOM)) {
    const text = swap16(buf.subarray(UTF16BE_BOM.length)).toString('utf16le');
    return { text, encoding: 'utf16be', eol: detectEol(text), binary: false, readOnly: false, bom: true };
  }

  const utf16 = looksUtf16WithoutBom(buf);
  if (utf16) {
    const text = utf16 === 'utf16le' ? buf.toString('utf16le') : swap16(buf).toString('utf16le');
    return { text, encoding: utf16, eol: detectEol(text), binary: false, readOnly: false, bom: false };
  }

  if (buf.includes(0)) {
    return { text: decodeWindows1252(buf), encoding: 'binary', eol: 'LF', binary: true, readOnly: true, bom: false };
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text, encoding: 'utf8', eol: detectEol(text), binary: false, readOnly: false, bom: false };
  } catch {
    const text = decodeWindows1252(buf);
    return { text, encoding: 'unknown', eol: detectEol(text), binary: false, readOnly: true, bom: false };
  }
}

function encodeBuffer(text, { encoding = 'utf8', bom = false } = {}) {
  const value = String(text);
  if (encoding === 'utf8') {
    const body = Buffer.from(value, 'utf8');
    return bom ? Buffer.concat([UTF8_BOM, body]) : body;
  }
  if (encoding === 'utf16le') {
    const body = Buffer.from(value, 'utf16le');
    return bom ? Buffer.concat([UTF16LE_BOM, body]) : body;
  }
  if (encoding === 'utf16be') {
    const body = swap16(Buffer.from(value, 'utf16le'));
    return bom ? Buffer.concat([UTF16BE_BOM, body]) : body;
  }
  if (encoding === 'windows-1252' || encoding === 'latin1') {
    const notRepresentable = [...value].find((char) => char.codePointAt(0) > 0xff);
    if (notRepresentable) {
      throw new Error(`O caractere "${notRepresentable}" não existe em Windows-1252. Salve como UTF-8.`);
    }
    return Buffer.from(value, 'latin1');
  }
  throw new Error(`Encoding não suportado para salvar: ${encoding}`);
}

function encodingLabel(encoding) {
  const labels = {
    utf8: 'UTF-8',
    'windows-1252': 'Windows-1252',
    utf16le: 'UTF-16 LE',
    utf16be: 'UTF-16 BE',
    binary: 'Binário',
    unknown: 'Desconhecido',
  };
  return labels[encoding] || encoding || 'UTF-8';
}

module.exports = {
  decodeBuffer,
  encodeBuffer,
  detectEol,
  normalizeEol,
  encodingLabel,
};
