// Contas das MEDIDAS (ferramenta Medir da página e do site): formato dos
// dados, modos, resultado, "± provável", avisos, textos dos pontos e CSV.
// Puro: sem imports, sem three e sem tela — a mesma conta roda na página, no
// site e no node (testes). O gêmeo em Python (normalizar, proteger) é
// splatgeo/medidas.py: os dois dão o MESMO JSON.
//
// Uma medida (formato 2):
//   { id, nome, tipo: "dist"|"area", modo: "livre"|"horizontal"|"prumo"|"face",
//     face: null | {tipo:"eixo"} | {tipo:"plano", pontos:[[E,N,Z]×3]},
//     criada, alterada, no_site, pontos: [{ xyz:[E,N,Z], de_onde, sigma_m, … }],
//     resultado }
// O formato antigo ([{tipo, pontos:[[E,N,Z]…]}], uma medida só) é lido por
// normalizar() e vira "Medida 1 (antiga)".
//
// Quadro da face {t, u, n, c}: t = ao longo (horizontal), u = subindo na face,
// n = normal, c = origem. "Na face" corta o RAIO de cada clique com o plano
// (o erro de profundidade do clique sai da conta) e mede a (ao longo) e h (na
// rampa) no plano.

export const MAX_MEDIDAS = 200;
export const MAX_PONTOS = 500;
export const FORMATO = 2;
export const MODOS = { dist: ["livre", "horizontal", "prumo", "face"], area: ["livre", "face"] };
export const TITULO_PM = "provável: cerca de 2 em cada 3 medidas erram menos que isso; não inclui o erro do encaixe";

const ROTULOS = {
  dist: { livre: "livre (3D)", horizontal: "horizontal", prumo: "prumo (desnível)", face: "na face" },
  area: { livre: "em planta", face: "na face" },
};
const CAMPOS_PONTO = ["xyz", "de_onde", "sigma_m", "espessura_m", "qualidade", "limite", "aviso", "raio",
  "normal", "splat_xyz", "encaixe", "cota_topografo", "rotulo", "ajuste_mao_m", "orto"];
const DO_MODELO = ["splat", "splat-bruto", "ortofoto"];
const DO_DESENHO = ["ponto cotado", "curva", "terreno"];
const RAIO_MIN_DN = 0.35;            // |d·n| abaixo disto o raio quase corre na face: projeção ortogonal
const SIGMA_ORTO_PLANTA = 0.03;      // pixel de 2 cm da ortofoto crua + o clique
const SIGMA_ORTO_DTM = 0.30;         // chão calculado do voo (DTM/DSM)
const SIGMA_VISTA = 0.05;            // ponto marcado na vista frontal (pixel de 5 cm)

// ------------------------------------------------------------------ vetores

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const soma = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const esc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a) => Math.sqrt(dot(a, a));
function unit(a) {
  const l = norma(a);
  return l > 0 && isFinite(l) ? esc(a, 1 / l) : null;
}
const numOk = (v) => typeof v === "number" && isFinite(v);

/** [E, N, Z] se `v` tem 3 números finitos; senão null. */
function xyzOk(v) {
  return Array.isArray(v) && v.length >= 3 && numOk(v[0]) && numOk(v[1]) && numOk(v[2]) ? [v[0], v[1], v[2]] : null;
}

/** Arredonda como o Python do gêmeo (floor(x + 0,5)): mesmo número dos dois lados. */
function arred(v, casas) {
  if (v === null || v === undefined || !isFinite(v)) return null;
  const f = casas === 1 ? 10 : casas === 2 ? 100 : 1000;
  return Math.floor(v * f + 0.5) / f;
}

// ------------------------------------------------------------ nomes e formato

export function rotuloModo(tipo, modo) {
  return ROTULOS[tipo === "area" ? "area" : "dist"][modo] || String(modo || "");
}

export function novoId() {
  let s = "";
  for (let i = 0; i < 4; i++) s += "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
  return "md-" + Date.now().toString(36) + s;
}

/** Medida nova, vazia (só vai para a lista gravada quando ganhar pontos). */
export function nova({ tipo = "dist", nome = null, modo = null } = {}) {
  tipo = tipo === "area" ? "area" : "dist";
  modo = MODOS[tipo].includes(modo) ? modo : "livre";
  const agora = new Date().toISOString();
  return {
    id: novoId(), nome: nome || "Medida", tipo, modo, face: null, criada: agora, alterada: agora,
    no_site: false, pontos: [], resultado: { tipo, modo, n: 0, incompleta: true, motivo: "faltam pontos" },
  };
}

/** "Medida N": um a mais que o maior número já usado (e que a quantidade). */
export function proximoNome(lista) {
  let n = Array.isArray(lista) ? lista.length : 0;
  for (const m of lista || []) {
    const r = /^Medida (\d+)\b/.exec(m?.nome || "");
    if (r) n = Math.max(n, Number(r[1]));
  }
  return "Medida " + (n + 1);
}

function ehNova(m) {
  return !!m && typeof m === "object" && !Array.isArray(m) && typeof m.id === "string" && m.id !== ""
    && Array.isArray(m.pontos) && m.pontos.every((p) => p && typeof p === "object" && !Array.isArray(p));
}

/** Lista no formato novo (com pelo menos 1 medida, todas com id e pontos-objeto). */
export function ehFormatoNovo(lista) {
  return Array.isArray(lista) && lista.length > 0 && lista.every(ehNova);
}

function pontoCompleto(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const xyz = xyzOk(p.xyz);
  if (!xyz) return null;
  const q = { ...p };
  for (const k of CAMPOS_PONTO) if (q[k] === undefined) q[k] = null;
  q.xyz = xyz;
  return q;
}

function faceOk(f) {
  if (!f || typeof f !== "object") return null;
  if (f.tipo === "eixo") return { tipo: "eixo" };
  if (f.tipo === "plano") return { tipo: "plano", pontos: (Array.isArray(f.pontos) ? f.pontos : []).map(xyzOk).filter(Boolean) };
  return null;
}

function daAntiga(m, i) {
  const tipo = m.tipo === "area" ? "area" : "dist";
  const pts = (Array.isArray(m.pontos) ? m.pontos : [])
    .map((p) => (Array.isArray(p) ? xyzOk(p) : p && typeof p === "object" ? xyzOk(p.xyz) : null))
    .filter(Boolean).slice(0, MAX_PONTOS);
  const med = {
    id: "md-antiga-" + (i + 1), nome: "Medida " + (i + 1) + " (antiga)", tipo, modo: "livre", face: null,
    criada: null, alterada: null, no_site: false,
    pontos: pts.map((xyz) => {
      const q = {};
      for (const k of CAMPOS_PONTO) q[k] = null;
      q.xyz = xyz;
      q.de_onde = "antigo";
      return q;
    }),
  };
  med.resultado = resultado(med);
  return med;
}

function completar(m, i) {
  const med = { ...m };
  med.tipo = m.tipo === "area" ? "area" : "dist";
  med.modo = MODOS[med.tipo].includes(m.modo) ? m.modo : "livre";
  med.nome = typeof m.nome === "string" && m.nome !== "" ? m.nome : "Medida " + (i + 1);
  med.face = faceOk(m.face);
  med.criada = m.criada === undefined ? null : m.criada;
  med.alterada = m.alterada === undefined ? null : m.alterada;
  med.no_site = m.no_site === true;
  med.pontos = m.pontos.map(pontoCompleto).filter(Boolean).slice(0, MAX_PONTOS);
  med.resultado = m.resultado === undefined ? null : m.resultado;
  return med;
}

/** Lê a lista gravada (formato novo ou antigo) e completa os campos; idempotente.
 *  Item sem "id" ou com pontos em lista = antigo ("Medida N (antiga)", pontos
 *  "antigo"). Pontos não finitos saem, medida sem ponto sai, ficam as últimas 200. */
export function normalizar(lista) {
  if (!Array.isArray(lista)) return [];
  const saida = [];
  lista.forEach((m, i) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) return;
    m = JSON.parse(JSON.stringify(m));
    const med = ehNova(m) ? completar(m, i) : daAntiga(m, i);
    if (med.pontos.length) saida.push(med);
  });
  return saida.slice(-MAX_MEDIDAS);
}

/** Só as medidas com pontos (as que se gravam e aparecem na tabela). */
export function comPontos(lista) {
  return (lista || []).filter((m) => m && Array.isArray(m.pontos) && m.pontos.length > 0);
}

// ----------------------------------------------------------------- quadros

/** Quadro do eixo z e da normal n (unitária) com origem c; face horizontal -> null. */
function quadroDe(n, c) {
  const t = unit(cross(n, [0, 0, 1]));
  if (!t) return null;
  let u = cross(n, t);
  if (u[2] < 0) u = esc(u, -1);
  return { t, u, n, c: c.slice(0, 3) };
}

/** Plano por 3 pontos; em linha (ou face horizontal) -> null. */
export function quadroDoPlano(p1, p2, p3) {
  const a = sub(p2, p1), b = sub(p3, p1);
  const cr = cross(a, b);
  const la = norma(a), lb = norma(b);
  if (!(la > 0 && lb > 0) || norma(cr) < 1e-6 * la * lb) return null;
  return quadroDe(unit(cr), p1);
}

/** Quadro com t dado (tangente do eixo, [tx, ty]) e a normal da face (ou null). */
export function quadroDaFace(t, normal, c) {
  const tt = unit([t[0], t[1], 0]);
  const semNormal = { t: tt, u: null, n: null, c: c.slice(0, 3), aviso: "não achei a face aqui: use o plano por 3 pontos" };
  if (!tt || !xyzOk(normal)) return semNormal;
  const n = unit(sub(normal, esc(tt, dot(normal, tt))));
  if (!n) return semNormal;
  let u = cross(n, tt);
  if (u[2] < 0) u = esc(u, -1);
  return { t: tt, u, n, c: c.slice(0, 3) };
}

/** Ponto levado ao quadro: com raio e |d·n| >= 0,35 CORTA o raio com o plano
 *  (tira o erro de profundidade do clique); senão projeção ortogonal. a = ao
 *  longo, h = na rampa, f = o quanto o ponto capturado estava fora do plano. */
export function projetarNoQuadro(ponto, quadro) {
  const p = Array.isArray(ponto) ? ponto : ponto.xyz;
  const { t, u, n, c } = quadro;
  if (!n) return { xyz: p.slice(0, 3), a: dot(sub(p, c), t), h: null, f: null, modo: "ortogonal", aviso: null };
  const raio = Array.isArray(ponto) ? null : ponto.raio;
  const d = raio && xyzOk(raio.o) && xyzOk(raio.d) ? unit(raio.d) : null;
  let xyz, modo = "ortogonal", aviso = null;
  if (d && Math.abs(dot(d, n)) >= RAIO_MIN_DN) {
    xyz = soma(raio.o, esc(d, dot(sub(c, raio.o), n) / dot(d, n)));
    modo = "raio";
  } else {
    xyz = sub(p, esc(n, dot(sub(p, c), n)));
    if (d) aviso = "raio quase paralelo à face: marque de frente";
    else if (Array.isArray(ponto) || ponto.de_onde !== "vista frontal") aviso = "sem raio";
  }
  const r = sub(xyz, c);
  return { xyz, a: dot(r, t), h: u ? dot(r, u) : null, f: dot(sub(p, c), n), modo, aviso };
}

// ------------------------------------------------------------------ contas

const PLANTA = (a, b) => Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
const ESPACO = (a, b) => Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2);

/** Área pelo shoelace, relativa ao 1º ponto (coordenada UTM grande não perde precisão). */
function shoelace(X, Y) {
  let s = 0;
  const n = X.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += (X[i] - X[0]) * (Y[j] - Y[0]) - (X[j] - X[0]) * (Y[i] - Y[0]);
  }
  return Math.abs(s) / 2;
}

/** As contas sem arredondar (o "± provável" deriva daqui). */
function contas(medida, quadro) {
  const tipo = medida.tipo === "area" ? "area" : "dist";
  const modo = MODOS[tipo].includes(medida.modo) ? medida.modo : "livre";
  const pts = (medida.pontos || []).filter((p) => p && xyzOk(p.xyz));
  const P = pts.map((p) => p.xyz);
  const n = P.length;
  const base = { tipo, modo, n };
  if (n < (tipo === "area" ? 3 : 2)) return { ...base, incompleta: true, motivo: "faltam pontos" };
  const r = {
    ...base,
    n_duvidosos: pts.filter((p) => p.qualidade === "duvidoso").length,
    n_avisos: pts.filter((p) => p.aviso).length,
    trechos: [], avisos: [],
  };
  const ultimo = n - 1;
  if (tipo === "dist" && modo !== "face") {
    let cam = 0, camH = 0;
    for (let i = 1; i < n; i++) {
      const l = ESPACO(P[i - 1], P[i]), lh = PLANTA(P[i - 1], P[i]);
      cam += l;
      camH += lh;
      r.trechos.push({ de: i, a: i + 1, valor_m: modo === "livre" ? l : modo === "horizontal" ? lh : P[i][2] - P[i - 1][2] });
    }
    const dirH = PLANTA(P[0], P[ultimo]);
    const desn = P[ultimo][2] - P[0][2];
    if (modo === "livre") {
      Object.assign(r, {
        caminho_m: cam, caminho_h_m: camH, direto_m: ESPACO(P[0], P[ultimo]), direto_h_m: dirH, desnivel_m: desn,
        inclinacao_pct: dirH >= 0.01 ? desn / dirH * 100 : null,
      });
      r.principal = { rotulo: "Distância (livre)", valor: cam, unidade: "m" };
    } else if (modo === "horizontal") {
      Object.assign(r, { caminho_h_m: camH, direto_h_m: dirH });
      r.principal = { rotulo: "Horizontal", valor: camH, unidade: "m" };
    } else {
      r.desnivel_m = desn;
      r.principal = { rotulo: "Desnível (prumo)", valor: desn, unidade: "m" };
    }
    return r;
  }
  if (tipo === "area" && modo === "livre") {
    let per = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, l = PLANTA(P[i], P[j]);
      per += l;
      r.trechos.push({ de: i + 1, a: j + 1, valor_m: l });
    }
    Object.assign(r, {
      area_planta_m2: shoelace(P.map((p) => p[0]), P.map((p) => p[1])), perimetro_h_m: per,
      z_min: Math.min(...P.map((p) => p[2])), z_max: Math.max(...P.map((p) => p[2])),
    });
    r.principal = { rotulo: "Área em planta", valor: r.area_planta_m2, unidade: "m²" };
    return r;
  }
  // ---- na face
  if (!quadro || !quadro.t) return { ...base, incompleta: true, motivo: "sem face" };
  if (tipo === "area" && !quadro.u) return { ...base, incompleta: true, motivo: "sem face" };
  const Q = pts.map((p) => projetarNoQuadro(p, quadro));
  for (const a of [quadro.aviso, ...Q.map((q) => q.aviso)]) if (a && !r.avisos.includes(a)) r.avisos.push(a);
  const temU = !!quadro.u;
  const passo = (q1, q2) => (temU ? Math.hypot(q2.a - q1.a, q2.h - q1.h) : Math.abs(q2.a - q1.a));
  r.fora_da_face_m = temU ? Math.max(...Q.map((q) => Math.abs(q.f))) : null;
  if (tipo === "dist") {
    let cam = 0;
    for (let i = 1; i < n; i++) {
      const l = passo(Q[i - 1], Q[i]);
      cam += l;
      r.trechos.push({ de: i, a: i + 1, valor_m: l });
    }
    let aoLongo = Math.abs(Q[ultimo].a - Q[0].a);
    if (typeof quadro.aoLongo === "function") {
      const al = quadro.aoLongo(Q[0].xyz, Q[ultimo].xyz);
      if (al && isFinite(al.m)) {
        aoLongo = al.m;
        r.avisos.push("a face dobra aqui: 'ao longo' pelo eixo");
      }
    }
    r.ao_longo_m = aoLongo;
    r.caminho_face_m = cam;
    if (temU) {
      r.altura_m = Q[ultimo].xyz[2] - Q[0].xyz[2];
      r.na_rampa_m = Math.abs(Q[ultimo].h - Q[0].h);
      r.na_face_m = Math.hypot(aoLongo, r.na_rampa_m);
      r.principal = { rotulo: "Na face", valor: r.na_face_m, unidade: "m" };
    } else {
      r.altura_m = r.na_rampa_m = r.na_face_m = null;
      r.principal = { rotulo: "Ao longo da face", valor: aoLongo, unidade: "m" };
    }
    return r;
  }
  let per = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, l = passo(Q[i], Q[j]);
    per += l;
    r.trechos.push({ de: i + 1, a: j + 1, valor_m: l });
  }
  r.area_face_m2 = shoelace(Q.map((q) => q.a), Q.map((q) => q.h));
  r.perimetro_face_m = per;
  r.area_planta_m2 = shoelace(P.map((p) => p[0]), P.map((p) => p[1]));
  r.principal = { rotulo: "Área na face", valor: r.area_face_m2, unidade: "m²" };
  return r;
}

const CASAS = { _m: 3, _m2: 2, _pct: 1 };
function casasDe(chave) {
  if (chave === "z_min" || chave === "z_max") return 3;
  for (const fim of ["_m2", "_pct", "_m"]) if (chave.endsWith(fim)) return CASAS[fim];
  return null;
}

/** Resultado da medida no modo dela (m com 3 casas, m² com 2). `quadro` só no
 *  modo "na face" (medir.js monta: eixo.quadroDaMedida ou quadroDoPlano). */
export function resultado(medida, { quadro = null } = {}) {
  const r = contas(medida, quadro);
  if (r.incompleta) return r;
  const inc = incertezaDaMedida(medida, { quadro });
  for (const k of Object.keys(r)) {
    const c = casasDe(k);
    if (c !== null && typeof r[k] === "number") r[k] = arred(r[k], c);
  }
  r.principal = { ...r.principal, valor: arred(r.principal.valor, r.principal.unidade === "m²" ? 2 : 3) };
  r.trechos = r.trechos.map((t) => ({ ...t, valor_m: arred(t.valor_m, 3) }));
  r.pm_m = inc.pm === null ? null : arred(inc.pm, 3);
  r.pm_desconhecida = inc.desconhecida;
  r.pm_motivo = inc.motivo;
  return r;
}

// ------------------------------------------------------------ ± provável

function motivoSemSigma(p) {
  if (p.aviso === "ajustado à mão") return "ponto ajustado à mão";
  const m = {
    "ponto cotado": "ponto do desenho", curva: "ponto do desenho", terreno: "ponto do desenho",
    "splat-bruto": "clique simples", arrastado: "ponto arrastado", antigo: "medida antiga",
    ortofoto: "ponto da ortofoto sem altura",
  };
  // ortofoto com a altura pelo modelo, mas o modelo não deu precisão ali (a imagem não
  // enche no raio vertical): a altura existe, só não tem ±
  if (p.de_onde === "ortofoto" && p.orto?.z_de === "splat") return "altura do modelo sem precisão nesse ponto";
  return m[p.de_onde] || (p.de_onde ? "ponto sem precisão" : "medida antiga");
}

/** Deslocamentos de 1 sigma do ponto (um por direção de erro) ou null (sem sigma). */
function deslocamentos(p, medida, quadro) {
  const s = numOk(p.sigma_m) && p.sigma_m > 0 ? p.sigma_m : null;
  if (p.de_onde === "ortofoto") {
    const v = [[SIGMA_ORTO_PLANTA, 0, 0], [0, SIGMA_ORTO_PLANTA, 0]];
    const zDe = p.orto?.z_de;
    const soPlanta = medida.modo === "horizontal" || (medida.tipo === "area" && medida.modo === "livre");
    if (zDe === "splat") {
      if (s === null) return soPlanta ? v : null;
      v.push([0, 0, s]);
    } else if (zDe === "dtm" || zDe === "dsm") v.push([0, 0, SIGMA_ORTO_DTM]);
    else if (!soPlanta) return null;
    return v;
  }
  if (p.de_onde === "vista frontal") {
    const sv = s ?? SIGMA_VISTA;
    if (quadro?.t && quadro?.u) return [esc(quadro.t, sv), esc(quadro.u, sv)];
    return [[sv, 0, 0], [0, sv, 0], [0, 0, sv]];
  }
  if (s === null) return null;
  const d = p.raio && xyzOk(p.raio.d) ? unit(p.raio.d) : null;
  return d ? [esc(d, s)] : null;
}

/** "± provável" da medida: para cada ponto com sigma, o quanto o principal muda
 *  com o ponto empurrado 1 sigma na direção do raio (diferença finita); soma
 *  quadrática. No modo face o raio é cortado pelo plano: o erro de
 *  profundidade some, como deve. Ponto sem sigma -> desconhecida. */
export function incertezaDaMedida(medida, { quadro = null } = {}) {
  const r0 = contas(medida, quadro);
  if (r0.incompleta) return { pm: null, desconhecida: true, motivo: r0.motivo };
  const pts = (medida.pontos || []).filter((p) => p && xyzOk(p.xyz));
  const v0 = r0.principal.valor;
  let soma2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const desl = deslocamentos(pts[i], medida, quadro);
    if (desl === null) return { pm: null, desconhecida: true, motivo: motivoSemSigma(pts[i]) };
    for (const v of desl) {
      const outros = pts.slice();
      outros[i] = { ...pts[i], xyz: soma(pts[i].xyz, v) };
      const dv = contas({ ...medida, pontos: outros }, quadro).principal.valor - v0;
      soma2 += dv * dv;
    }
  }
  return { pm: Math.sqrt(soma2), desconhecida: false, motivo: null };
}

// ------------------------------------------------------------------ avisos

function ddmm(iso) {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return r ? r[3] + "/" + r[2] : null;
}

/** O 1º ponto do modelo feito num encaixe diferente de `marca` ({marca}) ou null. */
export function outroEncaixe(medida, marca) {
  if (!marca) return null;
  const p = (medida.pontos || []).find((q) => q && q.encaixe && q.encaixe !== marca);
  return p ? { marca: p.encaixe } : null;
}

/** O 1º ponto do modelo feito em OUTRO VOO da obra (p.voo, só na página) ou null.
 *  Cada voo tem o seu splat e o seu encaixe: a coordenada no splat (splat_xyz) de um
 *  voo não vale no splat de outro, então esse ponto não se recalcula aqui. */
export function outroVoo(medida, voo) {
  if (!voo) return null;
  const p = (medida.pontos || []).find((q) => q && q.voo && q.voo !== voo);
  return p ? { voo: p.voo } : null;
}

/** Avisos da medida (7.6), em texto de tela. opcoes: {encaixe: marca atual,
 *  datas: {marca: ISO}, splatReduzido, voo: voo aberto (página)}. Os "(N pontos
 *  duvidosos)" vão na linha principal (textoPrincipal), não aqui. */
export function avisosDaMedida(medida, res, { encaixe = null, datas = null, splatReduzido = false, voo = null } = {}) {
  const av = [];
  const P = (medida.pontos || []).filter(Boolean);
  const modelo = P.some((p) => DO_MODELO.includes(p.de_onde));
  const desenho = P.some((p) => DO_DESENHO.includes(p.de_onde));
  if (modelo && desenho) av.push("mistura modelo e desenho: soma o erro do encaixe (11 a 36 cm)");
  if (medida.tipo !== "area" && (medida.modo === "livre" || medida.modo === "prumo") && P.some((p) => p.de_onde === "curva")) {
    av.push("a cota da curva é do levantamento antigo: o desnível pode estar errado");
  }
  if (res && numOk(res.fora_da_face_m) && res.fora_da_face_m > 0.15) {
    av.push(`a face não é plana aqui (até ${Math.round(res.fora_da_face_m * 100)} cm fora): para área use Contenção → área da face`);
  }
  for (const a of res?.avisos || []) if (!av.includes(a)) av.push(a);
  const outro = outroEncaixe(medida, encaixe);
  if (outroVoo(medida, voo)) {
    av.push("feita em outro voo: troque para esse voo para continuar ou recalcular");
  } else if (outro) {
    const d = ddmm(datas?.[outro.marca]) || ddmm(medida.criada);
    av.push("feita em outro encaixe" + (d ? ` (${d})` : ""));
  }
  if (splatReduzido && P.some((p) => p.de_onde === "splat" || p.de_onde === "splat-bruto")) {
    av.push("modelo reduzido para o site: a medida pode diferir alguns cm da do escritório");
  }
  return av;
}

// ------------------------------------------------------------------- textos

/** Número com vírgula e sem separador de milhar (CSV); "" se não há número. */
export function numBR(v, casas = 3) {
  if (v === null || v === undefined || typeof v !== "number" || !isFinite(v)) return "";
  let s = v.toFixed(casas);
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
  return s.replace(".", ",");
}

/** Número para a tela: vírgula e ponto de milhar. */
function numTela(v, casas) {
  const s = numBR(v, casas);
  if (!s) return "—";
  const [int, dec] = s.split(",");
  const sinal = int.startsWith("-") ? "-" : "";
  const dig = int.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return sinal + dig + (dec !== undefined ? "," + dec : "");
}
const metros = (v) => numTela(v, 2) + " m";

function textoPm(res) {
  if (res.pm_desconhecida) return ` (± desconhecido: ${res.pm_motivo || "ponto sem precisão"})`;
  if (!numOk(res.pm_m)) return "";
  const cm = res.pm_m * 100;
  return cm < 0.5 ? " ±menos de 1 cm provável" : ` ±${Math.round(cm)} cm provável`;
}

/** Linha principal: "Distância (livre): 12,40 m ±3 cm provável (1 ponto duvidoso)". */
export function textoPrincipal(medida, res) {
  if (!res || res.incompleta) {
    if (res?.motivo === "sem face") return "Na face: escolha a face (eixo da contenção ou plano por 3 pontos)";
    return medida?.tipo === "area" ? "Área: marque pelo menos 3 pontos" : "Distância: marque pelo menos 2 pontos";
  }
  const p = res.principal;
  let t = `${p.rotulo}: ${numTela(p.valor, 2)} ${p.unidade}` + textoPm(res);
  if (res.n_duvidosos > 0) t += res.n_duvidosos === 1 ? " (1 ponto duvidoso)" : ` (${res.n_duvidosos} pontos duvidosos)`;
  return t;
}

function textoTrechos(res, sinal = false) {
  if (!res.trechos || res.trechos.length < 2) return null;
  return res.trechos.map((t) => `${t.de}-${t.a}: ${(sinal && t.valor_m > 0 ? "+" : "") + numTela(t.valor_m, 2)}`).join(" · ");
}

/** As outras linhas do resultado: [[rótulo, texto]…]. */
export function linhasDoResultado(medida, res) {
  if (!res || res.incompleta) return [];
  const L = [];
  const add = (r, t) => { if (t !== null && t !== undefined) L.push([r, t]); };
  const fora = () => {
    if (numOk(res.fora_da_face_m)) add("fora da face (descartado)", "até " + Math.round(res.fora_da_face_m * 100) + " cm");
  };
  if (res.tipo === "dist" && res.modo === "livre") {
    add("Horizontal", metros(res.caminho_h_m));
    add("Direto (1º ao último)", metros(res.direto_m));
    add("Desnível", metros(res.desnivel_m));
    add("Inclinação", res.inclinacao_pct === null ? "—" : numTela(res.inclinacao_pct, 1) + " %");
    add("Trechos", textoTrechos(res));
  } else if (res.tipo === "dist" && res.modo === "horizontal") {
    add("Direto em planta (1º ao último)", metros(res.direto_h_m));
    add("Trechos", textoTrechos(res));
  } else if (res.tipo === "dist" && res.modo === "prumo") {
    add("Trechos (desnível)", textoTrechos(res, true));
  } else if (res.tipo === "dist") {
    if (res.principal.rotulo !== "Ao longo da face") add("Ao longo da face", metros(res.ao_longo_m));
    if (numOk(res.altura_m)) add("Altura", metros(res.altura_m));
    if (numOk(res.na_rampa_m)) add("Na rampa", metros(res.na_rampa_m));
    if (res.n > 2) add("Caminho na face", metros(res.caminho_face_m));
    fora();
  } else if (res.modo === "livre") {
    add("Perímetro em planta", metros(res.perimetro_h_m));
    add("Cotas", numTela(res.z_min, 2) + " a " + numTela(res.z_max, 2) + " m");
    add("", "Área em planta (vista de cima). Para a área da face inclinada escolha 'na face' ou use Contenção → área da face");
  } else {
    add("Área em planta", numTela(res.area_planta_m2, 2) + " m²");
    add("Perímetro na face", metros(res.perimetro_face_m));
    fora();
  }
  return L;
}

/** Title da qualidade do ponto. */
export function tituloQualidade(ponto) {
  const e = ponto?.espessura_m;
  return `espessura da imagem nesse ponto (${numOk(e) ? Math.round(e * 100) : "?"} cm); não é a precisão da medida`;
}

/** Linha do ponto na lista "Pontos:" (3.4). `i` começa em 0; no site "splat"
 *  vira "modelo do drone". */
export function textoDoPonto(ponto, i, { onde = "pagina" } = {}) {
  const n = i + 1;
  const splat = onde === "site" ? "modelo do drone" : "splat";
  const p = ponto || {};
  let t;
  switch (p.de_onde) {
    case "splat":
      if (p.qualidade === "duvidoso") t = `${n} · ⚠ ${splat} · duvidoso: arraste a bolinha ou tire com Ctrl+Z e clique de novo (de outro ângulo)`;
      else if (p.aviso === "câmera rasante") t = `${n} · ${splat} · câmera rasante (limite 50 %)`;
      else if (p.qualidade) t = `${n} · ${splat} · ${p.qualidade}`;
      else t = `${n} · ${splat} (clique simples, sem qualidade)`;
      break;
    case "splat-bruto":
      t = `${n} · ${splat} (clique simples, sem qualidade)`;
      break;
    case "ponto cotado":
      t = `${n} · ponto cotado` + (p.rotulo ? ` · ${p.rotulo}` : "")
        + (numOk(p.cota_topografo) ? ` · cota ${numTela(p.cota_topografo, 2)}` : "");
      break;
    case "curva":
      t = `${n} · curva do desenho (cota do levantamento antigo)`;
      break;
    case "terreno":
      t = `${n} · terreno do levantamento (antes da obra)`;
      break;
    case "ortofoto": {
      const z = p.orto?.z_de;
      const alt = z === "splat" ? `altura pelo ${onde === "site" ? "modelo do drone" : "modelo"}`
        : z === "dtm" ? "altura pelo terreno do voo ±30 cm"
          : z === "dsm" ? "altura pela superfície do voo ±30 cm" : "sem altura: vale só em planta";
      t = `${n} · na ortofoto (planta ±3 cm; ${alt})`;
      break;
    }
    case "vista frontal":
      t = `${n} · na vista frontal`;
      break;
    case "arrastado":
      t = `${n} · arrastado (não achei o modelo ao soltar)`;
      break;
    default:
      t = `${n} · antigo (medida de antes, sem origem)`;
  }
  const aj = p.ajuste_mao_m;
  if (Array.isArray(aj) && aj.length >= 3 && aj.every(numOk)) {
    const m = Math.sqrt(aj[0] * aj[0] + aj[1] * aj[1] + aj[2] * aj[2]);
    if (m >= 0.005) t += ` · ajustado à mão ${Math.round(m * 100)} cm`;
  }
  return t;
}

// --------------------------------------------------------------------- CSV

function celula(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function dataHora(d) {
  const z = (v) => String(v).padStart(2, "0");
  return `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/** CSV "medidas_<obra>.csv": BOM, ";", "\r\n", vírgula decimal; dois blocos
 *  (MEDIDAS e PONTOS). `quadros` = {id: quadro} para recalcular as da face;
 *  sem ele vale o resultado guardado. */
export function csv(lista, { obra = "", quadros = null, agora = null, opcoesAvisos = {} } = {}) {
  const linhas = [];
  const L = (cols) => linhas.push(cols.map(celula).join(";"));
  L([`Splat Geo - medidas da obra ${obra} - ${dataHora(agora || new Date())}`]);
  linhas.push("");
  L(["MEDIDAS"]);
  L(["nome", "tipo", "modo", "pontos", "principal", "valor", "± provável (cm)", "caminho (m)", "horizontal (m)",
    "desnível (m)", "ao longo da face (m)", "altura (m)", "na face (m)", "área (m²)", "perímetro (m)",
    "pontos duvidosos", "avisos"]);
  const meds = comPontos(lista);
  const res = meds.map((m) => (quadros && m.modo === "face" ? resultado(m, { quadro: quadros[m.id] || null })
    : m.resultado && !m.resultado.incompleta && m.resultado.modo === m.modo ? m.resultado : resultado(m)));
  meds.forEach((m, k) => {
    const r = res[k] || {};
    const p = r.principal || {};
    const area = m.tipo === "area" ? (m.modo === "face" ? r.area_face_m2 : r.area_planta_m2) : null;
    const per = m.tipo === "area" ? (m.modo === "face" ? r.perimetro_face_m : r.perimetro_h_m) : null;
    L([m.nome, m.tipo === "area" ? "área" : "distância", rotuloModo(m.tipo, m.modo), m.pontos.length,
      r.incompleta ? "incompleta" : p.rotulo, numBR(p.valor, p.unidade === "m²" ? 2 : 3),
      r.pm_desconhecida || !numOk(r.pm_m) ? "?" : numBR(r.pm_m * 100, 1),
      numBR(r.caminho_m, 3), numBR(r.caminho_h_m, 3), numBR(r.desnivel_m, 3), numBR(r.ao_longo_m, 3),
      numBR(r.altura_m, 3), numBR(r.na_face_m, 3), numBR(area, 2), numBR(per, 3), r.n_duvidosos ?? "",
      avisosDaMedida(m, r, opcoesAvisos).join(" | ")]);
  });
  linhas.push("");
  L(["PONTOS"]);
  L(["medida", "nº", "E", "N", "Z", "de onde", "qualidade do clique", "espessura (cm)", "aviso",
    "cota do topógrafo", "ajuste à mão (cm)"]);
  for (const m of meds) {
    m.pontos.forEach((p, i) => {
      const aj = Array.isArray(p.ajuste_mao_m) && p.ajuste_mao_m.every(numOk)
        ? Math.sqrt(p.ajuste_mao_m.reduce((s, v) => s + v * v, 0)) : null;
      L([m.nome, i + 1, numBR(p.xyz[0], 3), numBR(p.xyz[1], 3), numBR(p.xyz[2], 3), p.de_onde || "antigo",
        p.qualidade || "", numOk(p.espessura_m) ? numBR(p.espessura_m * 100, 1) : "", p.aviso || "",
        numBR(p.cota_topografo, 3), aj === null ? "" : numBR(aj * 100, 1)]);
    });
  }
  return "﻿" + linhas.join("\r\n") + "\r\n";
}

// ------------------------------------------------------- marca do encaixe

function utf8(s) {
  const b = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) b.push(c);
    else if (c < 0x800) b.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) b.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else b.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return b;
}

/** Marca do encaixe: "e" + FNV-1a de 32 bits (8 hex) dos bytes UTF-8 de
 *  JSON.stringify(fonte). Página: fonte = S.transformacao; site: "site:"+gerado_em. */
export function marcaDoEncaixe(fonte) {
  const s = JSON.stringify(fonte === undefined ? null : fonte);
  let h = 0x811c9dc5;
  for (const b of utf8(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "e" + h.toString(16).padStart(8, "0");
}
