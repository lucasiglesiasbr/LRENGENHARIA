// "Profundidade da imagem": onde o clique da MEDIÇÃO para dentro do splat, sem
// servidor. O mesmo arquivo roda na página, no site publicado e no node (testes),
// por isso não importa NADA (nem three): recebe arrays, matrizes em `elements`
// (coluna a coluna, como o three) e funções.
//
// Conta (igual a sim2.py, conferida em 6.262 raios da cobaia a 0,007 mm):
//   cada grão é uma gaussiana 3D; ao longo do raio o + t·d entra quem está a até
//   TUBO x (maior semieixo) da reta; o t de cada grão é o PICO da gaussiana no raio
//   e o alfa é a opacidade nesse pico; ordena por t e compõe da frente para trás.
//   t30/t50/t70 = onde a opacidade acumulada passa de 30/50/70 %.
// O clique é um FEIXE de 3x3 raios (±1,5 px): vale a profundidade MEDIANA, e um
// grão solto na frente, que prende um raio só, é descartado (cliqueEmFeixe).
//
// Fonte dos grãos: { n, pos, passo, forma(i, out), maxDe(i), maxEscala() }
//   pos/passo : centro do grão i em pos[passo*i .. +2] (Float32Array)
//   forma     : preenche out = [sx, sy, sz, qw, qx, qy, qz, opacidade]
//   maxDe(i)  : maior semieixo do grão i; maxEscala(): o mesmo para todos (Float32Array)
//
// Grade: montada UMA vez por splat, em fatias (não trava a tela), com orçamento de
// memória e de tempo; sem grade o clique volta ao do Spark ("clique simples").

export const VERSAO = 2;
export const TUBO = 3.2;           // raio do tubo, em maiores semieixos
export const PERTO = 0.02;         // ignora grão colado na origem do raio
export const R0 = 0.05;            // raio de influência do nível 0 da grade
export const LIMITES = [0.3, 0.5, 0.7];
export const FEIXE_PX = 1.5;       // afastamento dos 8 raios vizinhos, em px de tela
export const RASANTE_GRAUS = 35;   // abaixo disso o clique usa 50 %
// Feixe 5x5 do ângulo: passo NO ALVO e faixa de profundidade de cada raio (m). Medido
// nos 600 raios de chão do sim2: com 5 cm o plano de 20 cm é só ruído (24 % dos cliques
// DE CIMA viravam "câmera rasante"); com 20 cm e o ajuste robusto, 3 % de cima, 10 % a
// 45° e 79 % a 25° (que é rasante de verdade).
export const PASSO_PLANO_M = 0.20;
export const FAIXA_PLANO_M = 2.0;
export const TETO_PC = 160e6;      // bytes da grade no PC
export const TETO_CELULAR = 60e6;  // bytes da grade no celular

// Incerteza do clique ao longo do raio: sigma = max(SIGMA_MIN, SIGMA_A + SIGMA_B·espessura).
// Calibração (24/09/2026, refeita depois do conserto do plano 5x5 do ângulo, que antes
// abortava e deixava o raio rasante sem os 50 %): cobaia Jiquirica_teste_orto (1,09 milhão
// de grãos, codificados pelo Spark do vendor), raios dos pares do sim2, feixe 3x3 + plano
// 5x5 como acima, distância contra o DSM do voo (o viés do DSM se cancela na distância); o
// "± provável" de cada distância saiu por diferenças finitas (contrato 7.5).
// Cobertura (erro <= ±): 71 % em n = 385 distâncias — chão 5 m de cima 72 %, chão 20 m
// de cima 73 %, chão 5 m a 45° 79 %, chão 20 m a 45° 75 %, talude 5 m a 45° 62 %, talude
// 20 m a 45° 62 %; 20 pares ficaram sem ± (espessura infinita). Um splat só (a cobaia).
// (Com SIGMA_A = 0, o talude de 20 m ficava em 58 %.)
export const SIGMA_MIN = 0.02;
export const SIGMA_A = 0.0025;
export const SIGMA_B = 0.5;
export const CALIBRACAO = "24/09/2026: cobertura 71 % (60 a 80 % nos 6 grupos), n = 385, cobaia Jiquirica_teste_orto";

const LN2 = Math.LN2;
const mb = (b) => (b < 10e6 ? (b / 1e6).toFixed(1).replace(".", ",") : String(Math.round(b / 1e6))) + " MB";
const agora = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ---------------------------------------------------------------- fontes

/** Arrays planos (teste no node, ou dados que já vieram prontos). */
export function fonteDeArrays({ centros, escalas, quats, opacidades }) {
  const n = opacidades.length;
  return {
    n, pos: centros, passo: 3,
    forma(i, out) {
      const e = 3 * i, q = 4 * i;
      out[0] = escalas[e]; out[1] = escalas[e + 1]; out[2] = escalas[e + 2];
      out[3] = quats[q]; out[4] = quats[q + 1]; out[5] = quats[q + 2]; out[6] = quats[q + 3];
      out[7] = opacidades[i];
    },
    maxDe(i) {
      const e = 3 * i;
      return Math.max(escalas[e], escalas[e + 1], escalas[e + 2]);
    },
    maxEscala() {
      const m = new Float32Array(n);
      for (let i = 0; i < n; i++) m[i] = this.maxDe(i);
      return m;
    },
  };
}

// meia-precisão -> float por tabela (256 KB; funciona em qualquer navegador)
let _meia = null;
function tabelaMeia() {
  if (_meia) return _meia;
  _meia = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
    _meia[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity)
      : s * (1 + f / 1024) * 2 ** (e - 15);
  }
  return _meia;
}

/** O que o Spark 2.2 guarda com `extSplats: true` (SplatMesh.extSplats.extArrays):
 *  extA = [x, y, z (float32), opacidade (meia)], extB = [r|g, b|ln sx, ln sy|ln sz,
 *  quat (oct 10+10 bits + ângulo 12 bits)]. 32 B por grão; o Spark já mantém isso
 *  na memória do navegador — nada é copiado. Mesma conta de decodeExtSplat do Spark
 *  (conferida por conferirDecodificador e pelo teste contra o Spark do vendor). */
export function fonteDeExtArrays(extA, extB, n) {
  const H = tabelaMeia();
  const pos = new Float32Array(extA.buffer, extA.byteOffset, n * 4);
  return {
    n, pos, passo: 4,
    forma(i, out) {
      const i4 = 4 * i;
      out[7] = H[extA[i4 + 3] & 65535];
      out[0] = Math.exp(H[extB[i4 + 1] >>> 16]);
      out[1] = Math.exp(H[extB[i4 + 2] & 65535]);
      out[2] = Math.exp(H[extB[i4 + 2] >>> 16]);
      const c = extB[i4 + 3];
      let fx = ((c & 1023) / 1023 - 0.5) * 2, fy = (((c >>> 10) & 1023) / 1023 - 0.5) * 2;
      const fz = 1 - (Math.abs(fx) + Math.abs(fy)), t = Math.max(-fz, 0);
      fx += fx >= 0 ? -t : t; fy += fy >= 0 ? -t : t;
      const L = Math.hypot(fx, fy, fz), k = L < 1e-6 ? 0 : 1 / L;
      const meio = ((c >>> 20) & 4095) / 4095 * Math.PI * 0.5, s = Math.sin(meio) * k;
      out[3] = Math.cos(meio); out[4] = fx * s; out[5] = fy * s; out[6] = fz * s;
    },
    maxDe(i) {
      const i4 = 4 * i, b = extB[i4 + 2];
      return Math.exp(Math.max(H[extB[i4 + 1] >>> 16], H[b & 65535], H[b >>> 16]));
    },
    maxEscala() {
      const m = new Float32Array(n);
      for (let i = 0; i < n; i++) m[i] = this.maxDe(i);
      return m;
    },
  };
}

/** Grãos de um SplatMesh do Spark (extSplats: true). null se não houver como ler
 *  (sem extSplats, splat descartado ou arrays menores que numSplats). */
export function fonteDeSplatMesh(malha) {
  const ext = malha && malha.extSplats;
  if (!ext || !ext.extArrays || !ext.extArrays[0] || !ext.extArrays[1]) return null;
  const n = ext.numSplats | 0, [a, b] = ext.extArrays;
  if (!(n > 0) || a.length < 4 * n || b.length < 4 * n) return null;
  return fonteDeExtArrays(a, b, n);
}

// ---------------------------------------------------------------- grade

/** Bytes que a grade vai ocupar (antes de montar): 8 B/grão (maior semieixo + lista)
 *  + 20 B por posição da tabela de células (a tabela começa com 0,6 posição por grão;
 *  a cobaia tem ~0,26 célula ocupada por grão). ~27 B/grão no total. */
export function estimarBytes(n) {
  return 8 * n + 20 * tamanhoDaTabela(n);
}

function tamanhoDaTabela(n) {
  let cap = 1024;
  while (cap < 0.6 * n) cap *= 2;
  return cap;
}

/** Teto de memória da grade: 60 MB no celular (ou aparelho com <= 4 GB), 160 MB no PC.
 *  `movel` vem de quem chama (a cena usa o isMobile() do Spark). */
export function tetoDeMemoria(movel = false) {
  let pouca = false;
  try { pouca = typeof navigator !== "undefined" && navigator.deviceMemory > 0 && navigator.deviceMemory <= 4; } catch { /* sem navigator */ }
  return movel || pouca ? TETO_CELULAR : TETO_PC;
}

/** Montagem em passos (gerador): cada `yield` devolve a fração pronta; no fim devolve
 *  a grade ou {cancelada, motivo}. Cada grão entra uma vez, na célula do centro, no
 *  nível do seu raio de influência r = tubo·(maior semieixo); célula do nível = 4/3 do
 *  raio máximo dele (r_l = r0·2^l). Grão com número inválido fica de fora. */
function* montar(fonte, { tubo = TUBO, r0 = R0, fatia = 150000, tetoBytes = Infinity } = {}) {
  const { n, pos, passo } = fonte;
  fatia = Math.max(1000, fatia | 0);
  const temMax = typeof fonte.maxDe === "function";
  const maxs = temMax ? new Float32Array(n) : fonte.maxEscala();
  // 1) caixa dos centros (e o maior semieixo de cada grão)
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let a = 0; a < n; a += fatia) {
    const b = Math.min(n, a + fatia);
    for (let i = a; i < b; i++) {
      if (temMax) maxs[i] = fonte.maxDe(i);
      const p = passo * i, x = pos[p], y = pos[p + 1], z = pos[p + 2];
      if (!(x - x === 0 && y - y === 0 && z - z === 0 && maxs[i] > 0 && maxs[i] < Infinity)) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    yield 0.3 * b / n;
  }
  if (!(x0 <= x1)) { x0 = y0 = z0 = 0; x1 = y1 = z1 = 0; }
  const celula = new Float64Array(32), raioMax = new Float64Array(32), usados = new Uint32Array(32);
  for (let l = 0; l < 32; l++) { raioMax[l] = r0 * 2 ** l; celula[l] = raioMax[l] / 0.75; }
  const nivelDe = (i) => {
    const m = maxs[i];
    if (!(m > 0 && m < Infinity)) return -1;
    const r = tubo * m;
    return r <= r0 ? 0 : Math.min(31, Math.ceil(Math.log(r / r0) / LN2));
  };
  const chaveDe = (l, i) => {
    const p = passo * i, c = celula[l];
    const x = pos[p], y = pos[p + 1], z = pos[p + 2];
    if (!(x - x === 0 && y - y === 0 && z - z === 0)) return -1;
    const ix = Math.min(131071, Math.floor((x - x0) / c));
    const iy = Math.min(131071, Math.floor((y - y0) / c));
    const iz = Math.min(16383, Math.floor((z - z0) / c));
    return ((l * 16384 + iz) * 131072 + iy) * 131072 + ix;
  };
  // 2) tabela de espalhamento (endereçamento aberto) com a contagem por célula;
  //    cresce se passar de 70 % de ocupação
  let cap = tamanhoDaTabela(n), K = new Float64Array(cap).fill(-1), qtd = new Uint32Array(cap);
  let celulas = 0, dentro = 0;
  const dobrarTabela = () => {
    const K2 = new Float64Array(cap * 2).fill(-1), q2 = new Uint32Array(cap * 2), m2 = cap * 2 - 1;
    for (let h = 0; h < cap; h++) {
      if (K[h] === -1) continue;
      let g = hash(K[h]) & m2;
      while (K2[g] !== -1) g = (g + 1) & m2;
      K2[g] = K[h]; q2[g] = qtd[h];
    }
    K = K2; qtd = q2; cap *= 2;
  };
  for (let a = 0; a < n; a += fatia) {
    const b = Math.min(n, a + fatia);
    for (let i = a; i < b; i++) {
      const l = nivelDe(i);
      if (l < 0) continue;
      const k = chaveDe(l, i);
      if (k < 0) continue;
      let h = hash(k) & (cap - 1);
      while (K[h] !== -1 && K[h] !== k) h = (h + 1) & (cap - 1);
      if (K[h] === -1) {
        K[h] = k; celulas++; usados[l]++;
        if (celulas > 0.7 * cap) { dobrarTabela(); h = -1; }
      } else usados[l]++;
      if (h < 0) { h = hash(k) & (cap - 1); while (K[h] !== k) h = (h + 1) & (cap - 1); }
      qtd[h]++; dentro++;
    }
    yield 0.3 + 0.35 * b / n;
  }
  const bytes = maxs.byteLength + 4 * dentro + 20 * cap;
  if (bytes > tetoBytes) {
    return { cancelada: true, motivo: `a grade precisaria de ${mb(bytes)} (limite ${mb(tetoBytes)})` };
  }
  // 3) início de cada célula na lista (soma acumulada) e a lista de grãos por célula
  const ini = new Uint32Array(cap);
  let acum = 0;
  for (let h = 0; h < cap; h++) { ini[h] = acum; acum += qtd[h]; qtd[h] = 0; }
  const lista = new Uint32Array(dentro);
  const mascara = cap - 1;
  for (let a = 0; a < n; a += fatia) {
    const b = Math.min(n, a + fatia);
    for (let i = a; i < b; i++) {
      const l = nivelDe(i);
      if (l < 0) continue;
      const k = chaveDe(l, i);
      if (k < 0) continue;
      let h = hash(k) & mascara;
      while (K[h] !== k) h = (h + 1) & mascara;
      lista[ini[h] + qtd[h]++] = i;
    }
    yield 0.65 + 0.35 * b / n;
  }
  const niveis = [];
  for (let l = 0; l < 32; l++) if (usados[l]) niveis.push(l);
  const marca = new Uint32Array(cap);
  return {
    fonte, maxs, tubo, r0, caixa: [x0, y0, z0, x1, y1, z1], celula, raioMax, niveis,
    K, ini, qtd, lista, mascara, marca, consulta: 0, celulas, n: dentro,
    bytes: maxs.byteLength + K.byteLength + ini.byteLength + qtd.byteLength + lista.byteLength + marca.byteLength,
  };
}

/** Grade de uma vez (testes e dados pequenos). Sem teto, a não ser que venha em opcoes. */
export function construirGradeSincrona(fonte, opcoes = {}) {
  const it = montar(fonte, opcoes);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

/** Grade em fatias assíncronas (um setTimeout(0) a cada `fatia` grãos): a tela não
 *  trava e `progresso(fração)` alimenta a dica "preparando o clique fino… X %".
 *  Cancela (e devolve {cancelada:true, motivo}) se a estimativa de memória passar de
 *  `tetoBytes` ou se a montagem passar de `prazoMs` (então vem também prazo:true).
 *  O prazo conta só o tempo de TRABALHO (dentro das fatias), não o relógio: com a
 *  página congelada (troca de app no celular) ou a aba escondida (o setTimeout fica
 *  segurado ~1 s), o relógio anda sem a montagem andar, e isso não pode cancelar.
 *  G.trabalho_ms = esse tempo de trabalho (G.ms continua sendo o do relógio). */
export async function construirGrade(fonte, opcoes = {}) {
  const { progresso = null, prazoMs = 4000 } = opcoes;
  const tetoBytes = opcoes.tetoBytes ?? tetoDeMemoria(false);
  const est = estimarBytes(fonte.n);
  if (est > tetoBytes) {
    return { cancelada: true, motivo: `splat grande demais para este aparelho (${mb(est)}; limite ${mb(tetoBytes)})` };
  }
  const t0 = agora();
  let trabalho = 0;
  const it = montar(fonte, { ...opcoes, tetoBytes });
  for (;;) {
    const ti = agora();
    const r = it.next();
    trabalho += agora() - ti;
    if (r.done) {
      if (r.value && !r.value.cancelada) {
        r.value.ms = agora() - t0;
        r.value.trabalho_ms = trabalho;
        try { if (progresso) progresso(1); } catch { /* a dica não pode parar a montagem */ }
      }
      return r.value;
    }
    try { if (progresso) progresso(r.value); } catch { /* idem */ }
    if (trabalho > prazoMs) {
      return { cancelada: true, prazo: true, motivo: `a preparação passou de ${(prazoMs / 1000).toLocaleString("pt-BR")} s` };
    }
    await new Promise((ok) => setTimeout(ok, 0));
  }
}

function hash(k) {                       // chave inteira de até 53 bits -> 32 bits
  const lo = k % 4294967296 | 0, hi = Math.floor(k / 4294967296) | 0;
  let h = Math.imul(lo ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(hi + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
  return h >>> 0;
}

function acharCelula(G, k) {
  let g = hash(k) & G.mascara;
  for (;;) {
    const v = G.K[g];
    if (v === k) return g;
    if (v === -1) return -1;
    g = (g + 1) & G.mascara;
  }
}

// ---------------------------------------------------------------- matrizes (afins, coluna a coluna)

const vet = (v) => (Array.isArray(v) || ArrayBuffer.isView(v) ? v : [v.x, v.y, v.z]);

function aplicar(M, v, w) {
  return [M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + w * M[12],
    M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + w * M[13],
    M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + w * M[14]];
}

/** Inversa de uma matriz afim 4x4 (elements do three). null se degenerada. */
export function inverterAfim(e) {
  const a = e[0], b = e[4], c = e[8], d = e[1], f = e[5], g = e[9], h = e[2], i = e[6], j = e[10];
  const A = f * j - g * i, B = -(d * j - g * h), C = d * i - f * h;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-300)) return null;
  const s = 1 / det;
  const m00 = A * s, m01 = -(b * j - c * i) * s, m02 = (b * g - c * f) * s;
  const m10 = B * s, m11 = (a * j - c * h) * s, m12 = -(a * g - c * d) * s;
  const m20 = C * s, m21 = -(a * i - b * h) * s, m22 = (a * f - b * d) * s;
  const tx = e[12], ty = e[13], tz = e[14];
  return [m00, m10, m20, 0, m01, m11, m21, 0, m02, m12, m22, 0,
    -(m00 * tx + m01 * ty + m02 * tz), -(m10 * tx + m11 * ty + m12 * tz), -(m20 * tx + m21 * ty + m22 * tz), 1];
}

// ---------------------------------------------------------------- raio

let _t = new Float64Array(4096), _a = new Float64Array(4096), _ordem = new Uint32Array(4096);
const _f = new Float64Array(8);

/** Profundidade da imagem ao longo do raio o + t·d. `t` sai em unidades de d (d não
 *  precisa ser unitário; com d unitário do mundo, t sai em metros do mundo).
 *  grades: uma grade G (o, d nas coordenadas do splat), [G, …] (partes no mesmo
 *  referencial) ou [{G, M_inv, fator}] (o, d no MUNDO; cada parte com a inversa da
 *  SUA matrixWorld; fator opcional = |M_inv·d|/|d| se a escala for uniforme). As
 *  amostras de todas as partes entram juntas na mesma composição.
 *  Devolve {t30, t50, t70, opacidade, n, n30}: t = null onde a opacidade não chega;
 *  n30 = grãos com alfa >= 0,05 entre t30 - 0,10 e t30 (diagnóstico "grão solto").
 *  faixa = [t_min, t_max] (unidades de d, opcional): só entram grãos com o pico nessa
 *  faixa; é o que deixa barato o feixe 5x5/7x7 do plano (1 m em volta do alvo). */
export function profundidade(grades, o, d, { perto = PERTO, limites = LIMITES, faixa = null } = {}) {
  o = vet(o); d = vet(d);
  _faixa[0] = faixa ? faixa[0] : -Infinity; _faixa[1] = faixa ? faixa[1] : Infinity;
  let m = 0;
  for (const g of Array.isArray(grades) ? grades : [grades]) {
    if (!g) continue;
    if (g.G) {
      const oo = aplicar(g.M_inv, o, 1), dd = aplicar(g.M_inv, d, 0);
      const dn = g.fator ? g.fator * Math.hypot(d[0], d[1], d[2]) : Math.hypot(dd[0], dd[1], dd[2]);
      m = coletar(g.G, oo, dd, dn, perto, m);
    } else {
      m = coletar(g, o, d, Math.hypot(d[0], d[1], d[2]), perto, m);
    }
  }
  return compor(m, limites);
}

// junta as amostras (t em unidades de d, alfa) de uma grade em _t/_a a partir de m
const _faixa = [-Infinity, Infinity];
function coletar(G, o, d, dn, perto, m) {
  const dl = Math.hypot(d[0], d[1], d[2]);
  if (!(dl > 0)) return m;
  const fa = _faixa[0] * dn, fb = _faixa[1] * dn;   // faixa em unidades do splat
  const dx = d[0] / dl, dy = d[1] / dl, dz = d[2] / dl, ox = o[0], oy = o[1], oz = o[2];
  const { pos, passo } = G.fonte, maxs = G.maxs, tubo2 = G.tubo * G.tubo;
  const [x0, y0, z0, x1, y1, z1] = G.caixa;
  const q = ++G.consulta;
  if (q === 0xffffffff) { G.marca.fill(0); G.consulta = 1; }
  for (const l of G.niveis) {
    const R = G.raioMax[l], c = G.celula[l];
    // recorta a reta na caixa dos centros alargada de R
    let ta = -Infinity, tb = Infinity;
    for (const [oo, dd, lo, hi] of [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]]) {
      if (Math.abs(dd) < 1e-12) { if (oo < lo - R || oo > hi + R) { ta = 1; tb = 0; } continue; }
      let u = (lo - R - oo) / dd, v = (hi + R - oo) / dd;
      if (u > v) [u, v] = [v, u];
      if (u > ta) ta = u; if (v < tb) tb = v;
    }
    if (fa - R - c > ta) ta = fa - R - c;
    if (fb + R + c < tb) tb = fb + R + c;
    if (!(ta <= tb)) continue;
    const baseL = l * 16384, passoT = c / 2;
    let ultimo = -1;
    for (let t = ta; t <= tb + passoT; t += passoT) {
      const cx = Math.floor((ox + t * dx - x0) / c), cy = Math.floor((oy + t * dy - y0) / c),
        cz = Math.floor((oz + t * dz - z0) / c);
      const aqui = ((baseL + cz) * 131072 + cy) * 131072 + cx;
      if (aqui === ultimo) continue;
      ultimo = aqui;
      for (let a = -1; a <= 1; a++) {
        const iz = cz + a; if (iz < 0 || iz > 16383) continue;
        for (let b = -1; b <= 1; b++) {
          const iy = cy + b; if (iy < 0 || iy > 131071) continue;
          for (let e = -1; e <= 1; e++) {
            const ix = cx + e; if (ix < 0 || ix > 131071) continue;
            const g = acharCelula(G, ((baseL + iz) * 131072 + iy) * 131072 + ix);
            if (g < 0 || G.marca[g] === q) continue;
            G.marca[g] = q;
            const fim = G.ini[g] + G.qtd[g];
            for (let j = G.ini[g]; j < fim; j++) {
              const i = G.lista[j], p = passo * i;
              const rx = pos[p] - ox, ry = pos[p + 1] - oy, rz = pos[p + 2] - oz;
              const tc = rx * dx + ry * dy + rz * dz;
              const perp2 = rx * rx + ry * ry + rz * rz - tc * tc, mm = maxs[i];
              if (perp2 > tubo2 * mm * mm) continue;
              const r = gauss(G.fonte, i, rx, ry, rz, dx, dy, dz);
              if (r === null || r[1] < 1 / 255 || r[0] <= perto || r[0] < fa || r[0] > fb) continue;
              if (m === _t.length) crescer();
              _t[m] = r[0] / dn; _a[m] = r[1]; m++;
            }
          }
        }
      }
    }
  }
  return m;
}

function compor(m, limites) {
  // ordena pela distância e compõe a opacidade (frente -> fundo)
  const ordem = _ordem.subarray(0, m);
  for (let i = 0; i < m; i++) ordem[i] = i;
  ordem.sort((u, v) => _t[u] - _t[v]);
  const res = { n: m, opacidade: 0 };
  const nomes = limites.map((x) => "t" + Math.round(x * 100));
  for (const nm of nomes) res[nm] = null;
  let T = 1, k = 0;
  for (let j = 0; j < m; j++) {
    const i = ordem[j];
    T *= 1 - _a[i];
    while (k < limites.length && T < 1 - limites[k]) { res[nomes[k]] = _t[i]; k++; }
  }
  res.opacidade = 1 - T;
  res.n30 = null;
  if (res.t30 != null) {
    let c = 0;
    for (let j = 0; j < m; j++) {
      const i = ordem[j];
      if (_t[i] > res.t30) break;
      if (_t[i] >= res.t30 - 0.10 && _a[i] >= 0.05) c++;
    }
    res.n30 = c;
  }
  return res;
}

function crescer() {
  const n = _t.length * 2;
  const t = new Float64Array(n); t.set(_t); _t = t;
  const a = new Float64Array(n); a.set(_a); _a = a;
  _ordem = new Uint32Array(n);
}

const _g = [0, 0];
/** t do pico da gaussiana ao longo do raio e o alfa nesse pico (como sim2.py). */
function gauss(fonte, i, rx, ry, rz, dx, dy, dz) {
  fonte.forma(i, _f);
  const sx = _f[0], sy = _f[1], sz = _f[2], w = _f[3], x = _f[4], y = _f[5], z = _f[6];
  const nq = 1 / Math.hypot(w, x, y, z);
  const qw = w * nq, qx = x * nq, qy = y * nq, qz = z * nq;
  // colunas de R (quaternion w,x,y,z); p = Rᵀ(o - c)/s, v = Rᵀd/s
  const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
  const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
  const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
  const px = -(r00 * rx + r10 * ry + r20 * rz) / sx, py = -(r01 * rx + r11 * ry + r21 * rz) / sy,
    pz = -(r02 * rx + r12 * ry + r22 * rz) / sz;
  const vx = (r00 * dx + r10 * dy + r20 * dz) / sx, vy = (r01 * dx + r11 * dy + r21 * dz) / sy,
    vz = (r02 * dx + r12 * dy + r22 * dz) / sz;
  const vv = vx * vx + vy * vy + vz * vz;
  if (!(vv > 0)) return null;
  const ts = -(px * vx + py * vy + pz * vz) / vv;
  const ax = px + ts * vx, ay = py + ts * vy, az = pz + ts * vz;
  _g[0] = ts; _g[1] = Math.min(0.99, _f[7] * Math.exp(-0.5 * (ax * ax + ay * ay + az * az)));
  return _g;
}

/** Força bruta (todos os grãos) — só para conferir a grade no teste. t em unidades de d. */
export function profundidadeBruta(fonte, maxs, o, d, { tubo = TUBO, perto = PERTO, limites = LIMITES } = {}) {
  o = vet(o); d = vet(d);
  const dn = Math.hypot(d[0], d[1], d[2]);
  const dx = d[0] / dn, dy = d[1] / dn, dz = d[2] / dn;
  const { n, pos, passo } = fonte, L = [];
  for (let i = 0; i < n; i++) {
    const p = passo * i, rx = pos[p] - o[0], ry = pos[p + 1] - o[1], rz = pos[p + 2] - o[2];
    const tc = rx * dx + ry * dy + rz * dz;
    if (rx * rx + ry * ry + rz * rz - tc * tc > tubo * tubo * maxs[i] * maxs[i]) continue;
    const r = gauss(fonte, i, rx, ry, rz, dx, dy, dz);
    if (r === null || r[1] < 1 / 255 || r[0] <= perto) continue;
    L.push([r[0] / dn, r[1]]);
  }
  L.sort((u, v) => u[0] - v[0]);
  const res = { n: L.length };
  for (const x of limites) res["t" + Math.round(x * 100)] = null;
  let T = 1, k = 0;
  for (const [t, a] of L) {
    T *= 1 - a;
    while (k < limites.length && T < 1 - limites[k]) { res["t" + Math.round(limites[k] * 100)] = t; k++; }
  }
  res.opacidade = 1 - T;
  return res;
}

/** Uso na cena (página e site): raio do three (mundo) -> coordenadas de cada parte ->
 *  profundidade -> pontos de volta no mundo. `malha.matrixWorld.elements` vem do three;
 *  nada de import aqui. G pode ser uma grade ou várias da mesma malha. */
export function pontoNaImagem(G, malha, raio, opcoes) {
  const M_inv = inverterAfim(malha.matrixWorld.elements);
  if (!M_inv) return null;
  const partes = (Array.isArray(G) ? G : [G]).map((g) => ({ G: g, M_inv }));
  const O = raio.origin, D = raio.direction;
  const r = profundidade(partes, [O.x, O.y, O.z], [D.x, D.y, D.z], opcoes);
  const em = (t) => t == null ? null : [O.x + t * D.x, O.y + t * D.y, O.z + t * D.z];
  return { ...r, p30: em(r.t30), p50: em(r.t50), p70: em(r.t70) };
}

// ---------------------------------------------------------------- o clique (feixe)

const mediana = (v) => {
  const s = [...v].sort((a, b) => a - b), k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

/** Sigma do clique ao longo do raio (m), a partir da espessura da imagem; null se a
 *  espessura for infinita (a opacidade não chegou a 70 %). */
export function incertezaDoClique(espessura_m) {
  if (espessura_m == null || !Number.isFinite(espessura_m)) return null;
  return Math.max(SIGMA_MIN, SIGMA_A + SIGMA_B * espessura_m);
}

/** Qualidade do ponto: "firme" (espessura < 10 cm), "razoável" (10 a 40 cm) ou
 *  "duvidoso" (mais de 40 cm, sem 50 %, opacidade < 0,5 ou grão solto na frente). */
export function qualidadeDoClique({ espessura, t50, opacidade, graoSolto }) {
  if (graoSolto || t50 == null || !(opacidade >= 0.5) || !(espessura <= 0.40)) return "duvidoso";
  return espessura < 0.10 ? "firme" : "razoável";
}

/** Ângulo (graus) entre o raio e a superfície de normal `normal` (90 = de frente). */
export function anguloComPlano(d, normal) {
  d = vet(d); normal = vet(normal);
  const dd = Math.hypot(d[0], d[1], d[2]), nn = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(dd > 0 && nn > 0)) return null;
  const c = Math.abs(d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2]) / (dd * nn);
  return Math.asin(Math.min(1, c)) * 180 / Math.PI;
}

/** A regra do clique (feixe 3x3), sem three. `amostrar(dx, dy)` devolve a profundidade
 *  ({t30, t50, t70, opacidade, n30}, t em METROS ao longo do raio, direção unitária)
 *  do raio deslocado dx, dy px de tela do cursor (0, 0 = o raio central), ou null.
 *  opcoes: limite (0,3; a opção escondida pode trocar para 0,5), passo (1,5 px),
 *  angulo = graus entre o raio e a superfície, ou função (T30 em m) -> graus|null
 *  (a cena mede com planoDoFeixe num feixe 5x5 de PASSO_PLANO_M no alvo, cada raio só
 *  com a faixa T30 ± FAIXA_PLANO_M); abaixo de 35° o limite vira 0,5.
 *  Devolve {t, t_limite, t30, espessura, sigma, qualidade, graoSolto, validos, angulo,
 *  rasante, aviso}; t = null quando nenhum raio parou. */
export function cliqueEmFeixe(amostrar, { limite = 0.3, passo = FEIXE_PX, angulo = null } = {}) {
  const p = passo, desl = [[0, 0], [-p, -p], [0, -p], [p, -p], [-p, 0], [p, 0], [-p, p], [0, p], [p, p]];
  const am = desl.map(([dx, dy]) => { try { return amostrar(dx, dy) || null; } catch { return null; } });
  const c = am[0] || {};
  const valores = (k) => am.map((a) => (a ? a[k] : null)).filter((v) => v != null && Number.isFinite(v));
  const combinado = (k) => {                  // mediana dos 9 (>= 5 válidos), senão só o central
    const v = valores(k);
    return v.length >= 5 ? mediana(v) : (c[k] != null && Number.isFinite(c[k]) ? c[k] : null);
  };
  const t30s = valores("t30");
  const T30 = combinado("t30");
  const vazio = { t: null, t_limite: limite, t30: null, espessura: Infinity, sigma: null, qualidade: null,
    graoSolto: false, validos: t30s.length, angulo: null, rasante: false, aviso: null };
  if (T30 == null) return vazio;
  // ângulo com a superfície: raio rasante usa 50 %
  let ang = null;
  try { ang = typeof angulo === "function" ? angulo(T30) : angulo; } catch { ang = null; }
  if (ang != null && !Number.isFinite(ang)) ang = null;
  const rasante = ang != null && ang < RASANTE_GRAUS;
  let lim = rasante ? Math.max(limite, 0.5) : limite;
  let T = lim === 0.3 ? T30 : combinado("t" + Math.round(lim * 100));
  if (T == null) { T = T30; lim = 0.3; }      // 50 % não chegou: fica no 30 %
  // espessura da imagem: frente a fundo do raio central, ou a dispersão do feixe
  let esp = c.t70 != null && c.t30 != null ? Math.abs(c.t70 - c.t30) : Infinity;
  if (t30s.length >= 2) {
    const med = mediana(t30s), mad = mediana(t30s.map((v) => Math.abs(v - med)));
    esp = Math.max(esp, 2 * 1.4826 * mad);
  }
  // grão solto na frente: o raio central parou longe da mediana, ou num grão sozinho
  const graoSolto = c.t30 != null && (Math.abs(c.t30 - T30) > 0.20 ||
    (c.n30 != null && c.n30 <= 2 && c.t30 < T30 - 0.10));
  const qualidade = qualidadeDoClique({ espessura: esp, t50: c.t50 ?? null, opacidade: c.opacidade ?? 0, graoSolto });
  const avisos = [];
  if (graoSolto) avisos.push("grão solto na frente");
  if (rasante) avisos.push("câmera rasante");
  return {
    t: T, t_limite: lim, t30: T30, espessura: esp, sigma: incertezaDoClique(esp), qualidade, graoSolto,
    validos: t30s.length, angulo: ang, rasante, aviso: avisos.length ? avisos.join("; ") : null,
  };
}

/** Plano de um feixe de raios (5x5 para o ângulo, 7x7 no plano local):
 *  `amostrarPonto(i, j)` devolve [x, y, z] do p30 do raio (i, j) (i, j de -meio a +meio)
 *  ou null. Ajuste ROBUSTO: duas voltas tirando quem fica a mais de 2,5 desvios (MAD,
 *  mínimo 1 cm) do plano (um raio que pegou folha ou buraco não entorta o plano).
 *  null com menos de `minimo` pontos. */
export function planoDoFeixe(amostrarPonto, { lado = 5, minimo = 12 } = {}) {
  const meio = (lado - 1) / 2;
  let xyz = [];                   // o ajuste robusto troca a lista (let, não const)
  for (let j = -meio; j <= meio; j++) {
    for (let i = -meio; i <= meio; i++) {
      let p = null;
      try { p = amostrarPonto(i, j); } catch { p = null; }
      if (p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])) xyz.push(p[0], p[1], p[2]);
    }
  }
  if (xyz.length / 3 < minimo) return null;
  let pl = ajustarPlano(xyz);
  for (let volta = 0; pl && volta < 2; volta++) {
    const [nx, ny, nz] = pl.normal, [cx, cy, cz] = pl.centro, m = xyz.length / 3, res = new Float64Array(m);
    for (let i = 0; i < m; i++) res[i] = Math.abs((xyz[3 * i] - cx) * nx + (xyz[3 * i + 1] - cy) * ny + (xyz[3 * i + 2] - cz) * nz);
    const lim = Math.max(0.01, 2.5 * 1.4826 * mediana(res));
    const fica = [];
    for (let i = 0; i < m; i++) if (res[i] <= lim) fica.push(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]);
    if (fica.length === xyz.length || fica.length / 3 < minimo) break;
    xyz = fica; pl = ajustarPlano(xyz);
  }
  return pl;
}

// ---------------------------------------------------------------- vizinhança e plano

/** Centros dos grãos a até `raio` de p (opacidade >= opMin), no máximo `max`.
 *  grades como em profundidade(): com M_inv, p e raio no MUNDO e os centros voltam
 *  ao mundo (escala uniforme). Devolve Float64Array [x, y, z, x, y, z, …]. */
export function vizinhos(grades, p, raio, { opMin = 0.3, max = 4000 } = {}) {
  p = vet(p);
  const saida = [];
  for (const g of Array.isArray(grades) ? grades : [grades]) {
    if (!g || saida.length >= 3 * max) continue;
    if (g.G) {
      const M = inverterAfim(g.M_inv);
      if (!M) continue;
      const esc = Math.hypot(g.M_inv[0], g.M_inv[1], g.M_inv[2]);
      vizinhosEm(g.G, aplicar(g.M_inv, p, 1), raio * esc, opMin, max, saida, M);
    } else vizinhosEm(g, p, raio, opMin, max, saida, null);
  }
  return Float64Array.from(saida);
}

function vizinhosEm(G, p, r, opMin, max, saida, M) {
  const { pos, passo } = G.fonte, [x0, y0, z0] = G.caixa, r2 = r * r;
  for (const l of G.niveis) {
    const c = G.celula[l], baseL = l * 16384;
    const lim = (v, v0, hi) => [Math.max(0, Math.floor((v - r - v0) / c)), Math.min(hi, Math.floor((v + r - v0) / c))];
    const [ax, bx] = lim(p[0], x0, 131071), [ay, by] = lim(p[1], y0, 131071), [az, bz] = lim(p[2], z0, 16383);
    for (let iz = az; iz <= bz; iz++) {
      for (let iy = ay; iy <= by; iy++) {
        for (let ix = ax; ix <= bx; ix++) {
          const g = acharCelula(G, ((baseL + iz) * 131072 + iy) * 131072 + ix);
          if (g < 0) continue;
          const fim = G.ini[g] + G.qtd[g];
          for (let j = G.ini[g]; j < fim; j++) {
            const i = G.lista[j], q = passo * i;
            const x = pos[q], y = pos[q + 1], z = pos[q + 2];
            const ex = x - p[0], ey = y - p[1], ez = z - p[2];
            if (ex * ex + ey * ey + ez * ez > r2) continue;
            G.fonte.forma(i, _f);
            if (!(_f[7] >= opMin)) continue;
            if (M) saida.push(...aplicar(M, [x, y, z], 1)); else saida.push(x, y, z);
            if (saida.length >= 3 * max) return;
          }
        }
      }
    }
  }
}

/** Plano pelos pontos (mínimos quadrados, autovetor do menor autovalor da covariância
 *  por Jacobi 3x3). xyz = [x, y, z, x, y, z, …]. null com menos de 12 pontos.
 *  normal unitária com z >= 0 (se z ~ 0, x >= 0); rms = afastamento médio do plano. */
export function ajustarPlano(xyz) {
  const n = Math.floor(xyz.length / 3);
  if (n < 12) return null;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += xyz[3 * i]; cy += xyz[3 * i + 1]; cz += xyz[3 * i + 2]; }
  cx /= n; cy /= n; cz /= n;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const v = [xyz[3 * i] - cx, xyz[3 * i + 1] - cy, xyz[3 * i + 2] - cz];
    for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) A[a][b] += v[a] * v[b];
  }
  A[1][0] = A[0][1]; A[2][0] = A[0][2]; A[2][1] = A[1][2];
  const { valores, vetores } = jacobi3(A);
  let k = 0;
  if (valores[1] < valores[k]) k = 1;
  if (valores[2] < valores[k]) k = 2;
  let nx = vetores[0][k], ny = vetores[1][k], nz = vetores[2][k];
  const L = Math.hypot(nx, ny, nz);
  if (!(L > 0)) return null;
  nx /= L; ny /= L; nz /= L;
  if (nz < -1e-9 || (Math.abs(nz) <= 1e-9 && nx < 0)) { nx = -nx; ny = -ny; nz = -nz; }
  return { normal: [nx, ny, nz], centro: [cx, cy, cz], rms: Math.sqrt(Math.max(0, valores[k]) / n), n };
}

function jacobi3(A0) {
  const A = A0.map((r) => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let volta = 0; volta < 50; volta++) {
    const fora = Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]);
    const escala = Math.abs(A[0][0]) + Math.abs(A[1][1]) + Math.abs(A[2][2]);
    if (fora <= 1e-15 * (escala || 1)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {             // A = Jᵀ A J
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { valores: [A[0][0], A[1][1], A[2][2]], vetores: V };
}

// ---------------------------------------------------------------- guarda do decodificador

/** Confere o meu decodificador (fonteDeExtArrays) contra o do próprio Spark
 *  (malha.extSplats.getSplat) em `amostras` grãos sorteados com semente fixa:
 *  centro 1e-6, escalas 2e-3 (relativo), |q·q'| >= 0,999, opacidade 3e-3.
 *  Se falhar, a cena desliga a profundidade (o formato interno do Spark mudou). */
export function conferirDecodificador(malha, amostras = 64) {
  const ext = malha && malha.extSplats;
  const pior = { centro: 0, escala: 0, quat: 0, opacidade: 0 };
  if (!ext || typeof ext.getSplat !== "function") {
    return { ok: false, pior, motivo: "o splat não tem extSplats (o Spark mudou ou extSplats: false)" };
  }
  const fonte = fonteDeSplatMesh(malha);
  if (!fonte) return { ok: false, pior, motivo: "não consegui ler os grãos do splat (extArrays)" };
  const n = fonte.n, out = new Float64Array(8);
  let semente = 12345, motivo = null;
  const sorteio = () => { semente = (Math.imul(semente, 1103515245) + 12345) >>> 0; return semente % n; };
  const k = Math.min(amostras, n);
  for (let a = 0; a < k; a++) {
    const i = a === 0 ? 0 : a === 1 ? n - 1 : sorteio();
    let g;
    try { g = ext.getSplat(i); } catch (e) { return { ok: false, pior, motivo: "getSplat do Spark falhou: " + (e && e.message || e) }; }
    const C = [g.center.x, g.center.y, g.center.z], S = [g.scales.x, g.scales.y, g.scales.z];
    const Q = [g.quaternion.w, g.quaternion.x, g.quaternion.y, g.quaternion.z], op = g.opacity;
    fonte.forma(i, out);
    const p = fonte.passo * i;
    const dc = Math.max(Math.abs(C[0] - fonte.pos[p]), Math.abs(C[1] - fonte.pos[p + 1]), Math.abs(C[2] - fonte.pos[p + 2]));
    const de = Math.max(...[0, 1, 2].map((j) => Math.abs(out[j] - S[j]) / Math.max(Math.abs(S[j]), 1e-12)));
    const nq = Math.hypot(...Q) * Math.hypot(out[3], out[4], out[5], out[6]);
    const dq = 1 - Math.abs(Q[0] * out[3] + Q[1] * out[4] + Q[2] * out[5] + Q[3] * out[6]) / (nq || 1);
    const dop = Math.abs(op - out[7]);
    const ruim = (v) => !(v === v);          // NaN
    if (ruim(dc) || ruim(de) || ruim(dq) || ruim(dop)) { motivo = `grão ${i} com número inválido`; pior.centro = NaN; break; }
    pior.centro = Math.max(pior.centro, dc); pior.escala = Math.max(pior.escala, de);
    pior.quat = Math.max(pior.quat, dq); pior.opacidade = Math.max(pior.opacidade, dop);
  }
  if (!motivo) {
    if (pior.centro > 1e-6) motivo = `centro difere ${pior.centro.toExponential(1)}`;
    else if (pior.escala > 2e-3) motivo = `escala difere ${pior.escala.toExponential(1)} (relativo)`;
    else if (pior.quat > 1e-3) motivo = `rotação difere (|q·q'| = ${(1 - pior.quat).toFixed(4)})`;
    else if (pior.opacidade > 3e-3) motivo = `opacidade difere ${pior.opacidade.toExponential(1)}`;
  }
  return { ok: !motivo, pior, motivo: motivo ? "decodificador não bate com o Spark: " + motivo : null };
}
