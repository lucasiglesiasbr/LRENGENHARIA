// Régua sobre a prancha da vista frontal (página: contencao.js; site:
// vista_site.js). Dois cliques na foto: cada ponta vira um ponto 3D pela grade
// da vista (pixel -> estaca, cota -> E, N pelo eixo + profundidade) e a
// distância sai de medidas.resultado no modo "na face", com o quadro de
// eixo.quadroDaRegua: é a MESMA conta da tabela das Medidas, então o número da
// régua é o mesmo que aparece lá depois de [guardar nas Medidas]. Nunca Δpixel
// × res: o eixo do projeto tem 0,72 a 1,52 m por estaca.
//
// Precisão estimada ±5 a 7 cm (pior onde o pixel passa de 5 cm: 3,6 a 7,6 cm
// por pixel conforme o trecho).

import { pixelParaPonto, quadroDaMedida, quadroDaRegua } from "./eixo.js?v=88bd0fc404";
import { nova, resultado } from "./medidas.js?v=88bd0fc404";

const COR = "#ffd24a";
const COR_APROX = "#ff9f43";
const IMA_PX = 8;                   // imã: a 8 px DE TELA de uma marca
const CLIQUE_PX = 5;                // soltar a menos disto (tela) = clique
const SIGMA_VISTA = 0.05;           // ponto marcado na vista frontal (pixel de 5 cm)
const ESTACA_M = 20;
const NS = "http://www.w3.org/2000/svg";
const FORA = "uma ponta fora do splat: marque de novo";

// ------------------------------------------------------------------ contas

/** Nome da estaca como o splatgeo.grampos.nome_estaca: 37,5 -> "E-1+17,50"; 30 -> "E-1+10". */
export function nomeEstaca(s) {
  if (typeof s !== "number" || !isFinite(s)) return "?";
  if (s < 0) return "antes da E-0 (" + (-s).toFixed(2).replace(".", ",") + " m)";
  const n = Math.floor(s / ESTACA_M + 1e-9);
  const resto = s - n * ESTACA_M;
  if (Math.abs(resto - Math.round(resto)) < 0.005) return "E-" + n + "+" + String(Math.round(resto)).padStart(2, "0");
  return "E-" + n + "+" + resto.toFixed(2).padStart(5, "0").replace(".", ",");
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const m2 = (v) => (typeof v === "number" && isFinite(v)
  ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

/** Ponto "vista frontal" da medida (6.1) a partir de uma ponta (pixelParaPonto). */
function pontoDaVista(p, n) {
  return {
    xyz: [r3(p.E), r3(p.N), r3(p.Z)], de_onde: "vista frontal", sigma_m: SIGMA_VISTA, espessura_m: null,
    qualidade: null, limite: null, aviso: p.aproximada ? "perto da borda do splat" : null, raio: null,
    normal: n ? n.slice(0, 3) : null, splat_xyz: null, encaixe: null, cota_topografo: null, rotulo: null,
    ajuste_mao_m: null, orto: null,
  };
}

/** A régua entre as pontas a e b (resultados de eixo.pixelParaPonto) com o
 *  quadro q (eixo.quadroDaRegua). Devolve {ok:false, motivo} ou {ok:true, res,
 *  medida, rotulo, titulo, avisos, aproximada}. A medida já é a que vai para as
 *  Medidas (dist, na face, face "eixo", 2 pontos "vista frontal", normal = q.n).
 *  Com o eixo (eixo.prepararEixo), a conta usa o quadro que a tabela monta
 *  (eixo.quadroDaMedida sobre os pontos GRAVADOS, 3 casas, com a normal de q):
 *  assim o número é igual ao da tabela até no último milímetro. */
export function medirRegua(a, b, q, eixo = null) {
  if (!a || !b || a.fora || b.fora || !q) return { ok: false, motivo: FORA };
  const nome = "Régua " + nomeEstaca(a.s) + "–" + nomeEstaca(b.s);
  const medida = { ...nova({ tipo: "dist", nome, modo: "face" }), face: { tipo: "eixo" },
    pontos: [pontoDaVista(a, q.n), pontoDaVista(b, q.n)] };
  const res = resultado(medida, { quadro: (eixo && quadroDaMedida(eixo, medida.pontos)) || q });
  if (res.incompleta) return { ok: false, motivo: FORA };
  medida.resultado = res;
  const partes = ["ao longo " + m2(res.ao_longo_m) + " m"];
  if (typeof res.altura_m === "number") {
    partes.push("altura " + m2(Math.abs(res.altura_m)) + " m", "na face " + m2(res.na_face_m) + " m");
    if (Math.abs(res.na_rampa_m - Math.abs(res.altura_m)) >= 0.01) partes.push("na rampa " + m2(res.na_rampa_m) + " m");
  }
  const avisos = [];
  const aproximada = !!(a.aproximada || b.aproximada);
  if (aproximada) avisos.push("(uma ponta perto da borda do splat: medida aproximada)");
  const dobra = Math.max(a.dobra?.erro_m || 0, b.dobra?.erro_m || 0);
  if (dobra > 0) avisos.push("(perto de uma dobra do eixo: ±" + Math.max(1, Math.round(dobra * 100)) + " cm)");
  if (typeof res.altura_m !== "number") avisos.push("(não achei a face aqui: só “ao longo”)");
  if ((res.avisos || []).includes("a face dobra aqui: 'ao longo' pelo eixo")) avisos.push("(o eixo dobra entre as pontas: “ao longo” segue o eixo)");
  const P = medida.pontos.map((p) => p.xyz);
  const d3 = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]);
  const pm = res.pm_desconhecida || typeof res.pm_m !== "number" ? "" : "\n± provável: " + Math.max(1, Math.round(res.pm_m * 100)) +
    " cm (a régua vale ±5 a 7 cm; não inclui o erro do encaixe)";
  const titulo = "distância 3D: " + m2(d3) + " m · estacas: " + m2(Math.abs(b.s - a.s)) + " (só para achar na prancha)" + pm;
  return { ok: true, res, medida, rotulo: partes.join(" · "), titulo, avisos, aproximada };
}

// ------------------------------------------------------------------- tela

/** Liga a régua no SVG da prancha (8.3). converter(x, y) -> ponto (pixelParaPonto)
 *  e quadro(a, b) -> quadro; em vez deles, `grade` (eixo.lerGrade) e `eixo`
 *  opcional. marcas [{x, y, id}] = o imã; zoom() = px de tela por px da prancha.
 *  aoMedir(r | null) a cada medida (null ao limpar); aoGuardar(medida) ou null
 *  (sem o botão). Devolve {ligar, desligar, limpar, ligada(), guardar, ultimo()}. */
export function ligarRegua({ svg, largura, altura, converter = null, quadro = null, grade = null, eixo = null,
  marcas = [], zoom = () => 1, aoMedir = null, aoGuardar = null } = {}) {
  const conv = converter || ((x, y) => pixelParaPonto(grade, eixo, x, y));
  const quad = quadro || ((a, b) => quadroDaRegua(grade, eixo, a, b));
  const W = largura || svg.viewBox?.baseVal?.width || 1;
  const H = altura || svg.viewBox?.baseVal?.height || 1;
  const pai = svg.parentElement;
  if (pai && getComputedStyle(pai).position === "static") pai.style.position = "relative";

  let ligadaAgora = false, A = null, B = null, ult = null, ini = null, guardada = false;
  const g = document.createElementNS(NS, "g");
  g.setAttribute("class", "regua-vista");
  g.style.pointerEvents = "none";
  const rotulo = document.createElement("div");
  rotulo.className = "regua-rotulo";
  Object.assign(rotulo.style, {
    position: "absolute", transform: "translate(-50%, calc(-100% - 10px))", zIndex: 3, display: "none",
    background: "rgba(16,18,22,.94)", border: "1px solid " + COR, borderRadius: "5px", padding: "3px 7px",
    font: "12px/1.35 system-ui, sans-serif", color: COR, whiteSpace: "nowrap", pointerEvents: "auto",
  });

  const z = () => Math.max(1e-3, Number(zoom()) || 1);
  const noSvg = (e) => {
    const q = svg.getBoundingClientRect();
    return [(e.clientX - q.left) / q.width * W, (e.clientY - q.top) / q.height * H];
  };
  /** Imã (marca a 8 px de tela) e Shift (trava horizontal/vertical a partir de A). */
  function ajustarPonta(x, y, e) {
    if (e?.shiftKey && A) {
      if (Math.abs(x - A[0]) >= Math.abs(y - A[1])) y = A[1]; else x = A[0];
      return [x, y];
    }
    const lim = IMA_PX / z();
    let melhor = null, dm = lim;
    for (const m of marcas || []) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d <= dm) { dm = d; melhor = m; }
    }
    return melhor ? [melhor.x, melhor.y] : [x, y];
  }

  function el(tipo, atr, estilo) {
    const e = document.createElementNS(NS, tipo);
    for (const [k, v] of Object.entries(atr)) e.setAttribute(k, v);
    Object.assign(e.style, estilo || {});        // estilo inline: vence o CSS do visor (circle/rect)
    return e;
  }
  function desenhar(cursor) {
    g.replaceChildren();
    if (!A) return;
    const fim = B || cursor;
    const cor = ult?.ok && ult.aproximada && B ? COR_APROX : COR;
    if (fim) {
      g.appendChild(el("line", { x1: A[0], y1: A[1], x2: fim[0], y2: fim[1], "vector-effect": "non-scaling-stroke" },
        { stroke: "#000", strokeWidth: "4px", strokeOpacity: 0.55 }));
      g.appendChild(el("line", { x1: A[0], y1: A[1], x2: fim[0], y2: fim[1], "vector-effect": "non-scaling-stroke" },
        { stroke: cor, strokeWidth: "2px", strokeDasharray: B ? "" : "6 4" }));
    }
    for (const p of [A, B].filter(Boolean)) {
      g.appendChild(el("circle", { cx: p[0], cy: p[1], r: 4 / z(), "vector-effect": "non-scaling-stroke" },
        { fill: cor, stroke: "#000", strokeWidth: "1px", cursor: "default" }));
    }
    if (g.parentNode !== svg || svg.lastChild !== g) svg.appendChild(g);
  }

  function mostrarRotulo() {
    if (!B || !ult) { rotulo.style.display = "none"; return; }
    const mx = (A[0] + B[0]) / 2, my = Math.min(A[1], B[1]);
    rotulo.style.left = (mx / W * 100) + "%";
    rotulo.style.top = (my / H * 100) + "%";
    rotulo.replaceChildren();
    if (!ult.ok) {
      rotulo.style.color = COR_APROX;
      rotulo.style.borderColor = COR_APROX;
      rotulo.textContent = ult.motivo;
      rotulo.title = "";
    } else {
      const cor = ult.aproximada ? COR_APROX : COR;
      rotulo.style.color = cor;
      rotulo.style.borderColor = cor;
      const linha = document.createElement("div");
      linha.innerHTML = "<b></b>";
      linha.firstChild.textContent = ult.rotulo;
      rotulo.appendChild(linha);
      for (const a of ult.avisos) {
        const d = document.createElement("div");
        d.textContent = a;
        d.style.color = COR_APROX;
        rotulo.appendChild(d);
      }
      rotulo.title = ult.titulo;
      if (aoGuardar) {
        const bt = document.createElement("button");
        bt.type = "button";
        bt.textContent = guardada ? "guardada nas Medidas" : "guardar nas Medidas";
        bt.disabled = guardada;
        bt.title = "cria a medida “" + ult.medida.nome + "” (na face, eixo da contenção) na lista das Medidas";
        Object.assign(bt.style, { marginTop: "3px", font: "12px system-ui, sans-serif", cursor: "pointer", width: "auto" });
        bt.onpointerdown = (e) => e.stopPropagation();
        bt.onclick = (e) => { e.stopPropagation(); guardar(); };
        rotulo.appendChild(bt);
      }
    }
    rotulo.style.display = "";
    if (pai && rotulo.parentNode !== pai) pai.appendChild(rotulo);
  }

  function medir() {
    const a = conv(A[0], A[1]), b = conv(B[0], B[1]);
    ult = a && b && !a.fora && !b.fora ? medirRegua(a, b, quad(a, b), eixo || grade?.eixoPrep || null) : { ok: false, motivo: FORA };
    guardada = false;
    desenhar();
    mostrarRotulo();
    aoMedir?.(ult);
  }

  function limpar() {
    A = B = ult = null;
    guardada = false;
    g.replaceChildren();
    rotulo.style.display = "none";
    aoMedir?.(null);
  }

  function guardar() {
    if (!ult?.ok || guardada || !aoGuardar) return null;
    const m = JSON.parse(JSON.stringify(ult.medida));
    const agora = new Date().toISOString();
    m.criada = m.alterada = agora;
    aoGuardar(m);
    guardada = true;
    mostrarRotulo();
    return m;
  }

  // ------------------------------------------------------------ eventos
  const aoApertar = (e) => {
    if (!ligadaAgora || e.button !== 0) return;
    ini = { x: e.clientX, y: e.clientY };
  };
  const aoMover = (e) => {
    if (!ligadaAgora || !A || B) return;
    const [x, y] = noSvg(e);
    desenhar(ajustarPonta(x, y, e));
  };
  const aoSoltar = (e) => {
    if (!ligadaAgora || !ini || e.button !== 0) return;
    const parado = Math.hypot(e.clientX - ini.x, e.clientY - ini.y) <= CLIQUE_PX;
    ini = null;
    if (!parado) return;
    const [x0, y0] = noSvg(e);
    const p = ajustarPonta(x0, y0, e);
    if (!A || B) {                         // 1º clique (ou recomeça depois de uma medida)
      A = p; B = null; ult = null; guardada = false;
      rotulo.style.display = "none";
      desenhar();
      aoMedir?.(null);
      return;
    }
    B = p;
    medir();
  };
  const aoTecla = (e) => {
    if (!ligadaAgora || e.key !== "Escape" || !A) return;   // sem nada marcado o Esc segue (fecha o visor)
    e.preventDefault();
    e.stopImmediatePropagation();
    limpar();
  };

  function ligar() {
    if (ligadaAgora) return;
    ligadaAgora = true;
    svg.addEventListener("pointerdown", aoApertar);
    svg.addEventListener("pointermove", aoMover);
    svg.addEventListener("pointerup", aoSoltar);
    window.addEventListener("keydown", aoTecla, true);
  }
  function desligar() {
    if (!ligadaAgora) return;
    ligadaAgora = false;
    ini = null;
    svg.removeEventListener("pointerdown", aoApertar);
    svg.removeEventListener("pointermove", aoMover);
    svg.removeEventListener("pointerup", aoSoltar);
    window.removeEventListener("keydown", aoTecla, true);
    limpar();
    g.remove();
    rotulo.remove();
  }

  return { ligar, desligar, limpar, ligada: () => ligadaAgora, guardar, ultimo: () => ult };
}
