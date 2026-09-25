// Eixo da contenção no navegador (página e site): a MESMA regra de
// splatgeo/contencao.py (projetar / do_eixo), em E/N ABSOLUTOS, e a grade da
// vista frontal (pixel da prancha <-> ponto 3D). Puro: sem imports, roda no
// node (testes).
//
//   s = estaca ao longo do eixo    d = afastamento, positivo PARA DENTRO do maciço
//   z = cota                        L = caminho na face (vista "na face")
//
// O eixo é uma polilinha: perto de um vértice que gira mais de 5° o mapeamento
// (s, d) <-> E/N tem um salto de até |d|·Δθ. Não se corrige aqui (mudaria as
// pranchas e as marcas que o Lucas já usa): pertoDeDobra() avisa.

const GIRO_MIN = 5 * Math.PI / 180;
const VAZIO = -32768;

// ------------------------------------------------------------------ vetores

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const esc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unit(a) {
  const l = Math.sqrt(dot(a, a));
  return l > 0 && isFinite(l) ? esc(a, 1 / l) : null;
}
const numOk = (v) => typeof v === "number" && isFinite(v);

// --------------------------------------------------------------------- eixo

/** Eixo do JSON ({pontos: [[E, N]…], estacas, dentro}) pronto para as contas; null se não serve. */
export function prepararEixo(e) {
  if (!e || !Array.isArray(e.pontos) || !Array.isArray(e.estacas)) return null;
  const xy = e.pontos.map((p) => [Number(p[0]), Number(p[1])]);
  const est = e.estacas.map(Number);
  if (xy.length < 2 || est.length !== xy.length || !xy.every((p) => numOk(p[0]) && numOk(p[1])) || !est.every(numOk)) return null;
  const M = xy.length - 1;
  const L = [], t = [], ang = [], giro = [0];
  for (let k = 0; k < M; k++) {
    const vx = xy[k + 1][0] - xy[k][0], vy = xy[k + 1][1] - xy[k][1];
    L.push(Math.sqrt(vx * vx + vy * vy));
    t.push(L[k] > 0 ? [vx / L[k], vy / L[k]] : [1, 0]);
    ang.push(Math.atan2(vy, vx));
  }
  for (let k = 1; k < M; k++) {
    let g = ang[k] - ang[k - 1];
    while (g > Math.PI) g -= 2 * Math.PI;
    while (g < -Math.PI) g += 2 * Math.PI;
    giro.push(g);                                  // giro[k] = no vértice k (entre os trechos k-1 e k)
  }
  return { xy, est, dentro: Number(e.dentro) >= 0 ? 1 : -1, M, L, t, giro, origem: e.origem ?? null };
}

/** (s, d) do ponto E/N: estaca do pé da perpendicular e afastamento (+ para
 *  dentro), trecho k. As pontas do eixo seguem retas. = contencao.projetar. */
export function projetar(eixo, E, N) {
  const { xy, est, M, L, t } = eixo;
  let melhor = Infinity, s = 0, d = 0, kk = 0;
  for (let k = 0; k < M; k++) {
    if (!(L[k] > 0)) continue;
    const [tx, ty] = t[k];
    const rx = E - xy[k][0], ry = N - xy[k][1];
    let f = (rx * tx + ry * ty) / L[k];
    if (k > 0) f = Math.max(f, 0);
    if (k < M - 1) f = Math.min(f, 1);
    const qx = rx - f * L[k] * tx, qy = ry - f * L[k] * ty;
    const dist = Math.hypot(qx, qy);
    if (dist < melhor) {
      melhor = dist;
      s = est[k] + f * (est[k + 1] - est[k]);
      d = (qx * -ty + qy * tx >= 0 ? 1 : -1) * dist;
      kk = k;
    }
  }
  return { s, d: d * eixo.dentro, k: kk };
}

/** Trecho da estaca s (= contencao._trecho_de: searchsorted à direita, preso nas pontas). */
function trechoDe(eixo, s) {
  const { est, M } = eixo;
  let n = 0;
  while (n < est.length && est[n] <= s) n++;
  return Math.min(Math.max(n - 1, 0), M - 1);
}

/** E, N do ponto de estaca s e afastamento d (o inverso de projetar). = contencao.do_eixo. */
export function doEixo(eixo, s, d = 0) {
  const k = trechoDe(eixo, s);
  const { xy, est, t } = eixo;
  const f = (s - est[k]) / (est[k + 1] - est[k]);
  const vx = xy[k + 1][0] - xy[k][0], vy = xy[k + 1][1] - xy[k][1];
  const dd = d * eixo.dentro;
  return [xy[k][0] + f * vx + dd * -t[k][1], xy[k][1] + f * vy + dd * t[k][0]];
}

/** Direção do eixo (unitária, em planta) na estaca s. */
export function tangente(eixo, s) {
  const [tx, ty] = eixo.t[trechoDe(eixo, s)];
  return [tx, ty];
}

/** Metros de verdade por metro de estaca na estaca s (= contencao.metros_por_estaca).
 *  Dentro de um trecho não depende de d (o afastamento é paralelo ao trecho). */
export function metrosPorEstaca(eixo, s, d = 0) {   // eslint-disable-line no-unused-vars
  const k = trechoDe(eixo, s);
  return eixo.L[k] / (eixo.est[k + 1] - eixo.est[k]);
}

/** Perto de um vértice que gira mais de 5°: {erro_m = |d|·Δθ, giro_graus}; senão null.
 *  "Perto" = a menos de |d|·tan(Δθ) do vértice (o salto do mapeamento cabe aí). */
export function pertoDeDobra(eixo, s, d) {
  if (!numOk(s) || !numOk(d) || d === 0) return null;
  let pior = null;
  for (let k = 1; k < eixo.M; k++) {
    const g = Math.abs(eixo.giro[k]);
    if (g <= GIRO_MIN) continue;
    const ds = s - eixo.est[k];
    const kk = ds < 0 ? k - 1 : k;
    const dist = Math.abs(ds) * eixo.L[kk] / (eixo.est[kk + 1] - eixo.est[kk]);
    if (dist > Math.abs(d) * Math.tan(Math.min(g, 1.4)) + 0.01) continue;
    const erro = Math.abs(d) * g;
    if (!pior || erro > pior.erro_m) pior = { erro_m: erro, giro_graus: g * 180 / Math.PI };
  }
  return pior;
}

/** Comprimento ao longo do eixo entre os pés de A e B ([E, N, …]) no afastamento
 *  médio, só quando há vértice que gira mais de 5° entre eles: {m, dobra:true};
 *  senão null (vale o "ao longo" do plano). */
export function aoLongoPeloEixo(eixo, A, B) {
  const pa = projetar(eixo, A[0], A[1]), pb = projetar(eixo, B[0], B[1]);
  const s1 = Math.min(pa.s, pb.s), s2 = Math.max(pa.s, pb.s);
  const dl = (pa.d + pb.d) / 2 * eixo.dentro;          // afastamento para a esquerda do eixo
  const vert = [];
  for (let k = 1; k < eixo.M; k++) if (eixo.est[k] > s1 && eixo.est[k] < s2) vert.push(k);
  if (!vert.some((k) => Math.abs(eixo.giro[k]) > GIRO_MIN)) return null;
  let m = 0, s = s1;
  for (const k of vert) {
    m += (eixo.est[k] - s) * metrosPorEstaca(eixo, (s + eixo.est[k]) / 2);
    m -= dl * eixo.giro[k];                              // o arco do vértice no afastamento
    s = eixo.est[k];
  }
  m += (s2 - s) * metrosPorEstaca(eixo, (s + s2) / 2);
  return { m, dobra: true };
}

/** Normal "para quem olha" (para fora do maciço), em planta, na estaca s. */
function paraFora(eixo, s) {
  const [tx, ty] = tangente(eixo, s);
  return [ty * eixo.dentro, -tx * eixo.dentro, 0];
}

/** Quadro {t, u, n, c} com t da tangente e a normal sem a componente em t (a
 *  mesma conta de medidas.quadroDaFace); sem normal: u = n = null e o aviso. */
function quadroFace(t2, normal, c) {
  const t = unit([t2[0], t2[1], 0]);
  const semNormal = { t, u: null, n: null, c, aviso: "não achei a face aqui: use o plano por 3 pontos" };
  if (!t || !normal) return semNormal;
  const n = unit(sub(normal, esc(t, dot(normal, t))));
  if (!n) return semNormal;
  let u = cross(n, t);
  if (u[2] < 0) u = esc(u, -1);
  return { t, u, n, c };
}

/** Quadro da face "eixo da contenção" de uma medida (7.3): t = tangente na
 *  estaca do ponto médio, n = média das normais guardadas nos pontos (viradas
 *  para fora), c = ponto médio. Leva junto aoLongo (dobra do eixo, 7.4). */
export function quadroDaMedida(eixo, pontos) {
  const P = (pontos || []).map((p) => (Array.isArray(p) ? p : p?.xyz))
    .filter((v) => Array.isArray(v) && v.length >= 3 && numOk(v[0]) && numOk(v[1]) && numOk(v[2]));
  if (!eixo || !P.length) return null;
  const c = [0, 1, 2].map((i) => P.reduce((a, v) => a + v[i], 0) / P.length);
  const s = projetar(eixo, c[0], c[1]).s;
  const fora = paraFora(eixo, s);
  let nm = [0, 0, 0], tem = false;
  for (const p of pontos || []) {
    const v = p && !Array.isArray(p) ? p.normal : null;
    if (!Array.isArray(v) || v.length < 3 || !v.every(numOk)) continue;
    let n = unit(v);
    if (!n) continue;
    if (dot(n, fora) < 0) n = esc(n, -1);
    nm = [nm[0] + n[0], nm[1] + n[1], nm[2] + n[2]];
    tem = true;
  }
  const q = quadroFace(tangente(eixo, s), tem ? nm : null, c);
  q.tipo = "eixo";
  q.aoLongo = (A, B) => aoLongoPeloEixo(eixo, A, B);
  return q;
}

// ------------------------------------------------------ grade da vista frontal

function int16(b64) {
  const bin = atob(b64);
  const out = new Int16Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    out[i] = v >= 32768 ? v - 65536 : v;
  }
  return out;
}

/** Lê a grade (contencao/vista_frontal[_na_face].grade.json, 8.2): decodifica
 *  os int16 em cm e prepara o eixo. Aceita o objeto ou o texto do JSON. */
export function lerGrade(json) {
  const j = typeof json === "string" ? JSON.parse(json) : json;
  if (!j || !j.prof || !j.quadro) return null;
  const g = { ...j, prof: { ...j.prof, v: int16(j.prof.cm_b64) } };
  if (j.cota) g.cota = { ...j.cota, v: int16(j.cota.L_cm_b64) };
  g.eixoPrep = prepararEixo(j.eixo);
  return g;
}

/** d (m) no ponto contínuo (xi, yc) da vista por cota: bilinear SÓ com as
 *  células válidas (pesos renormalizados); nenhuma das 4 -> a válida mais perto
 *  até 3 células ("aproximada"); nenhuma -> null. Célula (i, j) = pixels
 *  [j·k, (j+1)·k) × [i·k, (i+1)·k), centro em ((j+0,5)·k, (i+0,5)·k). */
function profEm(grade, xi, yc) {
  const { k, w, h, v } = grade.prof;
  const u = xi / k - 0.5, q = yc / k - 0.5;
  const j0 = Math.floor(u), i0 = Math.floor(q);
  const fu = u - j0, fq = q - i0;
  let sw = 0, sv = 0;
  const cel = [[i0, j0, (1 - fu) * (1 - fq)], [i0, j0 + 1, fu * (1 - fq)], [i0 + 1, j0, (1 - fu) * fq], [i0 + 1, j0 + 1, fu * fq]];
  for (const [i, j, p] of cel) {
    if (p <= 0 || i < 0 || j < 0 || i >= h || j >= w) continue;
    const val = v[i * w + j];
    if (val === VAZIO) continue;
    sw += p;
    sv += p * val;
  }
  if (sw > 1e-9) return { d: sv / sw / 100, aproximada: false };
  const ic = Math.round(q), jc = Math.round(u);
  let melhor = null, md = Infinity;
  for (let di = -3; di <= 3; di++) {
    for (let dj = -3; dj <= 3; dj++) {
      const i = ic + di, j = jc + dj;
      if (i < 0 || j < 0 || i >= h || j >= w || v[i * w + j] === VAZIO) continue;
      const dd = (i - q) ** 2 + (j - u) ** 2;
      if (dd < md) { md = dd; melhor = v[i * w + j]; }
    }
  }
  return melhor === null ? null : { d: melhor / 100, aproximada: true };
}

/** Coluna do L (m) da vista por cota na coluna contínua xi: linear entre as
 *  colunas decimadas (só em x). Devolve (r) => L da linha r. */
function colunaL(grade, xi) {
  const { L_k, L_w, v } = grade.cota;
  const cc = xi / L_k - 0.5;
  const j0 = Math.min(Math.max(Math.floor(cc), 0), L_w - 1);
  const j1 = Math.min(j0 + 1, L_w - 1);
  const f = Math.min(Math.max(cc - j0, 0), 1);
  return (r) => {
    const a = v[r * L_w + j0], b = v[r * L_w + j1];
    if (a === VAZIO && b === VAZIO) return NaN;
    if (a === VAZIO) return b / 100;
    if (b === VAZIO) return a / 100;
    return ((1 - f) * a + f * b) / 100;
  };
}

/** Cota z onde a coluna de L cruza o valor L (linear entre linhas); null fora. */
function zDeL(grade, xi, L) {
  const c = grade.cota, Lr = colunaL(grade, xi);
  let lo = 0, hi = c.L_h - 1;
  const top = Lr(lo), fundo = Lr(hi);
  if (!(L <= top && L >= fundo)) return null;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (Lr(m) >= L) lo = m; else hi = m;
  }
  const a = Lr(lo), b = Lr(hi);
  const fr = a - b > 0 ? (a - L) / (a - b) : 0;
  return c.z1 - (lo + fr + 0.5) * c.res;
}

/** L (m) na linha contínua yc da vista por cota (inverso de zDeL). */
function LdeZ(grade, xi, yc) {
  const c = grade.cota, Lr = colunaL(grade, xi);
  const rc = yc - 0.5;
  const r0 = Math.min(Math.max(Math.floor(rc), 0), c.L_h - 2);
  return Lr(r0) + (rc - r0) * (Lr(r0 + 1) - Lr(r0));
}

/** Pixel (x, y) da PRANCHA -> {s, z, d, E, N, Z, L, fora, aproximada, dobra}.
 *  Fora da imagem ou sem splat por perto: fora = true e SEM número (E, N, Z null). */
export function pixelParaPonto(grade, eixo, x, y) {
  const e = eixo || grade.eixoPrep;
  const q = grade.quadro, res = grade.res;
  const xi = x - q.esq, yi = y - q.topo;
  const r = { x, y, s: null, z: null, d: null, E: null, N: null, Z: null, L: null, fora: true, aproximada: false, dobra: null };
  if (!(xi >= 0 && xi <= q.W && yi >= 0 && yi <= q.H) || !e) return r;
  r.s = grade.s0 + xi * res;
  let yc;
  if (grade.modo === "face" && grade.cota) {
    r.L = grade.z1 - yi * res;
    r.z = zDeL(grade, xi, r.L);
    if (r.z === null) return r;
    yc = (grade.cota.z1 - r.z) / grade.cota.res;
  } else {
    r.z = grade.z1 - yi * res;
    yc = yi;
  }
  const pd = profEm(grade, xi, yc);
  if (!pd) return r;
  const [E, N] = doEixo(e, r.s, pd.d);
  return { ...r, d: pd.d, E, N, Z: r.z, fora: false, aproximada: pd.aproximada, dobra: pertoDeDobra(e, r.s, pd.d) };
}

/** Ponto E, N, Z -> pixel {x, y} da prancha (o inverso de pixelParaPonto). */
export function pontoParaPixel(grade, eixo, E, N, Z) {
  const e = eixo || grade.eixoPrep;
  const { s } = projetar(e, E, N);
  const xi = (s - grade.s0) / grade.res;
  let yi;
  if (grade.modo === "face" && grade.cota) {
    const L = LdeZ(grade, xi, (grade.cota.z1 - Z) / grade.cota.res);
    yi = (grade.z1 - L) / grade.res;
  } else {
    yi = (grade.z1 - Z) / grade.res;
  }
  return { x: grade.quadro.esq + xi, y: grade.quadro.topo + yi };
}

/** Normal da face no pixel (para fora do maciço), pela superfície da grade
 *  levada ao 3D (diferenças de uma célula em x e em y); null sem splat. */
export function normalDaGrade(grade, eixo, x, y) {
  const e = eixo || grade.eixoPrep;
  const h = grade.prof.k;
  const P = (dx, dy) => {
    const r = pixelParaPonto(grade, e, x + dx, y + dy);
    return r.fora ? null : [r.E, r.N, r.Z];
  };
  const c = P(0, 0);
  if (!c) return null;
  const dif = (mais, menos) => (mais && menos ? sub(mais, menos) : mais ? sub(mais, c) : menos ? sub(c, menos) : null);
  const a = dif(P(h, 0), P(-h, 0)), b = dif(P(0, h), P(0, -h));
  if (!a || !b) return null;
  let n = unit(cross(a, b));
  if (!n) return null;
  const s = projetar(e, c[0], c[1]).s;
  if (dot(n, paraFora(e, s)) < 0) n = esc(n, -1);
  return n;
}

/** Quadro da régua entre as pontas a e b (resultados de pixelParaPonto): t =
 *  tangente na estaca do ponto médio; n = normalDaGrade no meio, sem a
 *  componente em t. Mesma conta de quadroDaMedida (o número da régua = o da
 *  tabela). null se uma ponta está fora. */
export function quadroDaRegua(grade, eixo, a, b) {
  const e = eixo || grade.eixoPrep;
  if (!e || !a || !b || a.fora || b.fora || !numOk(a.E) || !numOk(b.E)) return null;
  const c = [(a.E + b.E) / 2, (a.N + b.N) / 2, (a.Z + b.Z) / 2];
  const s = projetar(e, c[0], c[1]).s;
  const meio = numOk(a.x) && numOk(b.x) ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : null;
  const px = meio || (() => { const p = pontoParaPixel(grade, e, c[0], c[1], c[2]); return [p.x, p.y]; })();
  const q = quadroFace(tangente(e, s), normalDaGrade(grade, e, px[0], px[1]), c);
  q.tipo = "eixo";
  q.aoLongo = (A, B) => aoLongoPeloEixo(e, A, B);
  return q;
}
