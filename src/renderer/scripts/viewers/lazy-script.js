/**
 * Carrega bundles UMD de vendor/ sob demanda (docx-preview, jszip, SheetJS).
 * O loader AMD do Monaco deixa window.define com .amd; os UMD tentariam se
 * registrar nele em vez de criar o global. Por isso escondemos define durante
 * a execução do script e restauramos em seguida.
 */

const loaded = new Map();

export function loadVendorScript(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    const savedDefine = window.define;
    window.define = undefined;
    const restore = () => { window.define = savedDefine; };
    script.onload = () => {
      restore();
      if (globalName && !window[globalName]) reject(new Error(`${src} não expôs ${globalName}`));
      else resolve(globalName ? window[globalName] : undefined);
    };
    script.onerror = () => { restore(); loaded.delete(src); reject(new Error(`Falha ao carregar ${src}`)); };
    document.head.appendChild(script);
  });
  loaded.set(src, p);
  return p;
}

export async function loadDocxPreview() {
  await loadVendorScript('vendor/jszip/jszip.min.js', 'JSZip');
  return loadVendorScript('vendor/docx-preview/docx-preview.min.js', 'docx');
}

export function loadSheetJS() {
  return loadVendorScript('vendor/xlsx/xlsx.full.min.js', 'XLSX');
}
