(() => {
  "use strict";
  const CFG = Object.assign({ appName: "Vistoria Digital", empresa: "", cnpj: "", telefone: "", endereco: "", logo: "", numeroInicial: 1, corPrincipal: [27, 107, 63], supabaseUrl: "", supabaseKey: "", exigirLogin: false }, window.VISTORIA_CONFIG || {});
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const MAX_PHOTOS = 12, SIG_W = 800, SIG_H = 300;

  // ---------- utilidades e sanitização ----------
  // Só entram caracteres imprimíveis (ASCII + Latin-1); controles são removidos.
  const clean = (s, max = 200) => String(s ?? "").replace(/[^\x20-\x7E\u00A0-\u00FF]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const digits = s => String(s || "").replace(/\D/g, "");
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmtDate = iso => iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } }
  };
  function showMsg(box, text, ok) {
    if (!text) { box.hidden = true; return; }
    box.textContent = text; box.className = "msg" + (ok ? " ok" : ""); box.hidden = false;
  }
  function validator() {
    const v = { bad: [], first: null };
    v.fail = (label, node, cls = "invalid") => {
      v.bad.push(label);
      if (node) { node.classList.add(cls); const d = node.closest("details"); if (d) d.open = true; v.first = v.first || node; }
    };
    return v;
  }
  const clearMarks = () => $$(".invalid,.miss").forEach(n => n.classList.remove("invalid", "miss"));

  // ---------- marca ----------
  document.title = CFG.empresa ? `Vistoria - ${CFG.empresa}` : "Vistoria Digital";
  if (CFG.empresa) $("#brandName").textContent = CFG.empresa;
  let logoData = null;
  if (CFG.logo) {
    const im = $("#brandLogo");
    im.src = CFG.logo; im.hidden = false;
    im.onerror = () => { im.hidden = true; };
    fetch(CFG.logo).then(r => r.ok ? r.blob() : Promise.reject()).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))
      .then(d => { const i = new Image(); i.onload = () => { logoData = { d, w: i.naturalWidth, h: i.naturalHeight }; }; i.src = d; }).catch(() => {});
  }

  // ---------- armazenamento ----------
  // Com supabaseUrl + supabaseKey no config.js, as vistorias ficam na nuvem (acessíveis de qualquer aparelho).
  // Sem essas chaves, ficam só neste aparelho (IndexedDB).
  // exigirLogin: true pede e-mail e senha (Supabase Auth); false abre direto, sem login.
  const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseKey);
  const AUTH = CLOUD && !!CFG.exigirLogin;
  const newId = () => "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const errText = (err, fallback) =>
    (CLOUD && (!navigator.onLine || (err && err.name === "TypeError")))
      ? "Sem conexão com a internet. Os dados continuam na tela: tente de novo quando a conexão voltar."
      : fallback;

  // ----- local (IndexedDB, com fallback em memória) -----
  const DB_NAME = "vistoria-digital", OS = "vistorias";
  let dbPromise = null;
  const memory = new Map();
  function openDb() {
    if (!dbPromise) dbPromise = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("sem IndexedDB"));
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(OS, { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbPromise;
  }
  // Devolve null quando o aparelho não oferece IndexedDB (aí usamos a memória da aba).
  async function dbRun(mode, fn) {
    let db;
    try { db = await openDb(); } catch { return null; }
    return new Promise((res, rej) => {
      const t = db.transaction(OS, mode);
      const req = fn(t.objectStore(OS));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = t.onabort = () => rej(t.error);
    });
  }
  const localPut = async rec => { const r = await dbRun("readwrite", s => s.put(rec)); if (r === null) memory.set(rec.id, rec); };
  const localRepo = {
    async list() { const r = await dbRun("readonly", s => s.getAll()); return r ?? [...memory.values()]; },
    async get(id) { const r = await dbRun("readonly", s => s.get(id)); return r ?? memory.get(id) ?? null; },
    async create(rec) { const n = nextNum(); rec.numero = n; await localPut(rec); store.set("vd_next", String(n + 1)); return rec; },
    async update(rec) { await localPut(rec); return rec; },
    async del(id) { const r = await dbRun("readwrite", s => s.delete(id)); if (r === null) memory.delete(id); }
  };

  // ----- nuvem (Supabase: login + banco, via fetch; sem biblioteca externa) -----
  const SB = String(CFG.supabaseUrl || "").replace(/\/+$/, "");
  const SESSION_KEY = "vd_session";
  let session = null;
  try { session = JSON.parse(store.get(SESSION_KEY) || "null"); } catch { session = null; }
  const saveSession = ss => {
    session = ss;
    if (ss) store.set(SESSION_KEY, JSON.stringify(ss));
    else { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignora */ } }
  };
  let onAuthLost = () => {};
  async function authCall(grant, body) {
    const r = await fetch(`${SB}/auth/v1/token?grant_type=${grant}`, {
      method: "POST", headers: { apikey: CFG.supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error("auth " + r.status); e.status = r.status; throw e; }
    return { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || "" };
  }
  async function refreshSession() {
    if (!session || !session.refresh) { const e = new Error("sem sessão"); e.status = 401; throw e; }
    try {
      const n = await authCall("refresh_token", { refresh_token: session.refresh });
      n.email = n.email || session.email; saveSession(n);
    } catch (e) {
      if (e.status && e.status < 500) { saveSession(null); onAuthLost(); }   // sessão recusada: volta ao login
      throw e;
    }
  }
  async function api(path, { method = "GET", body, prefer, retry = true } = {}) {
    const headers = { apikey: CFG.supabaseKey };
    if (AUTH) {
      if (!session) { const e = new Error("sem sessão"); e.status = 401; throw e; }
      if (session.exp - Date.now() < 60000) await refreshSession();
      headers.Authorization = "Bearer " + session.access;
    } else if (/^eyJ/.test(CFG.supabaseKey)) {
      headers.Authorization = "Bearer " + CFG.supabaseKey;   // chave anon no formato JWT (as novas "sb_publishable_" vão só no apikey)
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer) headers.Prefer = prefer;
    const r = await fetch(`${SB}/rest/v1/${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (r.status === 401 && retry && AUTH) { await refreshSession(); return api(path, { method, body, prefer, retry: false }); }
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const LIGHT = "id,numero,status,criado_em,finalizado_em,placa,veiculo,cliente";
  const lightToRec = r => ({ id: r.id, numero: r.numero, status: r.status, criadoEm: r.criado_em, finalizadoEm: r.finalizado_em, dados: { placa: r.placa, veiculo: r.veiculo, cliente: r.cliente } });
  // O "doc" guarda tudo, menos as fotos (elas ficam em linhas próprias para não estourar o tamanho das requisições).
  const docOf = rec => {
    const { id, numero, status, criadoEm, finalizadoEm, fotos, ...doc } = rec;
    if (doc.entrega) { const { fotos: _f, ...e } = doc.entrega; doc.entrega = e; }
    return doc;
  };
  async function uploadFotos(id, etapa, list) {
    for (let i = 0; i < list.length; i += 2) {
      const rows = list.slice(i, i + 2).map((p, j) => ({ vistoria_id: id, etapa, ordem: i + j, w: p.w, h: p.h, data: p.d }));
      await api("vistoria_fotos", { method: "POST", body: rows, prefer: "return=minimal" });
    }
  }
  const eq = id => "eq." + encodeURIComponent(id);
  const cloudRepo = {
    async list() { const rows = await api(`vistorias?select=${LIGHT}&order=criado_em.desc`); return (rows || []).map(lightToRec); },
    async get(id) {
      const rows = await api(`vistorias?id=${eq(id)}&select=*`);
      if (!rows || !rows[0]) return null;
      const row = rows[0], doc = row.doc || {};
      const fotos = await api(`vistoria_fotos?vistoria_id=${eq(id)}&select=etapa,ordem,w,h,data&order=ordem.asc`) || [];
      const pick = et => fotos.filter(f => f.etapa === et).map(f => ({ d: f.data, w: f.w, h: f.h }));
      const rec = { ...doc, id: row.id, numero: row.numero, status: row.status, criadoEm: row.criado_em, finalizadoEm: row.finalizado_em, fotos: pick("retirada") };
      if (doc.entrega) rec.entrega = { ...doc.entrega, fotos: pick("entrega") };
      return rec;
    },
    async create(rec) {
      const row = { id: rec.id, status: rec.status, criado_em: rec.criadoEm, placa: rec.dados.placa, veiculo: rec.dados.veiculo, cliente: rec.dados.cliente, doc: docOf(rec) };
      const out = await api("vistorias", { method: "POST", body: row, prefer: "return=representation" });
      rec.numero = out[0].numero;
      try { await uploadFotos(rec.id, "retirada", rec.fotos || []); }
      catch (e) { await api(`vistorias?id=${eq(rec.id)}`, { method: "DELETE" }).catch(() => {}); throw e; }   // não deixa retirada pela metade
      return rec;
    },
    async update(rec) {
      // Fotos da entrega primeiro; só depois muda o status. Se algo falhar, a vistoria continua em andamento.
      await api(`vistoria_fotos?vistoria_id=${eq(rec.id)}&etapa=eq.entrega`, { method: "DELETE" });
      await uploadFotos(rec.id, "entrega", (rec.entrega && rec.entrega.fotos) || []);
      await api(`vistorias?id=${eq(rec.id)}`, { method: "PATCH", body: { status: rec.status, finalizado_em: rec.finalizadoEm || null, doc: docOf(rec) } });
      return rec;
    },
    async del(id) { await api(`vistorias?id=${eq(id)}`, { method: "DELETE" }); }
  };
  const repo = CLOUD ? cloudRepo : localRepo;

  // ---------- número da vistoria ----------
  const nextNum = () => { const n = parseInt(store.get("vd_next") || CFG.numeroInicial, 10); return Number.isFinite(n) && n > 0 ? n : 1; };
  const refreshNum = () => {
    if (CLOUD) { $("#numHint").textContent = "O número da vistoria é gerado automaticamente ao salvar."; return; }
    $("#proxNum").textContent = String(nextNum());
  };

  // ---------- máscaras ----------
  $("#placa").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7); });
  $("#km").addEventListener("input", e => { e.target.value = digits(e.target.value).slice(0, 9); });
  const phoneMask = e => {
    const d = digits(e.target.value).slice(0, 11);
    let o = d;
    if (d.length > 6) o = `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
    else if (d.length > 2) o = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    e.target.value = o;
  };
  $("#telefone").addEventListener("input", phoneMask);
  $("#telRet").addEventListener("input", phoneMask);
  const rgMask = e => { e.target.value = e.target.value.replace(/[^0-9A-Za-z.\-\/ ]/g, "").slice(0, 20); };
  $("#rgRet").addEventListener("input", rgMask);
  $("#entRg").addEventListener("input", rgMask);

  // ---------- checklist (Tem / Falta / N/A, padrão N/A) ----------
  const ITENS = ["Documentos", "Chave do veículo", "Cartão Code", "Rádio", "Rádio Central Multimídia", "Tapetes", "Extintor", "Antena", "Calota", "Rodas de Ferro", "Rodas de liga leve", "Estepe", "Macaco", "Triângulo", "Chave de Roda"];
  const ck = [];
  const resetChecklist = () => { ck.length = 0; ITENS.forEach(name => ck.push({ name, val: "na" })); renderChecklist(); };
  const CK_OPTS = [["ok", "✅ Tem"], ["falta", "❌ Falta"], ["na", "N/A"]];
  const checklistEl = $("#checklist");
  function renderChecklist() {
    checklistEl.textContent = "";
    ck.forEach(it => {
      const row = el("div", "ck");
      const seg = el("div", "seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", it.name);
      CK_OPTS.forEach(([val, label]) => {
        const b = el("button", "seg-opt", label); b.type = "button";
        b.setAttribute("aria-pressed", String(it.val === val));
        if (it.val === val) b.classList.add("on-" + val);
        b.addEventListener("click", () => { it.val = val; renderChecklist(); });
        seg.append(b);
      });
      row.append(el("span", "ck-name", it.name), seg);
      checklistEl.append(row);
    });
  }
  $("#addItem").addEventListener("click", () => {
    const inp = $("#novoItem"); const n = clean(inp.value, 40);
    if (!n || ck.length >= 30) return;
    ck.push({ name: n, val: "na" }); inp.value = ""; renderChecklist();
  });

  // ---------- desenhos do veículo e avarias ----------
  const VIEWS = [
    { key: "frente", label: "Frente", w: 500, h: 340 },
    { key: "tras", label: "Trás", w: 500, h: 340 },
    { key: "esq", label: "Lat. Esquerda", w: 800, h: 340 },
    { key: "dir", label: "Lat. Direita", w: 800, h: 340 }
  ];
  let curView = VIEWS[0];
  const draftDamages = []; // {view, x, y, text}

  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function wheel(ctx, cx, cy) {
    ctx.beginPath(); ctx.arc(cx, cy, 52, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 44, 0, 7); ctx.fillStyle = "#e9ecea"; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 24, 0, 7); ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 7); ctx.fillStyle = "#222"; ctx.fill();
  }
  function drawSide(ctx, flip) {
    ctx.save(); if (flip) { ctx.translate(800, 0); ctx.scale(-1, 1); }
    ctx.beginPath(); ctx.moveTo(60, 245); ctx.lineTo(60, 185); ctx.quadraticCurveTo(64, 155, 120, 150); ctx.lineTo(225, 144);
    ctx.quadraticCurveTo(285, 72, 365, 66); ctx.lineTo(520, 66); ctx.quadraticCurveTo(600, 72, 655, 142); ctx.lineTo(725, 160);
    ctx.quadraticCurveTo(765, 170, 770, 208); ctx.lineTo(770, 245); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(250, 142); ctx.quadraticCurveTo(300, 90, 365, 84); ctx.lineTo(448, 84); ctx.lineTo(448, 142); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(462, 84); ctx.lineTo(520, 84); ctx.quadraticCurveTo(580, 90, 625, 142); ctx.lineTo(462, 142); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(455, 84); ctx.lineTo(455, 235); ctx.moveTo(250, 142); ctx.lineTo(250, 235); ctx.moveTo(645, 160); ctx.lineTo(630, 235); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(405, 175); ctx.lineTo(435, 175); ctx.moveTo(500, 175); ctx.lineTo(530, 175); ctx.stroke();
    rr(ctx, 706, 172, 50, 18, 8); ctx.stroke(); rr(ctx, 62, 168, 28, 20, 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(60, 232); ctx.lineTo(770, 232); ctx.stroke();
    wheel(ctx, 190, 245); wheel(ctx, 610, 245);
    ctx.restore();
  }
  function drawFrontRear(ctx, rear) {
    rr(ctx, 90, 165, 320, 110, 34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(135, 165); ctx.lineTo(160, 76); ctx.quadraticCurveTo(250, 56, 340, 76); ctx.lineTo(365, 165); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(170, 158); ctx.lineTo(186, 92); ctx.quadraticCurveTo(250, 80, 314, 92); ctx.lineTo(330, 158); ctx.closePath(); ctx.stroke();
    rr(ctx, 70, 118, 34, 26, 8); ctx.stroke(); rr(ctx, 396, 118, 34, 26, 8); ctx.stroke();
    rr(ctx, 104, 178, 76, 28, 10); ctx.stroke(); rr(ctx, 320, 178, 76, 28, 10); ctx.stroke();
    if (!rear) { rr(ctx, 196, 182, 108, 30, 8); ctx.stroke(); ctx.beginPath(); for (let x = 214; x < 300; x += 18) { ctx.moveTo(x, 186); ctx.lineTo(x, 208); } ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(150, 165); ctx.lineTo(350, 165); ctx.stroke(); rr(ctx, 232, 172, 36, 10, 4); ctx.stroke(); }
    rr(ctx, 196, 222, 108, 34, 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(100, 262); ctx.lineTo(400, 262); ctx.stroke();
    rr(ctx, 74, 250, 38, 74, 8); ctx.fillStyle = "#e9ecea"; ctx.fill(); ctx.stroke();
    rr(ctx, 388, 250, 38, 74, 8); ctx.fill(); ctx.stroke();
  }
  function drawMarker(ctx, x, y, n) {
    ctx.beginPath(); ctx.arc(x, y, 17, 0, 7); ctx.fillStyle = "#b3261e"; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "bold 18px Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(n), x, y + 1);
  }
  // Desenha uma vista com as avarias informadas (usado na tela e no PDF).
  function renderView(view, canvas, list) {
    canvas.width = view.w; canvas.height = view.h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, view.w, view.h);
    ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = "#1d2420";
    if (view.key === "dir") drawSide(ctx, false); else if (view.key === "esq") drawSide(ctx, true); else drawFrontRear(ctx, view.key === "tras");
    list.forEach((d, i) => { if (d.view === view.key) drawMarker(ctx, d.x * view.w, d.y * view.h, i + 1); });
  }

  const canvas = $("#carCanvas");
  const drawCurrent = () => renderView(curView, canvas, draftDamages);
  const viewTabs = $("#viewTabs");
  VIEWS.forEach(v => {
    const b = el("button", "tab", v.label); b.type = "button"; b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(v === curView));
    b.addEventListener("click", () => { curView = v; [...viewTabs.children].forEach(c => c.setAttribute("aria-selected", String(c === b))); drawCurrent(); });
    viewTabs.append(b);
  });
  canvas.addEventListener("click", e => {
    if (draftDamages.length >= 40) return;
    const r = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const t = clean($("#tipoAvaria").value, 30), o = clean($("#obsAvaria").value, 60);
    draftDamages.push({ view: curView.key, x, y, text: o ? `${t} - ${o}` : t });
    $("#obsAvaria").value = ""; drawCurrent(); renderDamages();
  });
  function renderDamages() {
    const ol = $("#damageList"); ol.textContent = "";
    draftDamages.forEach((d, i) => {
      const li = el("li");
      const n = el("span", "dnum", String(i + 1));
      const t = el("span", "dtxt", d.text + " ");
      t.append(el("span", "dview", "(" + VIEWS.find(v => v.key === d.view).label + ")"));
      const x = el("button", "del", "Remover"); x.type = "button"; x.setAttribute("aria-label", "Remover avaria " + (i + 1));
      x.addEventListener("click", () => { draftDamages.splice(i, 1); drawCurrent(); renderDamages(); });
      li.append(n, t, x); ol.append(li);
    });
    $("#noDamage").hidden = draftDamages.length > 0;
  }
  $("#btnAvaria").addEventListener("click", () => {
    const p = $("#avariaPanel"); p.hidden = !p.hidden;
    $("#btnAvaria").textContent = p.hidden ? "🚨 Registrar Avaria" : "✖ Fechar painel de avarias";
    if (!p.hidden) drawCurrent();
  });

  // ---------- fotos ----------
  const isImg = h =>
    (h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) ||
    (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47) ||
    (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50);
  async function processPhoto(file, stamp) {
    if (file.size > 30 * 1024 * 1024) throw new Error("Foto muito grande (máx. 30 MB).");
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!isImg(head)) throw new Error("Arquivo não é uma imagem válida (use JPG, PNG ou WEBP).");
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { bmp = await createImageBitmap(file); }
    const s = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    if (stamp) {
      const txt = new Date().toLocaleString("pt-BR"); const fs = Math.max(14, Math.round(w / 45));
      ctx.font = `bold ${fs}px Arial, sans-serif`; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      ctx.lineWidth = Math.max(3, fs / 5); ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.fillStyle = "#fff";
      ctx.strokeText(txt, w - 10, h - 8); ctx.fillText(txt, w - 10, h - 8);
    }
    return { d: c.toDataURL("image/jpeg", 0.8), w, h };
  }
  function renderPhotoGrid(grid, list) {
    grid.textContent = "";
    list.forEach((p, i) => {
      const box = el("div", "ph");
      const im = el("img"); im.src = p.d; im.alt = "Foto " + (i + 1);
      const x = el("button", null, "×"); x.type = "button"; x.setAttribute("aria-label", "Remover foto " + (i + 1));
      x.addEventListener("click", () => { list.splice(i, 1); renderPhotoGrid(grid, list); });
      box.append(im, x); grid.append(box);
    });
  }
  async function onFiles(e, list, grid, stamp, msgBox) {
    const files = [...e.target.files]; e.target.value = "";
    const errs = [];
    for (const f of files) {
      if (list.length >= MAX_PHOTOS) { errs.push(`Limite de ${MAX_PHOTOS} fotos.`); break; }
      try { list.push(await processPhoto(f, stamp)); } catch (err) { errs.push(clean(err.message, 120) || "Não foi possível ler uma foto."); }
    }
    renderPhotoGrid(grid, list);
    showMsg(msgBox, errs.length ? [...new Set(errs)].join(" ") : "");
  }
  const draftFotos = [];
  const entFotos = [];
  $("#fotosCam").addEventListener("change", e => onFiles(e, draftFotos, $("#photoGrid"), $("#carimbo").checked, $("#msgRet")));
  $("#fotosGal").addEventListener("change", e => onFiles(e, draftFotos, $("#photoGrid"), $("#carimbo").checked, $("#msgRet")));
  $("#entCam").addEventListener("change", e => onFiles(e, entFotos, $("#entPhotoGrid"), true, $("#entMsg")));
  $("#entGal").addEventListener("change", e => onFiles(e, entFotos, $("#entPhotoGrid"), true, $("#entMsg")));

  // ---------- assinaturas (desenhar, depois confirmar) ----------
  const sigs = {};
  function makeSig(key, title) {
    const root = $(`[data-sig="${key}"]`);
    root.textContent = "";
    const c = document.createElement("canvas"); c.width = SIG_W; c.height = SIG_H; c.setAttribute("aria-label", title);
    const status = el("p", "signature-status", "Ainda não assinado");
    const clr = el("button", "btn btn-text btn-small", "Limpar"); clr.type = "button";
    const conf = el("button", "btn btn-primary btn-small", "Confirmar Assinatura"); conf.type = "button";
    root.append(el("div", "sig-title", title), c, el("div", "sig-actions", null), status);
    root.querySelector(".sig-actions").append(clr, conf);
    const ctx = c.getContext("2d"); ctx.lineWidth = 3.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
    const st = {
      root, ink: false, ok: false, drawing: false, last: null,
      render() {
        conf.textContent = st.ok ? "Editar Assinatura" : "Confirmar Assinatura";
        clr.disabled = st.ok;
        status.textContent = st.ok ? "✓ Assinado e confirmado" : st.ink ? "Assinatura desenhada: toque em Confirmar" : "Ainda não assinado";
        root.classList.toggle("signed", st.ok);
      },
      clear() { ctx.clearRect(0, 0, SIG_W, SIG_H); st.ink = false; st.ok = false; st.render(); },
      image() { return st.ok ? c.toDataURL("image/png") : null; }
    };
    sigs[key] = st;
    const pos = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; };
    c.addEventListener("pointerdown", e => {
      if (st.ok) return;
      st.drawing = true; c.setPointerCapture(e.pointerId); st.last = pos(e);
      ctx.beginPath(); ctx.arc(st.last.x, st.last.y, 1.6, 0, 7); ctx.fillStyle = "#111"; ctx.fill();
      st.ink = true; root.classList.remove("miss"); st.render(); e.preventDefault();
    });
    c.addEventListener("pointermove", e => {
      if (!st.drawing) return;
      const p = pos(e); ctx.beginPath(); ctx.moveTo(st.last.x, st.last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); st.last = p; e.preventDefault();
    });
    const end = () => { st.drawing = false; };
    c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
    clr.addEventListener("click", () => st.clear());
    conf.addEventListener("click", () => {
      if (st.ok) st.ok = false;
      else if (!st.ink) { root.classList.add("miss"); status.textContent = "Desenhe a assinatura antes de confirmar."; return; }
      else st.ok = true;
      st.render();
    });
    st.render();
    return st;
  }
  makeSig("ret", "Assinatura do responsável pela retirada");
  makeSig("mot", "Assinatura do motorista / vistoriador");
  makeSig("ent", "Assinatura do responsável pela entrega");

  // ---------- estado do formulário de retirada ----------
  function resetRetirada() {
    $("#form-retirada").reset();
    draftDamages.length = 0; draftFotos.length = 0;
    renderDamages(); drawCurrent(); renderPhotoGrid($("#photoGrid"), draftFotos);
    resetChecklist();
    sigs.ret.clear(); sigs.mot.clear();
    $("#avariaPanel").hidden = true; $("#btnAvaria").textContent = "🚨 Registrar Avaria";
    clearMarks(); showMsg($("#msgRet"), "");
    refreshNum();
  }

  // ---------- navegação ----------
  // view = seção a mostrar; tab = aba que fica destacada no topo.
  function show(view, tab) {
    $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
    $$(".tab-btn").forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on));
    });
    window.scrollTo(0, 0);
  }
  async function refreshBadge() {
    try {
      if (AUTH && !session) return;
      const n = (await repo.list()).filter(r => r.status === "andamento").length;
      const b = $("#badgeAnd"); b.textContent = String(n); b.hidden = n === 0;
    } catch { /* badge é só informativo */ }
  }
  const goAndamento = async () => { show("andamento", "andamento"); await renderAndamento(); };
  const goFinalizada = async () => { show("finalizada", "finalizada"); await renderFinalizada(); };
  $$(".tab-btn").forEach(b => b.addEventListener("click", () => {
    const t = b.dataset.tab;
    if (t === "novo") { show("novo", "novo"); refreshNum(); }
    else if (t === "andamento") goAndamento();
    else goFinalizada();
  }));

  // ---------- salvar retirada ----------
  function validateRetirada() {
    const v = validator();
    const val = id => clean($("#" + id).value);
    if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(val("placa"))) v.fail("Placa válida (ex.: ABC1D23)", $("#placa"));
    if (!val("motorista")) v.fail("Motorista / Vistoriador", $("#motorista"));
    const tel = digits($("#telefone").value);
    if (tel && tel.length < 10) v.fail("Telefone do cliente completo", $("#telefone"));
    const telRet = digits($("#telRet").value);
    if (telRet && telRet.length < 10) v.fail("Telefone do responsável completo", $("#telRet"));
    if (!val("nomeRet")) v.fail("Nome do responsável pela retirada", $("#nomeRet"));
    if (!sigs.ret.ok) v.fail("Assinatura do responsável pela retirada", sigs.ret.root, "miss");
    if (!sigs.mot.ok) v.fail("Assinatura do motorista / vistoriador", sigs.mot.root, "miss");
    if (!$("#lgpd").checked) v.fail("Aceite do uso dos dados", $("#lgpd"));
    return v;
  }
  $("#form-retirada").addEventListener("submit", async e => {
    e.preventDefault();
    if (typeof window.jspdf === "undefined") { showMsg($("#msgRet"), "Biblioteca de PDF não carregou. Recarregue a página."); return; }
    clearMarks();
    const v = validateRetirada();
    if (v.bad.length) {
      showMsg($("#msgRet"), "Falta preencher: " + v.bad.join("; ") + ".");
      if (v.first) v.first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const btn = $("#salvarRet"); btn.disabled = true; btn.textContent = "Salvando...";
    try {
      const val = id => clean($("#" + id).value);
      const rec = {
        id: newId(), numero: null, status: "andamento", criadoEm: new Date().toISOString(),
        dados: {
          placa: val("placa"), veiculo: val("veiculo"), motorista: val("motorista"), cliente: val("cliente"),
          telefone: $("#telefone").value, retirada: val("retirada"), entrega: val("entrega"),
          km: digits($("#km").value), combustivel: $("#combustivel").value,
          obs: clean($("#obs").value, 500), obsColeta: clean($("#obsColeta").value, 500)
        },
        checklist: ck.map(({ name, val }) => ({ name, val })),
        avarias: draftDamages.map(d => ({ ...d })),
        fotos: draftFotos.map(p => ({ ...p })),
        responsavel: { nome: val("nomeRet"), rg: clean($("#rgRet").value, 20), telefone: $("#telRet").value, assinatura: sigs.ret.image() },
        motorista: { nome: val("motorista"), assinatura: sigs.mot.image() },
        entrega: null
      };
      await repo.create(rec);
      const numero = rec.numero;
      resetRetirada();
      $("#sucessoTxt").textContent = `Vistoria Nº ${numero} (${rec.dados.placa}) foi salva em Em Andamento. Quando o carro for devolvido, registre a entrega por lá.`;
      show("sucesso", "novo");
      refreshBadge();
    } catch (err) {
      showMsg($("#msgRet"), errText(err, CLOUD ? "Não foi possível salvar. Tente novamente." : "Não foi possível salvar neste aparelho. Tente novamente."));
    } finally {
      btn.disabled = false; btn.textContent = "💾 Salvar Retirada";
    }
  });
  $("#goAnd").addEventListener("click", goAndamento);
  $("#goNovo").addEventListener("click", () => { show("novo", "novo"); refreshNum(); });

  // ---------- listas ----------
  function itemButton(rec, onClick) {
    const b = el("button", "li"); b.type = "button";
    const body = el("div", "li-body");
    const sub = [rec.dados.veiculo, rec.dados.cliente, fmtDate(rec.criadoEm)].filter(Boolean).join(" · ");
    body.append(el("div", "li-title", `Nº ${rec.numero} · ${rec.dados.placa}`), el("div", "li-sub", sub));
    b.append(body, el("span", "li-chev", "›"));
    b.addEventListener("click", onClick);
    return b;
  }
  const byRecent = (a, b) => (a.criadoEm < b.criadoEm ? 1 : -1);
  async function renderAndamento() {
    const box = $("#andList"); box.textContent = "";
    let lst;
    try { lst = (await repo.list()).filter(r => r.status === "andamento").sort(byRecent); }
    catch (err) { box.append(el("p", "empty", errText(err, "Não foi possível carregar as vistorias. Tente de novo."))); return; }
    refreshBadge();
    if (!lst.length) box.append(el("p", "empty", "Nenhuma retirada em andamento."));
    lst.forEach(rec => box.append(itemButton(rec, () => openEntrega(rec.id))));
  }
  async function renderFinalizada() {
    const box = $("#finList"); box.textContent = "";
    let lst;
    try { lst = (await repo.list()).filter(r => r.status === "finalizada").sort(byRecent); }
    catch (err) { box.append(el("p", "empty", errText(err, "Não foi possível carregar as vistorias. Tente de novo."))); return; }
    if (!lst.length) box.append(el("p", "empty", "Nenhuma vistoria finalizada ainda."));
    lst.forEach(rec => box.append(itemButton(rec, () => openDetalhe(rec.id))));
  }

  // ---------- entrega (finalizar) ----------
  let curId = null;
  async function openEntrega(id) {
    let rec;
    try { rec = await repo.get(id); } catch (err) { alert(errText(err, "Não foi possível abrir a vistoria. Tente de novo.")); return; }
    if (!rec) { alert("Essa vistoria não existe mais."); goAndamento(); return; }
    curId = id;
    $("#form-entrega").reset();
    entFotos.length = 0; renderPhotoGrid($("#entPhotoGrid"), entFotos);
    $("#entLocal").value = rec.dados.entrega || "";
    $("#entTitulo").textContent = `Vistoria Nº ${rec.numero} · ${rec.dados.placa}`;
    $("#entSub").textContent = [rec.dados.veiculo, rec.dados.cliente].filter(Boolean).join(" · ") || "Registre a entrega do veículo";
    sigs.ent.clear();
    clearMarks(); showMsg($("#entMsg"), "");
    show("entrega", "andamento");
  }
  $("#btnVoltarEnt").addEventListener("click", goAndamento);
  $("#form-entrega").addEventListener("submit", async e => {
    e.preventDefault();
    clearMarks();
    const v = validator();
    const nome = clean($("#entNome").value, 80), rg = clean($("#entRg").value, 20);
    if (!nome) v.fail("Nome do responsável pela entrega", $("#entNome"));
    if (!rg) v.fail("RG / CPF da entrega", $("#entRg"));
    if (!sigs.ent.ok) v.fail("Assinatura do responsável pela entrega", sigs.ent.root, "miss");
    if (v.bad.length) {
      showMsg($("#entMsg"), "Falta preencher: " + v.bad.join("; ") + ".");
      if (v.first) v.first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const btn = $("#finalizar"); btn.disabled = true; btn.textContent = "Finalizando...";
    try {
      const rec = await repo.get(curId);
      if (!rec) throw new Error("não encontrada");
      rec.entrega = {
        local: clean($("#entLocal").value, 120), obs: clean($("#entObs").value, 500),
        nome, rg, fotos: entFotos.map(p => ({ ...p })), assinatura: sigs.ent.image()
      };
      rec.status = "finalizada"; rec.finalizadoEm = new Date().toISOString();
      await repo.update(rec);
      openDetalhe(rec.id);
    } catch (err) {
      showMsg($("#entMsg"), errText(err, CLOUD ? "Não foi possível finalizar. Tente novamente." : "Não foi possível finalizar neste aparelho. Tente novamente."));
    } finally {
      btn.disabled = false; btn.textContent = "✅ Finalizar Entrega";
    }
  });
  $("#btnExcluirEnt").addEventListener("click", async () => {
    if (!curId || !confirm(CLOUD ? "Excluir esta vistoria para todos? Essa ação não pode ser desfeita." : "Excluir esta vistoria do aparelho? Essa ação não pode ser desfeita.")) return;
    try { await repo.del(curId); } catch (err) { alert(errText(err, "Não foi possível excluir. Tente de novo.")); return; }
    curId = null;
    goAndamento();
  });

  // ---------- detalhe (finalizada) ----------
  let detId = null;
  async function openDetalhe(id) {
    let rec;
    try { rec = await repo.get(id); } catch (err) { alert(errText(err, "Não foi possível abrir a vistoria. Tente de novo.")); return; }
    if (!rec) { alert("Essa vistoria não existe mais."); goFinalizada(); return; }
    detId = id;
    const d = rec.dados, r = rec.responsavel || {}, en = rec.entrega || {};
    const box = $("#detalheContent"); box.textContent = "";
    box.append(el("h2", null, `Vistoria Nº ${rec.numero}`));
    box.append(el("p", "hint", `Retirada: ${fmtDate(rec.criadoEm)}${rec.finalizadoEm ? " · Entrega: " + fmtDate(rec.finalizadoEm) : ""}`));
    const rows = [
      ["Placa", d.placa], ["Veículo", d.veiculo], ["Motorista / Vistoriador", d.motorista],
      ["Cliente", d.cliente], ["Telefone do cliente", d.telefone], ["Local de retirada", d.retirada],
      ["Local de entrega", en.local || d.entrega], ["KM do odômetro", (d.km || "0") + " Km"],
      ["Combustível", d.combustivel], ["Responsável (retirada)", [r.nome, r.rg && "RG " + r.rg].filter(Boolean).join(" · ")],
      ["Responsável (entrega)", [en.nome, en.rg && "RG " + en.rg].filter(Boolean).join(" · ")],
      ["Avarias marcadas", String((rec.avarias || []).length)], ["Fotos", `${(rec.fotos || []).length} retirada · ${(en.fotos || []).length} entrega`]
    ];
    const dl = el("dl", "dl");
    rows.forEach(([k, val]) => { dl.append(el("dt", null, k), el("dd", null, val || "-")); });
    box.append(dl);
    const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File([""], "a.pdf", { type: "application/pdf" })] }));
    $("#btnCompartilhar").hidden = !canShareFiles;
    showMsg($("#detMsg"), "");
    show("detalhe", "finalizada");
  }
  $("#btnVoltarDet").addEventListener("click", goFinalizada);
  const pdfName = rec => `vistoria-${rec.numero}-${rec.dados.placa || "sem-placa"}.pdf`;
  $("#btnBaixar").addEventListener("click", async () => {
    try {
      const rec = await repo.get(detId); if (!rec) return;
      const blob = buildPdf(rec);
      const url = URL.createObjectURL(blob);
      const a = el("a"); a.href = url; a.download = pdfName(rec);
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showMsg($("#detMsg"), "PDF gerado.", true);
    } catch (err) {
      showMsg($("#detMsg"), errText(err, "Não foi possível gerar o PDF. Tente novamente."));
    }
  });
  $("#btnCompartilhar").addEventListener("click", async () => {
    try {
      const rec = await repo.get(detId); if (!rec) return;
      const blob = buildPdf(rec);
      const file = new File([blob], pdfName(rec), { type: "application/pdf" });
      if (!navigator.canShare || !navigator.canShare({ files: [file] })) { showMsg($("#detMsg"), "Compartilhamento não disponível aqui. Use Baixar PDF."); return; }
      await navigator.share({ files: [file], title: pdfName(rec) });
    } catch (err) {
      if (err && err.name !== "AbortError") showMsg($("#detMsg"), errText(err, "Não foi possível compartilhar. Tente Baixar PDF."));
    }
  });
  $("#btnApagarDet").addEventListener("click", async () => {
    if (!detId || !confirm(CLOUD ? "Apagar esta vistoria para todos? Essa ação não pode ser desfeita." : "Apagar esta vistoria do aparelho? Essa ação não pode ser desfeita.")) return;
    try { await repo.del(detId); } catch (err) { alert(errText(err, "Não foi possível apagar. Tente de novo.")); return; }
    detId = null;
    goFinalizada();
  });

  // ---------- PDF (montado a partir do registro salvo) ----------
  function buildPdf(rec) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const PW = 210, M = 14, CW = PW - 2 * M, BOT = 276;
    const G = CFG.corPrincipal, RED = [179, 38, 30], GRAY = [95, 107, 102];
    const d = rec.dados, ent = rec.entrega || {}, resp = rec.responsavel || {}, mot = rec.motorista || {};
    const num = String(rec.numero);
    const dataTxt = fmtDate(rec.criadoEm);
    const v = x => clean(x) || "-";
    let y = 0;

    const header = () => {
      doc.setFillColor(...G); doc.rect(0, 0, PW, 32, "F");
      // Caixa branca do logo: acompanha a proporção da imagem (logos largos ganham caixa larga).
      const aspect = logoData ? logoData.w / logoData.h : 1;
      const boxW = Math.min(44, Math.max(20, 17 * aspect + 3));
      doc.setFillColor(255, 255, 255); doc.roundedRect(M, 6, boxW, 20, 2.5, 2.5, "F");
      if (logoData) {
        const s = Math.min((boxW - 3) / logoData.w, 17 / logoData.h); const w = logoData.w * s, h = logoData.h * s;
        const fmt = /^data:image\/png/i.test(logoData.d) ? "PNG" : "JPEG";
        try { doc.addImage(logoData.d, fmt, M + boxW / 2 - w / 2, 16 - h / 2, w, h); } catch { /* sem logo */ }
      }
      const tx = M + boxW + 5;
      doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(clean(CFG.empresa, 60), tx, 12);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      const l1 = [CFG.cnpj && "CNPJ " + CFG.cnpj, CFG.telefone && "Tel " + CFG.telefone].filter(Boolean).join("  -  ");
      if (l1) doc.text(clean(l1, 90), tx, 17.5);
      const ad = doc.splitTextToSize(clean(CFG.endereco, 160), PW - M - 42 - tx); doc.text(ad.slice(0, 2), tx, 21.5);
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text("Vistoria Nº " + num, PW - M, 12, { align: "right" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(dataTxt, PW - M, 18, { align: "right" });
      doc.setFontSize(7.5); doc.text("Emitido via " + clean(CFG.appName, 40), PW - M, 23, { align: "right" });
      doc.setTextColor(0); y = 42;
    };
    const ensure = h => { if (y + h > BOT) { doc.addPage(); header(); } };
    const section = (t, need = 20) => {
      ensure(need + 8);
      doc.setFillColor(...G); doc.rect(M, y - 4.5, 1.8, 6, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(30); doc.text(t, M + 5, y);
      doc.setDrawColor(222); doc.setLineWidth(0.3); doc.line(M, y + 3, PW - M, y + 3); y += 10; doc.setTextColor(0);
    };
    const photoSection = (title, list, prefix) => {
      if (!list || !list.length) return;
      section(title, 48);
      const gap = 4, cw = (CW - 2 * gap) / 3, ch = cw * 0.75;
      for (let i = 0; i < list.length; i += 3) {
        ensure(ch + 10);
        for (let j = 0; j < 3 && i + j < list.length; j++) {
          const p = list[i + j], x = M + j * (cw + gap);
          doc.setDrawColor(222); doc.rect(x, y, cw, ch);
          const s = Math.min(cw / p.w, ch / p.h), w = p.w * s, h = p.h * s;
          doc.addImage(p.d, "JPEG", x + (cw - w) / 2, y + (ch - h) / 2, w, h);
          doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GRAY); doc.text(`${prefix} - foto ${i + j + 1}`, x, y + ch + 4.5);
        }
        y += ch + 10;
      }
      doc.setTextColor(0);
    };

    header();

    // Dados
    section("Dados", 50);
    const cells = [
      ["STATUS", rec.status === "finalizada" ? "Finalizada" : "Em andamento"], ["PLACA", v(d.placa)],
      ["MOTORISTA / VISTORIADOR", v(d.motorista)], ["VEÍCULO", v(d.veiculo)],
      ["CLIENTE", v(d.cliente)], ["TELEFONE CLIENTE", v(d.telefone)],
      ["LOCAL DE RETIRADA", v(d.retirada)], ["LOCAL DE ENTREGA", v(ent.local || d.entrega)],
      ["KM ODÔMETRO", (digits(d.km) || "0") + " Km"], ["COMBUSTÍVEL", v(d.combustivel)],
      ["DATA DA RETIRADA", dataTxt || "-"], ["DATA DA ENTREGA", fmtDate(rec.finalizadoEm) || "-"]
    ];
    const colW = (CW - 8) / 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    const rows = [];
    for (let i = 0; i < cells.length; i += 3) {
      const r = cells.slice(i, i + 3).map(([l, t]) => [l, doc.splitTextToSize(t, colW - 4)]);
      rows.push({ r, h: 4.5 + Math.max(...r.map(c => c[1].length)) * 4.6 + 3.5 });
    }
    const boxH = rows.reduce((a, b) => a + b.h, 0) + 5;
    ensure(boxH);
    doc.setFillColor(247, 248, 247); doc.setDrawColor(222); doc.roundedRect(M, y, CW, boxH, 2.5, 2.5, "FD");
    let yy = y + 5;
    rows.forEach(row => {
      row.r.forEach(([l, lines], c) => {
        const x = M + 4 + c * colW;
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRAY); doc.text(l, x, yy);
        doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20); doc.text(lines, x, yy + 4.6);
      });
      yy += row.h;
    });
    y += boxH + 8;

    // Checklist
    section("Checklist de Itens", 66);
    const ckList = rec.checklist || [];
    const ckH = Math.ceil(ckList.length / 3) * 11 + 4;
    ensure(ckH);
    doc.setFillColor(247, 248, 247); doc.setDrawColor(222); doc.roundedRect(M, y, CW, ckH, 2.5, 2.5, "FD");
    const LABEL = { ok: "Tem", falta: "Falta", na: "N/A" };
    ckList.forEach((it, i) => {
      const cx = M + 5 + (i % 3) * ((CW - 6) / 3), cy = y + 6 + Math.floor(i / 3) * 11;
      const st = LABEL[it.val] || "N/A";
      const col = it.val === "ok" ? G : it.val === "falta" ? RED : GRAY;
      doc.setFillColor(...col); doc.circle(cx + 1.8, cy - 1, 1.7, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(30); doc.text(clean(it.name, 28), cx + 6, cy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...col); doc.text(st, cx + 6, cy + 4.2);
    });
    doc.setTextColor(0); y += ckH + 8;

    // Avarias
    section("Avarias Pré-existentes", 84);
    const avarias = rec.avarias || [];
    const used = VIEWS.filter(vw => avarias.some(a => a.view === vw.key));
    if (!used.length) { doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text("Nenhuma avaria registrada.", M, y); y += 8; }
    used.forEach(vw => {
      const imgW = 92, imgH = imgW * vw.h / vw.w;
      const list = []; avarias.forEach((a, i) => { if (a.view === vw.key) list.push(`${i + 1}. ${a.text}`); });
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      const lines = list.flatMap(t => doc.splitTextToSize(t, CW - imgW - 10));
      const h = Math.max(imgH, lines.length * 5) + 12; ensure(h);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(30); doc.text(vw.label, M, y); y += 3;
      const c = document.createElement("canvas"); renderView(vw, c, avarias);
      doc.setDrawColor(222); doc.rect(M, y, imgW, imgH);
      doc.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", M, y, imgW, imgH);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(0); doc.text(lines, M + imgW + 6, y + 5);
      y += Math.max(imgH, lines.length * 5) + 9;
    });

    // Observações
    const obsLines = [["Observação geral", d.obs], ["Observação da coleta", d.obsColeta], ["Observação da entrega", ent.obs]].filter(([, t]) => t);
    if (obsLines.length) {
      section("Observações");
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      obsLines.forEach(([l, t]) => {
        const ls = doc.splitTextToSize(`${l}: ${t}`, CW);
        ensure(ls.length * 5 + 4); doc.text(ls, M, y); y += ls.length * 5 + 4;
      });
      y += 2;
    }

    // Fotos
    photoSection("Fotos da Retirada", rec.fotos, "Retirada");
    photoSection("Fotos da Entrega", ent.fotos, "Entrega");

    // Assinaturas
    section("Assinaturas", 48);
    const sw = (CW - 10) / 3, sh = 28; ensure(sh + 24);
    const caps = [
      [resp.assinatura, "Responsável (Retirada): " + v(resp.nome) + (resp.rg ? " - RG " + clean(resp.rg, 20) : "")],
      [mot.assinatura, "Motorista / Vistoriador: " + v(mot.nome)],
      [ent.assinatura, "Responsável (Entrega): " + v(ent.nome) + (ent.rg ? " - RG " + clean(ent.rg, 20) : "")]
    ];
    caps.forEach(([img, cap], i) => {
      const x = M + i * (sw + 5);
      doc.setDrawColor(222); doc.rect(x, y, sw, sh);
      if (img) {
        const s = Math.min((sw - 4) / SIG_W, (sh - 4) / SIG_H), w = SIG_W * s, h = SIG_H * s;
        doc.addImage(img, "PNG", x + (sw - w) / 2, y + (sh - h) / 2, w, h);
      }
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(40); doc.text(doc.splitTextToSize(cap, sw), x, y + sh + 4.5);
    });
    doc.setTextColor(0);

    // Rodapé em todas as páginas
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p); doc.setDrawColor(222); doc.setLineWidth(0.3); doc.line(M, 285, PW - M, 285);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
      doc.text("Emitido via " + clean(CFG.appName, 40), M, 290); doc.text(`Página ${p} de ${n}`, PW - M, 290, { align: "right" });
    }
    return doc.output("blob");
  }

  // ---------- login (só no modo nuvem) ----------
  function applyAuthUi() {
    const ok = !AUTH || !!session;
    $("#topnav").hidden = !ok;
    $("#btnSair").hidden = !(AUTH && session);
    if (!ok) show("login", null);
  }
  function enterApp() {
    applyAuthUi();
    show("novo", "novo");
    refreshNum();
    refreshBadge();
  }
  onAuthLost = () => { applyAuthUi(); showMsg($("#loginMsg"), "Sua sessão expirou. Entre de novo."); };
  $("#form-login").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim(), password = $("#loginSenha").value;
    if (!email || !password) { showMsg($("#loginMsg"), "Informe e-mail e senha."); return; }
    const btn = $("#btnEntrar"); btn.disabled = true; btn.textContent = "Entrando...";
    try {
      const n = await authCall("password", { email, password });
      n.email = n.email || email; saveSession(n);
      $("#loginSenha").value = ""; showMsg($("#loginMsg"), "");
      enterApp();
    } catch (err) {
      showMsg($("#loginMsg"), (err && err.status && err.status < 500 && err.status !== 429)
        ? "E-mail ou senha incorretos."
        : errText(err, "Não foi possível entrar agora. Tente de novo em instantes."));
    } finally { btn.disabled = false; btn.textContent = "Entrar"; }
  });
  $("#btnSair").addEventListener("click", () => {
    if (!confirm("Sair da conta neste aparelho?")) return;
    fetch(`${SB}/auth/v1/logout`, { method: "POST", headers: { apikey: CFG.supabaseKey, Authorization: "Bearer " + (session ? session.access : "") } }).catch(() => {});
    saveSession(null); resetRetirada(); curId = null; detId = null;
    applyAuthUi(); showMsg($("#loginMsg"), "");
  });

  // ---------- inicialização ----------
  if (CLOUD) {
    // Textos que mudam quando os dados vão para a nuvem
    $("#lgpd").nextElementSibling.textContent = AUTH
      ? "Concordo em informar estes dados para fins da vistoria. Eles ficam guardados na conta online da empresa (só quem tem login acessa) e no PDF gerado."
      : "Concordo em informar estes dados para fins da vistoria. Eles ficam guardados no banco online da empresa e no PDF gerado.";
    $("#btnExcluirEnt").textContent = "Excluir esta vistoria";
    $("#btnApagarDet").textContent = "Apagar vistoria";
  }
  resetChecklist();
  renderDamages();
  drawCurrent();
  renderPhotoGrid($("#photoGrid"), draftFotos);
  if (AUTH && !session) { applyAuthUi(); refreshNum(); } else enterApp();
})();
