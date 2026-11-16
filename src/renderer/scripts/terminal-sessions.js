/**
 * Estado puro do terminal multi-sessão (sem DOM/xterm/IPC), testável em Node.
 *
 * - Sessões: { id, title, groupId, ...extras } (extras = o que o chamador guardar).
 * - Grupos: [{ id, sessionIds }]. Um grupo com mais de uma sessão = terminal
 *   dividido (sessões lado a lado). Só o grupo ativo fica visível.
 * - A ordem de exibição (lista lateral, Ctrl+PageUp/PageDown) é a ordem dos
 *   grupos e, dentro de cada grupo, a ordem das sessões.
 */

export function createSessionStore() {
  const sessions = new Map();
  let groups = [];
  let activeSessionId = null;
  let seq = 0;

  const groupOf = (id) => groups.find((g) => g.sessionIds.includes(id)) || null;

  const store = {
    get size() { return sessions.size; },
    get activeSessionId() { return activeSessionId; },
    get activeGroupId() { return activeSessionId ? groupOf(activeSessionId)?.id ?? null : null; },
    get groups() { return groups.map((g) => ({ id: g.id, sessionIds: [...g.sessionIds] })); },

    get(id) { return sessions.get(id) || null; },
    active() { return activeSessionId ? sessions.get(activeSessionId) || null : null; },
    has(id) { return sessions.has(id); },

    /** Próximo id local ('t1', 't2', …). */
    nextId() { seq += 1; return `t${seq}`; },

    /**
     * Adiciona uma sessão e a torna ativa. Com split=true entra no grupo da
     * sessão ativa, logo depois dela; senão abre um grupo novo no fim.
     */
    add(session, { split = false } = {}) {
      if (!session || !session.id || sessions.has(session.id)) throw new Error('sessão inválida');
      const activeGroup = split && activeSessionId ? groupOf(activeSessionId) : null;
      let group;
      if (activeGroup) {
        group = activeGroup;
        const at = group.sessionIds.indexOf(activeSessionId);
        group.sessionIds.splice(at + 1, 0, session.id);
      } else {
        group = { id: `g${session.id}`, sessionIds: [session.id] };
        groups.push(group);
      }
      session.groupId = group.id;
      sessions.set(session.id, session);
      activeSessionId = session.id;
      return session;
    },

    /**
     * Remove a sessão. Escolhe a próxima ativa: vizinha no mesmo grupo,
     * senão o grupo anterior (ou o seguinte). Devolve { removed, nextActiveId }.
     */
    remove(id) {
      const session = sessions.get(id);
      if (!session) return { removed: null, nextActiveId: activeSessionId };
      const gIdx = groups.findIndex((g) => g.sessionIds.includes(id));
      const group = groups[gIdx];
      const sIdx = group.sessionIds.indexOf(id);
      group.sessionIds.splice(sIdx, 1);
      sessions.delete(id);

      if (activeSessionId === id) {
        if (group.sessionIds.length) {
          activeSessionId = group.sessionIds[Math.max(0, sIdx - 1)];
        } else {
          const neighbor = groups[gIdx - 1] || groups[gIdx + 1] || null;
          activeSessionId = neighbor ? neighbor.sessionIds[0] : null;
        }
      }
      if (!group.sessionIds.length) groups.splice(gIdx, 1);
      return { removed: session, nextActiveId: activeSessionId };
    },

    activate(id) {
      if (!sessions.has(id)) return false;
      activeSessionId = id;
      return true;
    },

    rename(id, title) {
      const s = sessions.get(id);
      const clean = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!s || !clean) return false;
      s.title = clean;
      s.renamed = true;
      return true;
    },

    /** Sessões na ordem de exibição. */
    ordered() {
      return groups.flatMap((g) => g.sessionIds.map((sid) => sessions.get(sid)));
    },

    /** Sessões do grupo ativo (as visíveis). */
    visible() {
      const g = activeSessionId ? groupOf(activeSessionId) : null;
      return g ? g.sessionIds.map((sid) => sessions.get(sid)) : [];
    },

    /** Id da sessão seguinte (dir=1) ou anterior (dir=-1), circular. */
    cycle(dir = 1) {
      const order = groups.flatMap((g) => g.sessionIds);
      if (!order.length) return null;
      const at = order.indexOf(activeSessionId);
      const next = order[((at < 0 ? 0 : at) + (dir < 0 ? -1 : 1) + order.length) % order.length];
      activeSessionId = next;
      return next;
    },

    /** Linhas da lista lateral: sessão + posição no grupo (para o traço de divisão). */
    rows() {
      return groups.flatMap((g) => g.sessionIds.map((sid, i) => ({
        session: sessions.get(sid),
        groupId: g.id,
        groupSize: g.sessionIds.length,
        indexInGroup: i,
        glyph: splitGlyph(i, g.sessionIds.length),
        active: sid === activeSessionId,
      })));
    },
  };
  return store;
}

/** Traço que liga sessões do mesmo grupo na lista ('' quando não dividido). */
export function splitGlyph(index, size) {
  if (size < 2) return '';
  if (index === 0) return '┌';
  if (index === size - 1) return '└';
  return '├';
}

/**
 * Título padrão de uma sessão: rótulo do perfil, numerado quando já existe
 * outra sessão com o mesmo nome ("bash", "bash (2)", …).
 */
export function defaultTitle(label, existingTitles = []) {
  const base = String(label || 'Terminal').trim() || 'Terminal';
  const taken = new Set(existingTitles);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const t = `${base} (${n})`;
    if (!taken.has(t)) return t;
  }
  return base;
}

/**
 * Novos pesos de duas sessões vizinhas ao arrastar o divisor entre elas.
 * wa/wb = larguras atuais (px), weightA/weightB = pesos flex atuais.
 */
export function resizeSplit({ wa, wb, weightA, weightB, dx, min = 80 }) {
  const total = wa + wb;
  if (!(total > 0)) return { weightA, weightB };
  const lo = Math.min(min, total / 2);
  const na = Math.max(lo, Math.min(total - lo, wa + dx));
  const sum = weightA + weightB;
  return { weightA: (sum * na) / total, weightB: (sum * (total - na)) / total };
}

/** URL local de uma porta e rótulo de endereço amigável. */
export function portUrl(port) {
  return `http://localhost:${Number(port)}`;
}

export function portHostLabel(address) {
  const a = String(address || '').trim();
  if (!a || a === '*' || a === '0.0.0.0' || a === '::' || a === '[::]') return 'todas as interfaces';
  if (a === '127.0.0.1' || a === '::1' || a === '[::1]' || a === 'localhost') return 'somente local';
  return a;
}

/** Ordena e remove duplicatas (mesma porta em IPv4 e IPv6 vira uma linha). */
export function normalizePorts(list) {
  const byPort = new Map();
  for (const p of Array.isArray(list) ? list : []) {
    const port = Number(p?.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    const prev = byPort.get(port);
    if (!prev) {
      byPort.set(port, { port, address: p.address || '', pid: p.pid ?? null, process: p.process || '', addresses: [p.address || ''] });
    } else {
      if (!prev.addresses.includes(p.address || '')) prev.addresses.push(p.address || '');
      if (!prev.process && p.process) prev.process = p.process;
      if (prev.pid == null && p.pid != null) prev.pid = p.pid;
    }
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}
