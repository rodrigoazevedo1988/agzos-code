/**
 * Lista de risco de comandos do agente. Comando que bate aqui sempre pede OK,
 * em qualquer modo (inclusive `auto` e mesmo com "Permitir sempre").
 */

// Alvo "raiz": /, ~, $HOME, /*, C:\, C:/, %USERPROFILE%, $env:USERPROFILE, ., .., *
const ROOT_TARGET = String.raw`(?:\/\*?|~\/?\*?|\$HOME\/?\*?|\$\{HOME\}\/?|[A-Za-z]:[\\\/]?\*?|%USERPROFILE%|%SYSTEMDRIVE%\\?|\$env:USERPROFILE|\$env:SystemDrive\\?|\.\/?|\.\.\/?|\*)`;
const END = String.raw`(?=$|[\s;&|)"'])`;

const RULES = [
  {
    reason: 'rm -rf em raiz/home',
    test: (c) => {
      const re = /(?:^|[\s;&|(])rm\s+((?:-{1,2}[\w-]+\s+)*)(.*)/g;
      let m;
      while ((m = re.exec(c))) {
        const flags = m[1];
        if (!/(?:^|\s)-[a-zA-Z]*[rR]|--recursive/.test(flags)) continue;
        const target = new RegExp(String.raw`^(?:"|')?${ROOT_TARGET}(?:"|')?${END}`);
        if (m[2].split(/\s+/).some((arg) => target.test(arg))) return true;
        if (/--no-preserve-root/.test(c)) return true;
      }
      return false;
    },
  },
  { reason: 'del /s em raiz', re: new RegExp(String.raw`(?:^|[\s;&|])(?:del|erase|rd|rmdir)\s+(?:\/\w\s+)*\/s\b.*?\s${ROOT_TARGET}${END}`, 'i') },
  { reason: 'del /s em raiz', re: new RegExp(String.raw`(?:^|[\s;&|])(?:del|erase|rd|rmdir)\s+${ROOT_TARGET}\s+.*\/s\b`, 'i') },
  { reason: 'Remove-Item -Recurse em raiz', re: new RegExp(String.raw`(?:remove-item|\bri\b|\brm\b|\bdel\b)\b[^;|&]*-r(?:ecurse)?\b[^;|&]*\s${ROOT_TARGET}${END}`, 'i') },
  { reason: 'Remove-Item -Recurse em raiz', re: new RegExp(String.raw`(?:remove-item|\bri\b)\s+(?:-path\s+)?["']?${ROOT_TARGET}["']?\s[^;|&]*-r(?:ecurse)?\b`, 'i') },
  { reason: 'format de disco', re: /(?:^|[\s;&|])format(?:\.com)?\s+[a-z]:/i },
  { reason: 'format de disco', re: /(?:^|[\s;&|])format-volume\b/i },
  { reason: 'mkfs', re: /(?:^|[\s;&|])mkfs(?:\.\w+)?\b/i },
  { reason: 'dd em dispositivo', re: /(?:^|[\s;&|])dd\b[^;|&]*\bof=\/dev\//i },
  { reason: 'git push --force', re: /\bgit\b[^;|&]*\bpush\b[^;|&]*(?:\s--force(?:-with-lease)?\b|\s-f\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S)/ },
  { reason: 'git reset --hard', re: /\bgit\b[^;|&]*\breset\b[^;|&]*--hard\b/ },
  { reason: 'git clean -fd', re: /\bgit\b[^;|&]*\bclean\b[^;|&]*\s-[a-zA-Z]*f/ },
  { reason: 'desligar/reiniciar o sistema', re: /(?:^|[\s;&|])(?:shutdown|reboot|halt|poweroff|stop-computer|restart-computer)\b/i },
  { reason: 'download executado no shell', re: /\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i },
  { reason: 'download executado no shell', re: /\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget)\b[^|;]*\|\s*(?:iex|invoke-expression)\b/i },
  { reason: 'download executado no shell', re: /\b(?:iex|invoke-expression)\b\s*\(?\s*\(?\s*(?:new-object\s+net\.webclient|iwr|irm|invoke-webrequest|invoke-restmethod)/i },
  { reason: 'fork bomb', re: /:\(\)\s*\{\s*:\|:&\s*\};:/ },
];

/** Retorna { risky, reason } para um comando de shell. */
function assessCommand(command) {
  const c = String(command || '');
  for (const rule of RULES) {
    const hit = rule.re ? rule.re.test(c) : rule.test(c);
    if (hit) return { risky: true, reason: rule.reason };
  }
  return { risky: false, reason: null };
}

module.exports = { assessCommand };
