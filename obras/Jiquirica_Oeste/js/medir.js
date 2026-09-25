// Ferramenta MEDIR (passo "4 Medir" da página e bloco "Medir" do site): uma
// lista de medidas com nome, cada uma com o seu modo (livre, horizontal, prumo,
// na face), o clique que para na superfície do modelo (cena.apontarMedida),
// arrastar, empurrar com as setas, Ctrl+Z, a tabela, o CSV e o medir na
// ortofoto. A MESMA ferramenta roda na página e no site: o que muda vem no ctx
// (gravar, desfazer, eixo, ortofoto, encaixe). As contas são de medidas.js e
// eixo.js (puras); aqui só tela, eventos e estado.
//
//   ctx = { onde: "pagina"|"site", cena, $, S (liga/desliga S.medindo = {id, tipo}),
//           origem() -> [E0, N0, Z0], aviso(texto, tipo), dica(texto), gravar(lista),
//           registrar: ((rotulo) => void) | null, ultimoDesfazer: (() => string|null) | null,
//           redesenhar: (() => void) | null, aoComecar(), descricaoDoPonto(pontoCena),
//           eixo: () => ({pontos, estacas, dentro}) | null, encaixe: () => ({fonte, data}) | null,
//           recalcularSplat: ((splat_xyz) => [E, N, Z]) | null, lupa, splatReduzido,
//           ortofoto: null | {info: async (abrir) => I, tela: (I, z, x, y) => string|Promise,
//                             matrizVoo: () => Matrix4|null, alturaDTM: null|async (I, u, v),
//                             carregarLeaflet: null|async ()}, nomeObra() }
//   ui  = { abrir(lista, {publicadas}), desenhar(), terminar(), foto(), restaurar(f),
//           adicionar(medida), ativo(), lista(), csv(), prender(), contarNoSite() }
//
// Toda mudança: (1) registrar (página: ctx.registrar("medida: …"); site: pilha
// própria de fotos), (2) muda, (3) recalcula o resultado, (4) redesenha, (5) grava
// (ctx.gravar(comPontos(lista))). Medida sem ponto não aparece nem é gravada.
// Coordenadas guardadas: E, N, Z da obra (3 casas); na cena = xyz - origem.
// Nada de api() aqui dentro: o que precisa do servidor vem pelo ctx.

import * as THREE from "three";
import * as M from "./medidas.js?v=88bd0fc404";
import * as EX from "./eixo.js?v=88bd0fc404";
import { fmt } from "./api.js?v=88bd0fc404";

const COR = { splat: 0x4da3ff, desenho: 0xffd24a, aviso: 0xff5c5c, orto: 0x3de66e, sel: 0xffffff, outra: 0x7f8a9a, face: 0xb48cff };
const DO_SPLAT = ["splat", "splat-bruto"];
const DO_DESENHO = ["ponto cotado", "curva", "terreno"];
const LIMITE_PILHA = 40;
const EMPURRAO_MS = 1500;            // empurrões mais juntos que isto = um desfazer só
const FOTO_MAX = 1e6;                // foto do desfazer acima disto: só a medida ativa
const CHAVE_PRENDER = "splatgeo-medir-prender";

const TXT = {
  dist: "clique nos pontos (Esc encerra). Arraste uma bolinha para corrigir; Ctrl+Z tira o último.",
  distToque: "toque nos pontos (Nova distância de novo encerra). Arraste uma bolinha para corrigir; ↶ Desfazer tira o último.",
  area: "clique no contorno; clique no 1º ponto para fechar (Esc encerra).",
  areaToque: "toque no contorno; toque no 1º ponto para fechar (Nova área de novo encerra).",
  face: "clique 3 pontos na face (longe um do outro)",
  emLinha: "esses 3 pontos estão quase em linha: marque mais afastados",
  barrado: "nada mais para desfazer na medida (o resto é do encaixe: saia do Medir para desfazer)",
  transparente: "o splat está transparente, mas o clique ainda para nele; para pegar o desenho escolha 'desenho do topógrafo'",
  semModelo: "não achei o modelo aí (gire a vista ou use 'desenho do topógrafo')",
  semDesenho: "clique sobre o desenho: um ponto cotado, uma curva ou o terreno",
  escondido: "ligue o splat para medir nele",
  local: "Suas medidas ficam só neste navegador. Para mandar à LR, use Baixar medidas e envie o arquivo.",
  arquivoErrado: "esse arquivo não é de medidas do Splat Geo",
  publicada: "medida publicada pela LR Engenharia: só leitura",
  noSite: "leva esta medida para o site na próxima exportação (quem abrir só vê, não muda)",
};
const TITULO_MODO = {
  livre: "Distância de verdade, em 3D, ponto a ponto.",
  horizontal: "Só a distância em planta (como na prancha). A altura dos pontos não entra.",
  prumo: "Só a diferença de altura entre os pontos (o desnível).",
  face: "Mede no plano da face: ao longo da face e altura. O erro de profundidade do clique sai da conta.",
};
const TITULO_PRENDER = {
  splat: "O clique para onde a imagem do modelo 3D fica cheia. Curvas e pontos do desenho não pegam o clique.",
  desenho: "O clique gruda no ponto cotado do topógrafo (coordenada exata do desenho) ou cai na curva/terreno do levantamento. O levantamento é de antes da obra.",
};

const ESTILO = `
.md-botoes { flex-wrap: wrap; }
.md-det { white-space: normal; color: var(--fraco, #9aa3b2); font-size: 12px; }
.md-det b { color: var(--texto, #e6e8ec); font-weight: 600; }
.md-det select { width: auto; padding: 2px 4px; font-size: 12px; }
.md-det button, #medir-mais button { padding: 2px 7px; font-size: 11px; font-weight: 500; }
.md-det .md-l { margin: 2px 0; }
.md-det .md-princ { margin: 5px 0 3px; font-size: 13px; }
.md-det .md-dicamodo { margin: 4px 0; font-style: italic; }
.md-det .md-pontos { margin-top: 4px; max-height: 170px; overflow-y: auto; }
#medir-mais .md-lista { max-height: 38vh; overflow-y: auto; }
.md-det .md-pt { padding: 1px 3px; border-radius: 3px; }
.md-det .md-pt.md-clica { cursor: pointer; }
.md-det .md-pt.md-psel { background: #ffffff22; outline: 1px solid #ffffff88; color: #fff; }
.md-alerta, .md-det .md-alerta { color: var(--alerta, #ffb454); }
#medir-mais { font-size: 12px; margin-top: 6px; }
#medir-mais .md-cap { margin: 4px 0 8px; padding: 6px 7px; border-radius: 5px; background: #1d2530; border-left: 3px solid var(--acento, #4da3ff); }
#medir-mais .md-linha { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin: 3px 0; }
#medir-mais .md-linha > span { color: var(--fraco, #9aa3b2); }
#medir-mais button.md-alt { background: #262b34; color: var(--texto, #e6e8ec); border: 1px solid var(--borda, #2c313a); }
#medir-mais button.md-alt.ativo { background: var(--ok, #57c98a); color: #05210f; }
#medir-mais .md-faixa { margin-top: 5px; padding: 4px 6px; border-radius: 4px; background: #ffffff14; color: #fff; }
#medir-mais .md-titulo { margin: 8px 0 3px; font-weight: 600; color: var(--texto, #e6e8ec); }
#medir-mais .md-item { padding: 4px 5px; margin: 2px 0; border-radius: 4px; border: 1px solid transparent; cursor: pointer; }
#medir-mais .md-item:hover { background: #ffffff0a; }
#medir-mais .md-item.md-ativa { border-color: var(--acento, #4da3ff); background: #4da3ff14; }
#medir-mais .md-item.md-duv .md-val { color: var(--alerta, #ffb454); }
#medir-mais .md-item .md-l1, #medir-mais .md-item .md-l2 { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
#medir-mais .md-item input.md-nome { flex: 1; min-width: 80px; width: auto; padding: 2px 5px; font: inherit; font-size: 12px;
  background: #11141a; color: var(--texto, #e6e8ec); border: 1px solid var(--borda, #2c313a); border-radius: 4px; }
#medir-mais .md-item .md-nomefixo { flex: 1; min-width: 80px; color: var(--texto, #e6e8ec); }
#medir-mais .md-item .md-modo { color: var(--fraco, #9aa3b2); }
#medir-mais .md-item .md-val { font-weight: 600; color: var(--texto, #e6e8ec); }
#medir-mais .md-item .md-pm, #medir-mais .md-item .md-av { color: var(--fraco, #9aa3b2); }
#medir-mais .md-item .md-av { color: var(--alerta, #ffb454); }
#medir-mais .md-item .md-vai { color: var(--ok, #57c98a); font-size: 11px; }
#medir-mais .md-item .md-acoes { margin-left: auto; display: flex; gap: 3px; }
#medir-mais .md-item button { background: #2b313b; color: var(--fraco, #9aa3b2); border: 1px solid transparent; }
#medir-mais .md-item button.ativo { background: var(--ok, #57c98a); color: #05210f; }
#medir-mais .md-vazio { color: var(--fraco, #9aa3b2); font-style: italic; }
#medir-mais .md-local { margin: 6px 0; color: var(--fraco, #9aa3b2); }
#medir-mais details.md-arquivo { margin-top: 6px; }
#medir-mais details.md-arquivo summary { cursor: pointer; color: var(--fraco, #9aa3b2); }
#medir-mais details.md-arquivo .md-linha { margin-top: 5px; }
#medir-mais label.md-check { display: inline-flex; align-items: center; gap: 4px; margin: 0; color: var(--texto, #e6e8ec); font-size: 12px; cursor: pointer; }
canvas.md-lupa { position: absolute; top: 52px; right: 12px; width: 200px; height: 200px; border: 2px solid #4da3ff;
  border-radius: 8px; background: #000; pointer-events: none; z-index: 400; image-rendering: pixelated; }
canvas.md-lupa.md-oculta { display: none; }
`;

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const numOk = (v) => typeof v === "number" && isFinite(v);
const arred = (v, casas) => (numOk(v) ? Math.round(v * 10 ** casas) / 10 ** casas : null);
const lista3 = (v, casas) => [arred(v.x ?? v[0], casas), arred(v.y ?? v[1], casas), arred(v.z ?? v[2], casas)];
const copia = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const agoraISO = () => new Date().toISOString();

/** Número da tela com vírgula e ponto de milhar: o MESMO arredondamento de medidas.textoPrincipal. */
function numTela(v, casas = 2) {
  const s = M.numBR(v, casas);
  if (!s) return "—";
  const [int, dec] = s.split(",");
  const sinal = int.startsWith("-") ? "-" : "";
  return sinal + int.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (dec !== undefined ? "," + dec : "");
}

function ddmm(iso) {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return r ? r[3] + "/" + r[2] : null;
}
function toque() {
  try { return window.matchMedia("(pointer:coarse)").matches; } catch (_) { return false; }
}
function lerLocal(chave) {
  try { return window.localStorage.getItem(chave); } catch (_) { return null; }
}
function gravarLocal(chave, valor) {
  try { window.localStorage.setItem(chave, valor); } catch (_) { /* sem memória no navegador */ }
}
function nomeDeArquivo(t) {
  return String(t || "obra").replace(/[\\/:*?"<>|]+/g, "_").trim() || "obra";
}
function baixar(texto, nome, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function iniciarMedir(ctx) {
  const cena = ctx.cena;
  const $ = ctx.$ || ((s) => document.querySelector(s));
  const site = ctx.onde === "site";
  const onde = site ? "site" : "pagina";
  const canvas = cena.canvas;

  const E = {
    lista: [], publicadas: [], ativaId: null, sel: null,
    prender: lerLocal(CHAVE_PRENDER) === "desenho" ? "desenho" : "splat",
    capturando: null,          // {id, tipo} enquanto a captura está ligada (= ctx.S.medindo)
    geracao: 0,                // muda a cada captura ligada/desligada: clique que voltou tarde não entra
    arrasto: null,             // {i, id, pendente, ini, ultimoEvento, vivo, raf, ocupado, deNovo}
    clique: null,              // {x, y, t, toque} do pointerdown fora das bolinhas
    ocupado: false,            // um clique por vez
    marcandoFace: 0,           // 1..3 = próximo ponto da face; 0 = não está marcando
    pilha: [],                 // site: fotos para o desfazer
    relogioEmpurrao: 0, empurrado: null,
    cacheQuadro: new Map(), eixoTexto: null, eixoPronto: null,
    verTodas: false, arquivoAberto: false,
    orto: { pode: null, visor: null, carregando: false },
    ultimoPontoEm: 0, avisouLocal: false, avisouTransparente: false,
    grade: null,               // {ok, motivo} da última preparação da profundidade
    malhas: [],                // bolinhas e números da ativa na cena (o arrasto move sem redesenhar tudo)
    painelSujo: false,
  };

  // ------------------------------------------------------------ estilo e painel
  if (!document.getElementById("medir-estilo")) {
    const st = document.createElement("style");
    st.id = "medir-estilo";
    st.textContent = ESTILO;
    document.head.appendChild(st);
  }
  let elMais = $("#medir-mais");
  const elInfo = $("#info-medicao");
  if (!elMais) {                          // página ainda sem o #medir-mais: cria logo abaixo do resultado
    elMais = document.createElement("div");
    elMais.id = "medir-mais";
    if (elInfo?.parentNode) elInfo.parentNode.insertBefore(elMais, elInfo.nextSibling);
  }
  const bDist = $("#btn-medir-dist"), bArea = $("#btn-medir-area"), bLimpar = $("#btn-medir-limpar");
  if (bDist) {
    bDist.textContent = "Nova distância";
    bDist.title = "Começa uma medida nova de distância (as anteriores ficam na lista). Apertar de novo encerra";
    bDist.onclick = () => botaoNova("dist");
  }
  if (bArea) {
    bArea.textContent = "Nova área";
    bArea.title = "Começa uma medida nova de área (as anteriores ficam na lista). Apertar de novo encerra";
    bArea.onclick = () => botaoNova("area");
  }
  // o texto novo é mais comprido: a linha dos três botões pode quebrar (na página ela é flex)
  bDist?.parentElement?.classList.add("md-botoes");
  if (bLimpar) {
    bLimpar.textContent = "Apagar pontos desta medida";
    bLimpar.title = "Apaga os pontos da medida ativa (Ctrl+Z desfaz)";
    bLimpar.onclick = () => apagarPontosDaAtiva();
  }
  const entradaArquivo = document.createElement("input");
  entradaArquivo.type = "file";
  entradaArquivo.accept = ".json,application/json";
  entradaArquivo.style.display = "none";
  entradaArquivo.onchange = () => carregarArquivo(entradaArquivo.files?.[0]);
  document.body.appendChild(entradaArquivo);

  // ------------------------------------------------------------ utilidades
  const origem = () => {
    const o = (() => { try { return ctx.origem?.(); } catch (_) { return null; } })();
    return Array.isArray(o) && o.length >= 3 ? o : [0, 0, 0];
  };
  const naCena = (xyz) => { const o = origem(); return new THREE.Vector3(xyz[0] - o[0], xyz[1] - o[1], xyz[2] - o[2]); };
  const dica = (t) => { try { ctx.dica?.(t || ""); } catch (_) { /* nada */ } };
  const aviso = (t, tipo = "") => { try { ctx.aviso?.(t, tipo); } catch (_) { /* nada */ } };
  const acharMedida = (id) => E.lista.find((m) => m.id === id) || E.publicadas.find((m) => m.id === id) || null;
  const ativa = () => (E.ativaId ? acharMedida(E.ativaId) : null);
  const ehPublicada = (m) => !!m && E.publicadas.includes(m);

  function marcaAtual() {
    let e = null;
    try { e = ctx.encaixe?.() || null; } catch (_) { e = null; }
    return e ? M.marcaDoEncaixe(e.fonte) : null;
  }
  function dataDoEncaixe() {
    try { return ctx.encaixe?.()?.data || null; } catch (_) { return null; }
  }
  /** Voo aberto da obra (só a página tem voos; no site null). */
  function vooAtual() {
    try { return ctx.encaixe?.()?.voo || null; } catch (_) { return null; }
  }
  function opcoesAvisos() {
    const encaixe = marcaAtual();
    const d = dataDoEncaixe();
    return { encaixe, datas: encaixe && d ? { [encaixe]: d } : null, splatReduzido: !!ctx.splatReduzido, voo: vooAtual() };
  }
  const deOutroEncaixe = (m) => !!m && !!M.outroEncaixe(m, marcaAtual());
  const podeMexer = (m) => !!m && !ehPublicada(m);
  const podeContinuar = (m) => podeMexer(m) && !deOutroEncaixe(m);

  /** O eixo da contenção (relido a cada vez: chega depois, assíncrono). */
  function eixoAtual() {
    let e = null;
    try { e = ctx.eixo?.() || null; } catch (_) { e = null; }
    if (!e) { E.eixoTexto = null; E.eixoPronto = null; return null; }
    const t = JSON.stringify(e);
    if (t !== E.eixoTexto) { E.eixoTexto = t; E.eixoPronto = EX.prepararEixo(e); }
    return E.eixoPronto;
  }

  /** Quadro da face da medida (7.3), em cache até a medida (ou o eixo) mudar. */
  function quadroDe(m) {
    if (!m || m.modo !== "face") return null;
    const f = m.face || {};
    const eixo = f.tipo === "plano" ? null : eixoAtual();
    const chave = JSON.stringify([f, m.pontos.map((p) => [p.xyz, p.normal]), f.tipo === "plano" ? null : E.eixoTexto]);
    const c = E.cacheQuadro.get(m.id);
    if (c && c.chave === chave) return c.q;
    let q = null;
    if (f.tipo === "plano") {
      const P = (f.pontos || []).filter((p) => Array.isArray(p) && p.length >= 3);
      q = P.length >= 3 ? M.quadroDoPlano(P[0], P[1], P[2]) : null;
    } else if (f.tipo === "eixo" && eixo) {
      q = EX.quadroDaMedida(eixo, m.pontos);
    }
    E.cacheQuadro.set(m.id, { chave, q });
    return q;
  }

  const resultadoDe = (m) => M.resultado(m, { quadro: quadroDe(m) });
  function recalcular(m) {
    m.resultado = resultadoDe(m);
  }

  /** Pontos da medida com o arrasto em curso no lugar (só para desenhar e mostrar). */
  function comArrasto(m) {
    const a = E.arrasto;
    if (!m || !a || !a.vivo || a.id !== m.id || !m.pontos[a.i]) return m;
    const pontos = m.pontos.slice();
    pontos[a.i] = a.vivo;
    return { ...m, pontos };
  }

  // ------------------------------------------------------------ desfazer e gravar
  function foto() {
    const json = JSON.stringify({ lista: E.lista, ativaId: E.ativaId, sel: E.sel });
    if (json.length <= FOTO_MAX) return { json };
    return { soAtiva: true, json: JSON.stringify({ medida: ativa() && !ehPublicada(ativa()) ? ativa() : null, ativaId: E.ativaId, sel: E.sel }) };
  }

  function registrarAntes(rotulo) {
    const texto = "medida: " + rotulo;
    if (ctx.registrar) {
      try { ctx.registrar(texto); } catch (erro) { console.warn("medir: registrar", erro); }
      return;
    }
    E.pilha.push({ rotulo: texto, foto: foto() });
    if (E.pilha.length > LIMITE_PILHA) E.pilha.shift();
  }

  function gravar() {
    try { ctx.gravar?.(M.comPontos(E.lista)); } catch (erro) { console.warn("medir: gravar", erro); }
  }

  /** Uma mudança: registrar, mudar, recalcular, redesenhar, gravar. `fn` devolve a
   *  medida mudada (ou uma lista delas; undefined = a ativa; null = nenhuma). */
  function mudar(rotulo, fn, { registrar = true } = {}) {
    if (registrar) registrarAntes(rotulo);
    const r = fn();
    const mudadas = r === undefined ? [ativa()] : r === null ? [] : [].concat(r);
    const agora = agoraISO();
    for (const m of mudadas) {
      if (!m || ehPublicada(m)) continue;
      recalcular(m);
      m.alterada = agora;
    }
    redesenhar();
    gravar();
  }

  function restaurar(f) {
    if (!f || typeof f.json !== "string") return;
    let d;
    try { d = JSON.parse(f.json); } catch (_) { return; }
    if (f.soAtiva) {
      const m = d.medida;
      if (m && m.id) {
        const i = E.lista.findIndex((q) => q.id === m.id);
        if (i >= 0) E.lista[i] = m; else E.lista.push(m);
      }
    } else {
      // desfazer de outra coisa da página (ponto de controle, giro): as medidas não mudaram
      if (f.json === JSON.stringify({ lista: E.lista, ativaId: E.ativaId, sel: E.sel })) return;
      E.lista = Array.isArray(d.lista) ? d.lista : [];
    }
    E.ativaId = d.ativaId && acharMedida(d.ativaId) ? d.ativaId : ultimaComPontos();
    soltarArrastoSemGravar();
    if (E.capturando) {
      // a captura continua na MESMA medida; se ela sumiu (desfez até antes dela), encerra
      const mc = acharMedida(E.capturando.id);
      if (!podeContinuar(mc)) { terminar(); gravar(); return; }
      E.ativaId = mc.id;
    }
    const m = ativa();
    E.sel = E.capturando && m && Number.isInteger(d.sel) && d.sel >= 0 && d.sel < m.pontos.length ? d.sel : null;
    redesenhar();
    gravar();
  }

  function desfazerSite() {
    const f = E.pilha.pop();
    if (!f) { dica("nada para desfazer na medida"); atualizarPainel(); return; }
    restaurar(f.foto);
    aviso("desfeito: " + f.rotulo, "ok");
  }

  /** O [↶ Desfazer] do painel: no site a pilha própria; na página o desfazer
   *  global, mas só se a última ação guardada for da medida. */
  function desfazerBotao() {
    if (site || !ctx.registrar) { desfazerSite(); return; }
    let topo = null;
    try { topo = ctx.ultimoDesfazer?.() || null; } catch (_) { topo = null; }
    if (!topo || !String(topo).startsWith("medida")) { dica(TXT.barrado); return; }
    $("#btn-desfazer")?.click();
  }

  // ------------------------------------------------------------ abrir e lista
  function ultimaComPontos() {
    const c = M.comPontos(E.lista);
    return c.length ? c[c.length - 1].id : null;
  }

  function abrir(lista, { publicadas = [] } = {}) {
    if (E.capturando || E.orto.visor) terminar({ desenhar: false });
    E.lista = M.normalizar(lista);
    const ids = new Set(E.lista.map((m) => m.id));
    E.publicadas = M.normalizar(publicadas).map((m) => (ids.has(m.id) ? { ...m, id: M.novoId() } : m));
    E.ativaId = ultimaComPontos();
    E.sel = null;
    E.pilha = [];
    E.cacheQuadro.clear();
    E.orto.pode = null;
    // NÃO grava: o formato antigo só é regravado na primeira mudança
    redesenhar();
  }

  /** Tira as medidas vazias (a não ser a que está sendo capturada). */
  function podarVazias() {
    const fica = E.capturando?.id;
    E.lista = E.lista.filter((m) => m.pontos.length > 0 || m.id === fica);
    if (E.ativaId && !acharMedida(E.ativaId)) E.ativaId = ultimaComPontos();
  }

  function adicionar(medida) {
    // a régua da vista frontal manda uma medida nova; sem id o normalizar a leria como antiga
    const base = medida && typeof medida === "object" ? { ...medida } : null;
    if (base && !base.id) base.id = M.novoId();
    if (base && Array.isArray(base.pontos)) base.pontos = base.pontos.map((p) => (Array.isArray(p) ? { xyz: p } : p));
    const n = M.normalizar(base ? [base] : [])[0];
    if (!n) return null;
    if (M.comPontos(E.lista).length >= M.MAX_MEDIDAS) { aviso(`limite de ${M.MAX_MEDIDAS} medidas: apague alguma antes`, "erro"); return null; }
    if (acharMedida(n.id)) n.id = M.novoId();
    if (!medida?.nome) n.nome = M.proximoNome(M.comPontos(E.lista));
    n.no_site = false;
    n.criada = n.criada || agoraISO();
    // a régua da vista frontal pode guardar com a captura de outra medida ligada: a
    // captura se encerra antes (como em ativar()), senão os cliques seguintes no 3D
    // cairiam na medida guardada, que passa a ser a ativa
    if (E.capturando || E.orto.visor) terminar({ desenhar: false });
    mudar(`guardar ${n.nome}`, () => {
      E.lista.push(n);
      E.ativaId = n.id;
      E.sel = null;
      return n;
    });
    return n.id;
  }

  // ------------------------------------------------------------ captura
  function acenderBotoes() {
    bDist?.classList.toggle("ativo", E.capturando?.tipo === "dist");
    bArea?.classList.toggle("ativo", E.capturando?.tipo === "area");
  }

  function dicaDaCaptura() {
    if (!E.capturando) return "";
    if (E.marcandoFace) return TXT.face + ` (${E.marcandoFace} de 3)`;
    const t = toque();
    const base = E.capturando.tipo === "area" ? (t ? TXT.areaToque : TXT.area) : (t ? TXT.distToque : TXT.dist);
    if (E.prender === "splat" && E.grade && !E.grade.ok && E.grade.motivo && E.grade.motivo !== "sem splat") {
      return base + " · clique simples (sem a profundidade da imagem neste navegador: " + E.grade.motivo + ")";
    }
    return base;
  }

  function prepararGrade() {
    if (!cena.prepararProfundidade || E.prender !== "splat") return;
    const g = E.geracao;
    let pronto = false;
    const pr = cena.prepararProfundidade({
      progresso: (f) => {
        if (!pronto && g === E.geracao && E.capturando && f < 1) dica(`preparando o clique fino no modelo… ${Math.round(f * 100)} %`);
      },
    });
    Promise.resolve(pr).then((r) => {
      pronto = true;
      E.grade = r ? { ok: !!r.ok, motivo: r.motivo || null } : null;
      if (g === E.geracao && E.capturando) dica(dicaDaCaptura());
    }).catch(() => { pronto = true; });
  }

  function consultarOrtofoto() {
    if (!ctx.ortofoto || E.orto.pode !== null) return;
    E.orto.pode = false;
    Promise.resolve().then(() => ctx.ortofoto.info(false)).then((I) => {
      E.orto.pode = !!I && (I.pode_marcar === undefined ? numOk(I.largura) : !!I.pode_marcar);
      atualizarPainel();
    }).catch(() => { E.orto.pode = false; });
  }

  /** Liga a captura na medida `m` (nova ou "+ pontos"). */
  function ligarCaptura(m) {
    if (E.capturando) desligarCaptura();
    try { ctx.aoComecar?.(); } catch (erro) { console.warn("medir: aoComecar", erro); }
    if (!acharMedida(m.id)) E.lista.push(m);          // aoComecar pode ter encerrado (e podado) a vazia
    E.geracao++;
    E.ativaId = m.id;
    E.sel = null;
    E.marcandoFace = 0;
    E.capturando = { id: m.id, tipo: m.tipo };
    if (ctx.S) ctx.S.medindo = { ...E.capturando };
    E.avisouTransparente = false;
    acenderBotoes();
    podarVazias();
    dica(dicaDaCaptura());
    prepararGrade();
    consultarOrtofoto();
    redesenhar();
  }

  function botaoNova(tipo) {
    if (E.capturando?.tipo === tipo) { terminar(); return; }
    if (M.comPontos(E.lista).length >= M.MAX_MEDIDAS) { aviso(`limite de ${M.MAX_MEDIDAS} medidas: apague alguma antes`, "erro"); return; }
    let m = ativa();
    // reaproveita a ativa se ela está vazia e é do mesmo tipo
    if (!(m && podeMexer(m) && m.pontos.length === 0 && m.tipo === tipo)) {
      m = M.nova({ tipo, nome: M.proximoNome(M.comPontos(E.lista)) });
      E.lista.push(m);
    }
    ligarCaptura(m);
  }

  function maisPontos(id) {
    const m = acharMedida(id);
    if (!podeContinuar(m)) return;
    ligarCaptura(m);
  }

  function desligarCaptura() {
    const visor = E.orto.visor;
    E.orto.visor = null;
    try { visor?.fechar(); } catch (_) { /* nada */ }
    E.capturando = null;
    E.geracao++;
    if (ctx.S) ctx.S.medindo = null;
    E.marcandoFace = 0;
    E.sel = null;
    soltarArrastoSemGravar();
    E.clique = null;
    acenderBotoes();
    esconderLupa();
  }

  /** Encerra a captura (Esc, botão aceso, outra ferramenta). Idempotente. */
  function terminar({ desenhar: comDesenho = true } = {}) {
    const estava = !!E.capturando || !!E.orto.visor || !!E.arrasto;
    const antes = E.lista.length;
    desligarCaptura();
    try { cena.controles.enabled = true; } catch (_) { /* nada */ }
    podarVazias();
    // a página chama terminarMedicao() em muitos lugares: sem nada ligado, não redesenha
    if (!estava && E.lista.length === antes) return;
    if (estava) dica("");
    if (comDesenho) redesenhar();
  }

  // ------------------------------------------------------------ o ponto de um clique
  /** Ponto da medida (6.1) a partir do retorno de cena.apontarMedida. */
  function pontoDoClique(r, { comNormal = true } = {}) {
    const o = origem();
    const soma = (v, casas) => [arred(v.x + o[0], casas), arred(v.y + o[1], casas), arred(v.z + o[2], casas)];
    const p = {
      xyz: soma(r.ponto, 3), de_onde: r.de_onde,
      sigma_m: arred(r.sigma_m, 4), espessura_m: arred(r.espessura_m, 4),
      qualidade: r.qualidade ?? null, limite: numOk(r.limite) ? r.limite : null, aviso: r.aviso ?? null,
      raio: r.raio?.o && r.raio?.d ? { o: soma(r.raio.o, 4), d: lista3(r.raio.d, 4) } : null,
      normal: null, splat_xyz: null, encaixe: null, cota_topografo: null, rotulo: null, ajuste_mao_m: null, orto: null,
    };
    if (DO_SPLAT.includes(r.de_onde)) {
      p.splat_xyz = Array.isArray(r.splat_xyz) ? r.splat_xyz.map((v) => arred(v, 4)) : null;
      p.encaixe = marcaAtual();
      const voo = vooAtual();              // splat_xyz só vale no splat deste voo
      if (voo) p.voo = voo;
      let n = null;
      if (comNormal && cena.planoLocal) {
        try { n = cena.planoLocal(r.ponto, { direcao: r.raio?.d || null })?.normal || null; } catch (_) { n = null; }
      }
      n = n || r.normal || null;
      p.normal = n ? lista3(n, 4) : null;
    }
    if (r.de_onde === "ponto cotado") {
      p.cota_topografo = numOk(r.cota) ? arred(r.cota + o[2], 3) : p.xyz[2];
      let rot = null;
      try { rot = ctx.descricaoDoPonto?.(r.ponto) || null; } catch (_) { rot = null; }
      p.rotulo = rot;
    }
    return p;
  }

  function motivoSemPonto(r) {
    if (E.prender === "desenho") return TXT.semDesenho;
    if (r?.motivo === "splat escondido") return TXT.escondido;
    return TXT.semModelo;
  }

  const capturada = () => (E.capturando ? acharMedida(E.capturando.id) : null);

  async function capturar(ev) {
    const m = capturada();              // o clique vai para a medida capturada, nunca outra
    if (!E.capturando || !m || E.ocupado) return;
    if (!E.marcandoFace && m.pontos.length >= M.MAX_PONTOS) { aviso(`limite de ${M.MAX_PONTOS} pontos numa medida`, "erro"); return; }
    E.ocupado = true;
    const g = E.geracao;
    let r = null;
    try {
      r = await cena.apontarMedida(ev, { prender: E.prender });
    } catch (erro) {
      console.warn("medir: apontarMedida", erro);
      r = null;
    } finally {
      E.ocupado = false;
    }
    if (g !== E.geracao || !E.capturando || capturada() !== m) return;
    if (r?.grade) {
      const antes = E.grade?.ok;
      E.grade = { ok: !!r.grade.ok, motivo: r.grade.motivo || null };
      if (antes !== E.grade.ok) dica(dicaDaCaptura());
    }
    if (!r || !r.ponto) { aviso(motivoSemPonto(r)); return; }
    if (r.transparente && !E.avisouTransparente) { E.avisouTransparente = true; aviso(TXT.transparente); }
    const p = pontoDoClique(r);
    if (E.marcandoFace) { pontoDaFace(m, p.xyz); return; }
    const primeiraNoSite = site && !E.avisouLocal && M.comPontos(E.lista).length === 0;
    mudar(`ponto ${m.pontos.length + 1} em ${m.nome}`, () => {
      m.pontos.push(p);
      return m;
    });
    E.ultimoPontoEm = Date.now();
    if (primeiraNoSite) { E.avisouLocal = true; aviso(TXT.local); }
  }

  function pontoDaFace(m, xyz) {
    const n = E.marcandoFace;
    mudar(`face de ${m.nome}`, () => {
      if (n === 1 || m.face?.tipo !== "plano") m.face = { tipo: "plano", pontos: [] };
      m.face.pontos.push(xyz);
      return m;
    });
    if (m.face.pontos.length >= 3) {
      const [p1, p2, p3] = m.face.pontos;
      const q = M.quadroDoPlano(p1, p2, p3);
      if (!q) {
        // quadroDoPlano também recusa plano deitado (sem direção "ao longo"): diz qual dos dois
        const a = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]], b = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]];
        const cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const emLinha = Math.hypot(...cr) < 1e-6 * Math.hypot(...a) * Math.hypot(...b);
        const t = emLinha ? TXT.emLinha : "esses 3 pontos estão num plano deitado (chão): para medir no chão use livre ou horizontal";
        E.marcandoFace = 1;
        aviso(t);
        dica(t + " · " + dicaDaCaptura());
      } else {
        E.marcandoFace = 0;
        aviso("face marcada", "ok");
        dica(dicaDaCaptura());
      }
    } else {
      E.marcandoFace = m.face.pontos.length + 1;
      dica(dicaDaCaptura());
    }
    redesenhar();
  }

  function marcarFace() {
    const m = ativa();
    if (!podeContinuar(m)) return;
    if (!E.capturando || E.capturando.id !== m.id) ligarCaptura(m);
    E.marcandoFace = 1;
    E.sel = null;
    dica(dicaDaCaptura());
    redesenhar();
  }

  // ------------------------------------------------------------ eventos na tela
  const tolerancia = (e) => (e?.pointerType === "touch" ? { px: 10, ms: 500 } : { px: 4, ms: 400 });
  const pos = (e) => ({ clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType });

  function aoApertar(e) {
    if (!E.capturando || e.button !== 0 || E.arrasto?.soltando) return;   // o soltar anterior ainda não voltou
    E.clique = null;
    const ini = { x: e.clientX, y: e.clientY, t: Date.now(), tol: tolerancia(e) };
    const m = ativa();
    const bola = m && !E.marcandoFace ? cena.marcaSobCursor(e, 8, "m") : null;
    const i = bola ? Number(String(bola.userData.id).slice(1)) : NaN;
    if (bola && Number.isInteger(i) && m.pontos[i]) {
      E.arrasto = { i, id: m.id, pendente: true, ini, ultimoEvento: pos(e), vivo: null, raf: 0, ocupado: false, deNovo: false };
      cena.controles.enabled = false;
      return;
    }
    E.clique = ini;
  }

  function aoMover(e) {
    desenharLupa(e);
    const a = E.arrasto;
    if (!a) return;
    a.ultimoEvento = pos(e);
    if (a.pendente) {
      if (Math.hypot(e.clientX - a.ini.x, e.clientY - a.ini.y) <= a.ini.tol.px) return;
      a.pendente = false;
      E.sel = null;
    }
    agendarRecaptura();
  }

  function agendarRecaptura() {
    const a = E.arrasto;
    if (!a || a.raf) return;
    a.raf = requestAnimationFrame(() => { a.raf = 0; recapturar(a); });
  }

  /** Arrasto: o ponto é recapturado pela regra do clique, 1x por quadro; se o
   *  clique anterior ainda não voltou, pula o quadro (e refaz quando voltar). */
  async function recapturar(a) {
    if (E.arrasto !== a || a.pendente || a.soltando) return;
    if (a.ocupado) { a.deNovo = true; return; }
    a.ocupado = true;
    const ev = a.ultimoEvento;
    let r = null;
    try { r = await cena.apontarMedida(ev, { prender: E.prender }); } catch (_) { r = null; }
    a.ocupado = false;
    if (E.arrasto !== a || a.soltando) return;
    if (r?.ponto) {
      a.vivo = pontoDoClique(r, { comNormal: false });
    } else {
      const m = acharMedida(a.id);
      const atual = a.vivo || m?.pontos[a.i];
      const p = atual ? cena.pontoNoPlanoDaTela(ev, naCena(atual.xyz)) : null;
      if (p) a.vivo = pontoArrastado(p);
    }
    moverVivo(a);
    if (a.deNovo) { a.deNovo = false; agendarRecaptura(); }
  }

  /** Arrasto ao vivo: move só a bolinha (e o número) e refaz o detalhe; o redesenho
   *  inteiro (que na página também refaz os pontos de controle e o mapa) fica para o soltar. */
  function moverVivo(a) {
    const alvo = E.malhas[a.i];
    if (!a.vivo || !alvo?.esfera) { redesenhar(); return; }
    const v = naCena(a.vivo.xyz);
    alvo.esfera.position.copy(v);
    const r = alvo.rot ? cena.rotulos.find((q) => q.div === alvo.rot) : null;
    if (r) r.posicao.copy(v);
    atualizarInfo();
  }

  function pontoArrastado(pCena) {
    const o = origem();
    return {
      xyz: [arred(pCena.x + o[0], 3), arred(pCena.y + o[1], 3), arred(pCena.z + o[2], 3)], de_onde: "arrastado",
      sigma_m: null, espessura_m: null, qualidade: null, limite: null, aviso: "arrastado", raio: null, normal: null,
      splat_xyz: null, encaixe: null, cota_topografo: null, rotulo: null, ajuste_mao_m: null, orto: null,
    };
  }

  async function soltarArrasto(ev) {
    const a = E.arrasto;
    if (!a || a.soltando) return;
    a.soltando = true;
    if (a.raf) cancelAnimationFrame(a.raf);
    a.raf = 0;
    const m = acharMedida(a.id);
    const g = E.geracao;
    if (!m || !m.pontos[a.i]) { E.arrasto = null; redesenhar(); return; }
    const evento = ev || a.ultimoEvento;
    let r = null;
    try { r = evento ? await cena.apontarMedida(evento, { prender: E.prender }) : null; } catch (_) { r = null; }
    if (E.arrasto !== a || g !== E.geracao) return;
    let novo;
    if (r?.ponto) {
      novo = pontoDoClique(r);
    } else {
      const atual = a.vivo || m.pontos[a.i];
      const p = evento ? cena.pontoNoPlanoDaTela(evento, naCena(atual.xyz)) : null;
      novo = pontoArrastado(p || naCena(atual.xyz));
    }
    E.arrasto = null;
    mudar(`arrastar o ponto ${a.i + 1} de ${m.nome}`, () => {
      m.pontos[a.i] = novo;
      return m;
    });
  }

  function soltarArrastoSemGravar() {
    const a = E.arrasto;
    if (a?.raf) cancelAnimationFrame(a.raf);
    E.arrasto = null;
    try { cena.controles.enabled = true; } catch (_) { /* nada */ }
  }

  function aoSoltar(e) {
    cena.controles.enabled = true;
    if (e.pointerType === "touch") esconderLupa();
    if (!E.capturando) { E.arrasto = null; E.clique = null; return; }
    const a = E.arrasto;
    if (a) {
      if (!a.pendente) { soltarArrasto(pos(e)); return; }
      E.arrasto = null;
      const rapido = Date.now() - a.ini.t <= a.ini.tol.ms;
      if (!rapido) return;
      clicouNaBola(a.i);
      return;
    }
    const c = E.clique;
    E.clique = null;
    if (!c || e.button !== 0) return;
    if (Math.hypot(e.clientX - c.x, e.clientY - c.y) > c.tol.px || Date.now() - c.t > c.tol.ms) return;
    capturar(pos(e));
  }

  function aoSair() {
    cena.controles.enabled = true;
    esconderLupa();
    const a = E.arrasto;
    if (!a) return;
    if (a.pendente) { E.arrasto = null; return; }
    soltarArrasto(null);              // pointerleave solta sem evento: vale o último pointermove
  }

  function clicouNaBola(i) {
    const m = ativa();
    if (!m) return;
    if (m.tipo === "area" && i === 0 && m.pontos.length >= 3) {
      terminar();
      aviso("área fechada", "ok");
      return;
    }
    E.sel = i;
    if (m.pontos.length < 2 || Date.now() - E.ultimoPontoEm < 4000) {
      dica(`selecionei o ponto ${i + 1}; para marcar um ponto novo tão perto, aproxime a vista`);
    }
    redesenhar();
  }

  canvas.addEventListener("pointerdown", aoApertar);
  canvas.addEventListener("pointermove", aoMover);
  canvas.addEventListener("pointerup", aoSoltar);
  canvas.addEventListener("pointerleave", aoSair);
  canvas.addEventListener("pointercancel", aoSair);

  // ------------------------------------------------------------ teclas
  function digitando() {
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA" || a.isContentEditable);
  }

  function aoTeclar(e) {
    if (!E.capturando) return;
    const k = e.key;
    const para = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(k).toLowerCase() === "z") {
      if (digitando()) return;
      if (site || !ctx.registrar) { para(); desfazerSite(); return; }
      let topo = null;
      try { topo = ctx.ultimoDesfazer?.() || null; } catch (_) { topo = null; }
      if (!topo || !String(topo).startsWith("medida")) { para(); dica(TXT.barrado); }
      return;                              // é da medida: o desfazer da página cuida
    }
    if (k === "Escape") {
      if (E.sel !== null) { para(); E.sel = null; dica(dicaDaCaptura()); redesenhar(); return; }
      if (E.marcandoFace) { para(); E.marcandoFace = 0; dica(dicaDaCaptura()); redesenhar(); return; }
      terminar();                          // a página também encerra as outras coisas dela
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || digitando()) return;
    if (k === "Delete" || k === "Backspace") {
      if (E.sel === null) return;
      para();
      apagarPonto(E.sel);
      return;
    }
    if (/^(Arrow(Up|Down|Left|Right)|PageUp|PageDown)$/.test(k)) {
      if (E.sel === null) return;          // sem ponto selecionado a câmera voa como sempre
      para();
      empurrar(k, e.shiftKey ? 0.10 : 0.01);
    }
  }
  document.addEventListener("keydown", aoTeclar, true);

  function apagarPonto(i) {
    const m = ativa();
    if (!podeMexer(m) || !m.pontos[i]) return;
    mudar(`apagar o ponto ${i + 1} de ${m.nome}`, () => {
      m.pontos.splice(i, 1);
      E.sel = null;
      return m;
    });
    dica(dicaDaCaptura());
  }

  function apagarPontosDaAtiva() {
    const m = ativa();
    if (!podeMexer(m) || !m.pontos.length) return;
    mudar(`apagar os pontos de ${m.nome}`, () => {
      m.pontos = [];
      E.sel = null;
      return m;
    });
    if (!E.capturando) { podarVazias(); redesenhar(); }
  }

  /** Setas no ponto selecionado: 1 cm (Shift 10 cm). ←/→ na horizontal da tela
   *  (na face: ao longo), ↑/↓ em Z (na face: subindo na face), PageUp afasta da
   *  câmera ao longo do raio, PageDown aproxima. O raio anda junto com o ponto
   *  (senão, na face, o corte do raio desfaria o empurrão). */
  function empurrar(tecla, passo) {
    const m = ativa();
    const i = E.sel;
    if (!podeMexer(m) || !m.pontos[i]) return;
    const p = m.pontos[i];
    const cam = cena.camera;
    let v;
    const q = m.modo === "face" ? quadroDe(m) : null;
    if (tecla === "ArrowLeft" || tecla === "ArrowRight") {
      const dir = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      dir.z = 0;
      let t = q?.t ? new THREE.Vector3(...q.t) : dir.clone();
      if (q?.t && t.dot(dir) < 0) t.negate();
      if (t.lengthSq() < 1e-12) t = new THREE.Vector3(1, 0, 0);
      v = t.normalize().multiplyScalar(tecla === "ArrowRight" ? passo : -passo);
    } else if (tecla === "ArrowUp" || tecla === "ArrowDown") {
      const u = q?.u ? new THREE.Vector3(...q.u) : new THREE.Vector3(0, 0, 1);
      v = u.normalize().multiplyScalar(tecla === "ArrowUp" ? passo : -passo);
    } else {
      let d = p.raio?.d ? new THREE.Vector3(...p.raio.d) : naCena(p.xyz).sub(cam.position);
      if (d.lengthSq() < 1e-12) d = cam.getWorldDirection(new THREE.Vector3());
      v = d.normalize().multiplyScalar(tecla === "PageUp" ? passo : -passo);
    }
    const agora = Date.now();
    const chave = m.id + ":" + i;
    const junto = agora - E.relogioEmpurrao < EMPURRAO_MS && E.empurrado === chave;
    E.relogioEmpurrao = agora;
    E.empurrado = chave;
    mudar(`empurrar o ponto ${i + 1} de ${m.nome}`, () => {
      p.xyz = [arred(p.xyz[0] + v.x, 3), arred(p.xyz[1] + v.y, 3), arred(p.xyz[2] + v.z, 3)];
      if (p.raio?.o) p.raio = { ...p.raio, o: [arred(p.raio.o[0] + v.x, 4), arred(p.raio.o[1] + v.y, 4), arred(p.raio.o[2] + v.z, 4)] };
      const aj = Array.isArray(p.ajuste_mao_m) && p.ajuste_mao_m.length >= 3 ? p.ajuste_mao_m : [0, 0, 0];
      p.ajuste_mao_m = [arred(aj[0] + v.x, 4), arred(aj[1] + v.y, 4), arred(aj[2] + v.z, 4)];
      const mod = Math.hypot(...p.ajuste_mao_m);
      if (numOk(p.sigma_m) && mod > p.sigma_m) {
        p.sigma_m = null;
        p.aviso = "ajustado à mão";
      }
      return m;
    }, { registrar: !junto });
  }

  // ------------------------------------------------------------ lupa (site)
  let lupa = null, lupaCtx = null;
  function esconderLupa() { lupa?.classList.add("md-oculta"); }
  function desenharLupa(e) {
    if (!ctx.lupa) return;
    if (!E.capturando || E.orto.visor) { esconderLupa(); return; }
    const area = $("#area-3d") || canvas.parentElement;
    if (!lupa) {
      lupa = document.createElement("canvas");
      lupa.className = "md-lupa md-oculta";
      lupa.width = lupa.height = 200;
      lupa.title = "Lupa: onde o clique vai cair (4x)";
      area.appendChild(lupa);
      lupaCtx = lupa.getContext("2d");
    }
    const r = canvas.getBoundingClientRect();
    const ra = area.getBoundingClientRect();
    if (e.pointerType === "touch") {
      // em toque o dedo cobre o canto: a lupa vai 120 px para longe do dedo
      const x = e.clientX - ra.left, y = e.clientY - ra.top;
      let top = y - 120 - 200;
      if (top < 4) top = Math.min(ra.height - 204, y + 120);
      const left = Math.max(4, Math.min(ra.width - 204, x - 100));
      lupa.style.left = left + "px";
      lupa.style.top = top + "px";
      lupa.style.right = "auto";
    } else {
      lupa.style.left = "";
      lupa.style.top = "";
      lupa.style.right = "";
    }
    const kx = canvas.width / r.width, ky = canvas.height / r.height;
    const ZOOM = 4;
    const lado = lupa.width / ZOOM;
    const sx = (e.clientX - r.left) * kx - lado / 2;
    const sy = (e.clientY - r.top) * ky - lado / 2;
    lupa.classList.remove("md-oculta");
    lupaCtx.imageSmoothingEnabled = false;
    lupaCtx.fillStyle = "#000";
    lupaCtx.fillRect(0, 0, lupa.width, lupa.height);
    try { lupaCtx.drawImage(canvas, sx, sy, lado, lado, 0, 0, lupa.width, lupa.height); } catch (_) { /* sem quadro ainda */ }
    const c = lupa.width / 2;
    lupaCtx.strokeStyle = "#4da3ff";
    lupaCtx.lineWidth = 1;
    lupaCtx.beginPath();
    lupaCtx.moveTo(c - 18, c); lupaCtx.lineTo(c - 4, c);
    lupaCtx.moveTo(c + 4, c); lupaCtx.lineTo(c + 18, c);
    lupaCtx.moveTo(c, c - 18); lupaCtx.lineTo(c, c - 4);
    lupaCtx.moveTo(c, c + 4); lupaCtx.lineTo(c, c + 18);
    lupaCtx.stroke();
    lupaCtx.strokeRect(0.5, 0.5, lupa.width - 1, lupa.height - 1);
  }

  // ------------------------------------------------------------ na ortofoto
  async function abrirOrtofoto() {
    const m = ativa();
    if (!ctx.ortofoto || !E.capturando || !podeContinuar(m) || E.orto.carregando) return;
    if (E.orto.visor) return;
    E.orto.carregando = true;
    try {
      const I = await ctx.ortofoto.info(true);
      if (!I || I.pode_marcar === false || !numOk(I.largura)) {
        aviso("a ortofoto do voo não está disponível" + (I?.motivo ? ": " + I.motivo : ""), "erro");
        return;
      }
      const Mv = ctx.ortofoto.matrizVoo?.() || null;
      if (!Mv) { aviso("sem o modelo do drone carregado não dá para levar a ortofoto para a obra", "erro"); return; }
      const Minv = Mv.clone().invert();
      const mod = await import("./medir_orto.js?v=88bd0fc404");
      if (!E.capturando || ativa() !== m) return;
      if (m.pontos.length === 0 && m.tipo === "dist") m.modo = "horizontal";   // medida nova pela ortofoto nasce horizontal
      const paraCena = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(Mv);
      const vooDaCena = (v) => v.clone().applyMatrix4(Minv);
      const topoNoVoo = () => {
        const c = cena.caixaSplatNaCena?.();
        if (!c || c.isEmpty()) return null;
        let z = -Infinity;
        for (const x of [c.min.x, c.max.x]) for (const y of [c.min.y, c.max.y]) for (const zz of [c.min.z, c.max.z]) {
          z = Math.max(z, vooDaCena(new THREE.Vector3(x, y, zz)).z);
        }
        return isFinite(z) ? z : null;
      };
      const alturaSplat = async (x, y) => {
        if (!cena.splat || !cena.profundidadeNoRaio || !cena.prepararProfundidade) return null;
        const pr = await cena.prepararProfundidade();
        if (!pr?.ok) return null;
        const zt = topoNoVoo();
        if (zt === null) return null;
        const o = paraCena(x, y, zt + 50), b = paraCena(x, y, zt + 49);
        const r = cena.profundidadeNoRaio(o, b.sub(o));
        if (!r?.p30) return null;
        const esp = numOk(r.t70) && numOk(r.t30) ? Math.abs(r.t70 - r.t30) : Infinity;
        let sigma = null;
        try { sigma = cena._modProf?.incertezaDoClique?.(esp) ?? null; } catch (_) { sigma = null; }
        return { z_voo: vooDaCena(r.p30).z, sigma_m: sigma };
      };
      const zCena = (x, y) => {
        if (!cena.terreno) return null;
        const zt = topoNoVoo();
        const o = paraCena(x, y, (zt ?? 0) + 200), b = paraCena(x, y, (zt ?? 0) + 199);
        const rc = new THREE.Raycaster(o, b.sub(o).normalize());
        const h = rc.intersectObject(cena.terreno, false)[0];
        return h ? vooDaCena(h.point).z : null;
      };
      const pontosNaFoto = () => {
        const a = ativa();
        if (!a) return [];
        return a.pontos.map((p, i) => {
          const v = vooDaCena(naCena(p.xyz));
          const [u, vv] = mod.pixelDeVoo(I, v.x, v.y);
          return { u, v: vv, n: i + 1, xyz: p.xyz, z_voo: p.orto?.z_de === "nenhum" ? null : v.z };
        });
      };
      E.orto.visor = mod.abrirMedirOrto({
        container: $("#area-3d") || canvas.parentElement,
        I,
        tela: (z, x, y) => ctx.ortofoto.tela(I, z, x, y),
        paraCena: (x, y, z) => paraCena(x, y, z),
        alturaSplat,
        alturaDTM: ctx.ortofoto.alturaDTM ? (u, v) => ctx.ortofoto.alturaDTM(I, u, v) : null,
        zCena,
        modoMedida: () => ativa()?.modo || "livre",
        fechada: () => ativa()?.tipo === "area" && ativa().pontos.length >= 3,
        pontos: pontosNaFoto,
        aoMarcar: async (pp) => pontoDaOrtofoto(pp),
        aoFechar: () => { E.orto.visor = null; atualizarPainel(); },
        carregarLeaflet: ctx.ortofoto.carregarLeaflet || null,
      });
      atualizarPainel();
    } catch (erro) {
      console.warn("medir: ortofoto", erro);
      aviso("não consegui abrir a ortofoto: " + (erro?.message || erro), "erro");
    } finally {
      E.orto.carregando = false;
    }
  }

  function pontoDaOrtofoto(pp) {
    const m = capturada();
    if (!E.capturando || !podeContinuar(m)) return;
    if (m.pontos.length >= M.MAX_PONTOS) { aviso(`limite de ${M.MAX_PONTOS} pontos numa medida`, "erro"); return; }
    const o = origem();
    const c = Array.isArray(pp.cena) ? pp.cena : [pp.cena.x, pp.cena.y, pp.cena.z];
    const z_de = pp.z_de || "nenhum";
    // sigma_m do ponto da ortofoto = o da ALTURA pelo modelo (medidas.js soma o 0,03 da planta sozinho)
    const p = {
      xyz: [arred(c[0] + o[0], 3), arred(c[1] + o[1], 3), arred(c[2] + o[2], 3)], de_onde: "ortofoto",
      sigma_m: z_de === "splat" ? arred(pp.sigma_z_m, 4) : 0.03, espessura_m: null, qualidade: null, limite: null,
      aviso: null, raio: null, normal: null, splat_xyz: null, encaixe: null, cota_topografo: null, rotulo: null,
      ajuste_mao_m: null, orto: { voo: pp.orto?.voo ?? null, px: pp.px || [arred(pp.u, 2), arred(pp.v, 2)], z_de },
    };
    mudar(`ponto ${m.pontos.length + 1} na ortofoto em ${m.nome}`, () => {
      m.pontos.push(p);
      if (z_de === "nenhum") m.modo = m.tipo === "area" ? "livre" : "horizontal";   // sem altura: só planta
      return m;
    });
    E.ultimoPontoEm = Date.now();
  }

  const presaEmPlanta = (m) => !!m && m.pontos.some((p) => p?.de_onde === "ortofoto" && p.orto?.z_de === "nenhum");

  // ------------------------------------------------------------ desenho na cena
  function corDoPonto(p, i, selecionado) {
    if (selecionado) return COR.sel;
    if (p.qualidade === "duvidoso" || (p.aviso && p.aviso !== "levantamento antigo")) return COR.aviso;
    if (p.de_onde === "ortofoto") return COR.orto;
    if (DO_DESENHO.includes(p.de_onde)) return COR.desenho;
    return COR.splat;
  }
  const comAviso = (p) => p.qualidade === "duvidoso" || (!!p.aviso && p.aviso !== "levantamento antigo");
  const rotuloM = (v) => `${numTela(v, 2)} m`;

  function desenharAtiva(m) {
    const P = m.pontos.map((p) => naCena(p.xyz));
    const ids = !!E.capturando && E.capturando.id === m.id;
    E.malhas = [];
    m.pontos.forEach((p, i) => {
      const cor = corDoPonto(p, i, ids && E.sel === i);
      const esfera = cena.marcar(ids ? "m" + i : "", P[i], "", cor);
      const rot = cena.rotular(P[i], String(i + 1) + (comAviso(p) ? "⚠" : ""), cor === COR.splat);
      E.malhas.push({ esfera, rot });
    });
    // pontos da face (plano por 3 pontos)
    if (m.modo === "face" && m.face?.tipo === "plano") {
      (m.face.pontos || []).forEach((xyz, k) => cena.marcar("", naCena(xyz), "F" + (k + 1), COR.face));
      if ((m.face.pontos || []).length >= 2) cena.linhaTracejada?.((m.face.pontos || []).map(naCena).concat([naCena(m.face.pontos[0])]), COR.face);
    }
    if (P.length < 2) return;
    const res = resultadoDe(m);
    const tr = res.trechos || [];
    if (m.tipo === "dist" && m.modo === "horizontal") {
      const z0 = P[0].z;
      const H = P.map((v) => new THREE.Vector3(v.x, v.y, z0));
      cena.desenharLinhaMedida(H, false, COR.splat);
      P.forEach((v, i) => { if (Math.abs(v.z - z0) > 0.005) cena.linhaTracejada?.([H[i], v], COR.splat); });
      tr.forEach((t) => { if (H[t.de - 1] && H[t.a - 1]) cena.rotular(H[t.de - 1].clone().lerp(H[t.a - 1], 0.5), rotuloM(t.valor_m), true); });
      return;
    }
    if (m.tipo === "dist" && m.modo === "prumo") {
      const zs = P.map((v) => v.z);
      const base = P[0];
      cena.desenharLinhaMedida([new THREE.Vector3(base.x, base.y, Math.min(...zs)), new THREE.Vector3(base.x, base.y, Math.max(...zs))], false, COR.splat);
      P.forEach((v, i) => { if (i && Math.hypot(v.x - base.x, v.y - base.y) > 0.005) cena.linhaTracejada?.([v, new THREE.Vector3(base.x, base.y, v.z)], COR.splat); });
      tr.forEach((t) => {
        const a = P[t.de - 1], b = P[t.a - 1];
        if (a && b) cena.rotular(new THREE.Vector3(base.x, base.y, (a.z + b.z) / 2), (t.valor_m > 0 ? "+" : "") + rotuloM(t.valor_m), true);
      });
      return;
    }
    cena.desenharLinhaMedida(P, m.tipo === "area" && P.length > 2, COR.splat);
    tr.forEach((t) => { if (P[t.de - 1] && P[t.a - 1]) cena.rotular(P[t.de - 1].clone().lerp(P[t.a - 1], 0.5), rotuloM(t.valor_m), true); });
  }

  function desenharOutra(m) {
    const P = m.pontos.map((p) => naCena(p.xyz));
    if (!P.length) return;
    P.forEach((v) => cena.marcar("", v, "", COR.outra));
    if (P.length >= 2) cena.desenharLinhaMedida(P, m.tipo === "area" && P.length > 2, COR.outra);
    const meio = P.length >= 2 ? P[Math.floor((P.length - 1) / 2)].clone().lerp(P[Math.floor((P.length - 1) / 2) + 1] || P[0], 0.5) : P[0];
    if (cena.rotuloPequeno) cena.rotuloPequeno(meio, m.nome, COR.outra);
  }

  /** Só desenha na cena (a página limpa antes, em desenharPontosNaCena). */
  function desenhar() {
    E.malhas = [];
    const a = ativa();
    if (E.verTodas) {
      for (const m of [...M.comPontos(E.lista), ...E.publicadas]) if (m !== a) desenharOutra(m);
    }
    if (a) desenharAtiva(comArrasto(a));
    atualizarPainel();
  }

  function redesenhar() {
    if (ctx.redesenhar) {
      try { ctx.redesenhar(); } catch (erro) { console.warn("medir: redesenhar", erro); }
    } else {
      cena.limparMarcas();
      desenhar();
    }
    try { E.orto.visor?.desenhar?.(); } catch (_) { /* nada */ }
  }

  // ------------------------------------------------------------ painel
  function textoPm(res) {
    if (!res || res.incompleta) return "";
    if (res.pm_desconhecida) return "?";
    if (!numOk(res.pm_m)) return "";
    const cm = res.pm_m * 100;
    return cm < 0.5 ? "±<1 cm" : `±${Math.round(cm)} cm`;
  }

  function htmlDetalhe(m) {
    if (!m) return "";
    const mm = comArrasto(m);
    const res = resultadoDe(mm);
    const pub = ehPublicada(m);
    const outro = deOutroEncaixe(m);
    const partes = [];
    // linha do modo
    const presa = presaEmPlanta(m);
    const modos = M.MODOS[m.tipo === "area" ? "area" : "dist"];
    let sel = `<select data-md="modo"${pub || presa ? " disabled" : ""}${presa ? ' title="sem altura nesses pontos: só vale em planta"' : ""}>` +
      modos.map((v) => `<option value="${v}"${v === m.modo ? " selected" : ""} title="${esc(TITULO_MODO[v] || (v === "livre" ? "Área em planta (vista de cima)." : ""))}">${esc(M.rotuloModo(m.tipo, v))}</option>`).join("") +
      "</select>";
    let face = "";
    if (m.modo === "face") {
      const temEixo = !!eixoAtual();
      const tipoFace = m.face?.tipo === "plano" || !temEixo ? "plano" : "eixo";
      face = ` Face: <select data-md="face"${pub ? " disabled" : ""}>` +
        (temEixo ? `<option value="eixo"${tipoFace === "eixo" ? " selected" : ""}>eixo da contenção</option>` : "") +
        `<option value="plano"${tipoFace === "plano" ? " selected" : ""}>plano por 3 pontos</option></select>` +
        (tipoFace === "plano" && !pub && !outro ? ` <button class="secundario" data-md="marcar-face" title="${esc(TXT.face)}">Marcar a face (3 cliques)</button>` : "");
    }
    partes.push(`<div class="md-l">${pub ? "🔒 " : ""}${esc(m.nome)} · medir: ${sel}${face}</div>`);
    // resultado principal
    partes.push(`<div class="md-princ" title="${esc(M.TITULO_PM)}"><b>${esc(M.textoPrincipal(mm, res))}</b></div>`);
    for (const [rot, txt] of M.linhasDoResultado(mm, res)) {
      partes.push(`<div class="md-l">${rot ? esc(rot) + ": " : ""}${esc(txt)}</div>`);
    }
    for (const a of M.avisosDaMedida(mm, res, opcoesAvisos())) partes.push(`<div class="md-l md-alerta">⚠ ${esc(a)}</div>`);
    if (outro && !pub && !site && ctx.recalcularSplat && !M.outroVoo(m, vooAtual())) {
      partes.push(`<div class="md-l"><button class="secundario" data-md="recalcular" title="Leva os pontos do modelo para o encaixe de agora (os do desenho e da ortofoto ficam)">recalcular pelo encaixe atual</button></div>`);
    }
    // dica por modo
    const dm = m.modo === "face" ? "olhe de frente para a face" : m.modo === "prumo" ? "olhe de lado, com a câmera na horizontal" : "no chão, meça de cima ou a 45°";
    partes.push(`<div class="md-dicamodo">${esc(dm)}</div>`);
    if (mm.pontos.length) {
      const clica = !!E.capturando && E.capturando.id === m.id;
      partes.push('<div class="md-pontos">Pontos:' + mm.pontos.map((p, i) => {
        const cls = ["md-pt"];
        if (p.qualidade === "duvidoso") cls.push("md-alerta");
        if (clica) cls.push("md-clica");
        if (clica && E.sel === i) cls.push("md-psel");
        const tit = p.qualidade ? ` title="${esc(M.tituloQualidade(p))}"` : "";
        return `<div class="${cls.join(" ")}" data-md-pt="${i}"${tit}>${esc(M.textoDoPonto(p, i, { onde }))}</div>`;
      }).join("") + "</div>");
    }
    return `<div class="md-det">${partes.join("")}</div>`;
  }

  function htmlItem(m) {
    const res = resultadoDe(m);
    const pub = ehPublicada(m);
    const outro = deOutroEncaixe(m);
    const avisos = M.avisosDaMedida(m, res, opcoesAvisos());
    const nAv = (res.n_duvidosos || 0) + avisos.length;
    const cls = ["md-item"];
    if (m.id === E.ativaId) cls.push("md-ativa");
    if (res.n_duvidosos > 0) cls.push("md-duv");
    const p = res.principal;
    const val = res.incompleta || !p ? "—" : `${numTela(p.valor, 2)} ${p.unidade}`;
    const pm = textoPm(res);
    const titPm = res.pm_desconhecida ? `± desconhecido: ${res.pm_motivo || "ponto sem precisão"}` : M.TITULO_PM;
    const nome = pub
      ? `<span class="md-nomefixo" title="${esc(TXT.publicada)}">🔒 ${esc(m.nome)}</span>`
      : `<input type="text" class="md-nome" data-md-nome="${esc(m.id)}" value="${esc(m.nome)}" maxlength="80" title="nome da medida">`;
    const deOutroVoo = !!M.outroVoo(m, vooAtual());
    const outroIc = outro ? `<span class="md-av" title="${deOutroVoo ? "feita em outro voo: troque para esse voo para continuar"
      : `feita no encaixe de ${esc(ddmm(m.criada) || "outra data")}: não dá para continuar`}">⇄</span>` : "";
    const acoes = [];
    if (!pub && !outro) acoes.push(`<button data-md="mais" title="continuar marcando esta medida">+ pontos</button>`);
    if (!pub && outro && !deOutroVoo && !site && ctx.recalcularSplat) acoes.push(`<button data-md="recalcular" title="recalcular pelo encaixe atual">recalcular</button>`);
    if (!pub && !site) acoes.push(`<button data-md="no-site" class="${m.no_site ? "ativo" : ""}" title="${esc(TXT.noSite)}">no site</button>`);
    if (!pub) acoes.push(`<button data-md="apagar" title="apagar a medida">×</button>`);
    return `<div class="${cls.join(" ")}" data-md-id="${esc(m.id)}"${pub ? ` title="${esc(TXT.publicada)}"` : ""}>` +
      `<div class="md-l1">${nome}${outroIc}<span class="md-modo">${esc(M.rotuloModo(m.tipo, m.modo))}</span></div>` +
      `<div class="md-l2"><span class="md-val">${esc(val)}</span>` +
      (pm ? `<span class="md-pm" title="${esc(titPm)}">${esc(pm)}</span>` : "") +
      (nAv ? `<span class="md-av" title="${esc([res.n_duvidosos ? `${res.n_duvidosos} ponto(s) duvidoso(s)` : "", ...avisos].filter(Boolean).join("\n"))}">⚠ ${nAv}</span>` : "") +
      `<span class="md-acoes">${acoes.join("")}</span></div>` +
      (m.no_site && !site ? '<div class="md-vai">vai no site na próxima exportação</div>' : "") +
      "</div>";
  }

  function htmlPainel() {
    const partes = [];
    if (E.capturando) {
      const cap = [];
      cap.push('<div class="md-linha"><span>O clique pega:</span>' +
        ["splat", "desenho"].map((v) => `<button class="md-alt${E.prender === v ? " ativo" : ""}" data-md="prender" data-v="${v}" title="${esc(TITULO_PRENDER[v])}">${v === "splat" ? "modelo do drone" : "desenho do topógrafo"}</button>`).join("") +
        "</div>");
      const botoes = [];
      if (ctx.ortofoto && E.orto.pode) {
        botoes.push(`<button class="secundario" data-md="orto" title="Marcar os pontos desta medida na foto aérea do voo (2 cm por pixel), para medir em planta no chão"${E.orto.visor ? " disabled" : ""}>Na ortofoto</button>`);
      }
      if (site) botoes.push(`<button class="secundario" data-md="desfazer" title="Desfaz a última mudança nas medidas (Ctrl+Z)"${E.pilha.length ? "" : " disabled"}>↶ Desfazer</button>`);
      if (botoes.length) cap.push(`<div class="md-linha">${botoes.join("")}</div>`);
      const m = ativa();
      if (E.sel !== null && m?.pontos[E.sel]) {
        const n = E.sel + 1;
        cap.push(`<div class="md-faixa">${toque() ? `Ponto ${n} selecionado` : `Ponto ${n} selecionado: setas empurram 1 cm, Delete apaga, Esc solta`}` +
          `<div class="md-linha"><button class="secundario" data-md="apagar-ponto">apagar ponto</button>` +
          `<button class="secundario" data-md="desfazer">↶ Desfazer</button></div></div>`);
      }
      partes.push(`<div class="md-cap">${cap.join("")}</div>`);
    }
    const lista = [...M.comPontos(E.lista), ...E.publicadas];
    partes.push(`<div class="md-titulo">Medidas da obra (${lista.length})</div>`);
    partes.push(lista.length ? `<div class="md-lista">${lista.map(htmlItem).join("")}</div>`
      : '<div class="md-vazio">nenhuma medida ainda: aperte Nova distância ou Nova área</div>');
    if (site) partes.push(`<div class="md-local">${esc(TXT.local)}</div>`);
    const arq = [`<button class="secundario" data-md="csv" title="Baixa a tabela das medidas e dos pontos (abre no Excel)"${lista.length ? "" : " disabled"}>Exportar tabela (CSV)</button>`];
    if (site) {
      arq.push(`<button class="secundario" data-md="baixar" title="Baixa as suas medidas num arquivo, para mandar à LR ou abrir em outro navegador"${M.comPontos(E.lista).length ? "" : " disabled"}>Baixar medidas</button>`);
      arq.push('<button class="secundario" data-md="carregar" title="Abre um arquivo de medidas baixado antes (acrescenta às suas)">Carregar medidas</button>');
    }
    partes.push(`<details class="md-arquivo"${E.arquivoAberto ? " open" : ""}><summary>arquivo</summary>` +
      `<div class="md-linha">${arq.join("")}</div>` +
      `<div class="md-linha"><label class="md-check" title="Mostra também as outras medidas na cena, em cinza, com o nome"><input type="checkbox" data-md="ver-todas"${E.verTodas ? " checked" : ""}> ver todas</label></div>` +
      "</details>");
    return partes.join("");
  }

  function focoNoPainel() {
    const a = document.activeElement;
    if (!a || !(a.tagName === "INPUT" || a.tagName === "SELECT")) return false;
    return !!(elMais?.contains(a) || elInfo?.contains(a));
  }

  function atualizarInfo() {
    if (elInfo && !focoNoPainel()) elInfo.innerHTML = htmlDetalhe(ativa());
  }

  function atualizarPainel() {
    if (focoNoPainel()) { E.painelSujo = true; return; }   // não fecha o select nem tira o foco do nome
    E.painelSujo = false;
    const m = ativa();
    if (elInfo) elInfo.innerHTML = htmlDetalhe(m);
    if (elMais) elMais.innerHTML = htmlPainel();
    if (bLimpar) bLimpar.disabled = !m || !podeMexer(m) || !m.pontos.length;
  }
  const aoPerderFoco = () => setTimeout(() => { if (E.painelSujo && !focoNoPainel()) atualizarPainel(); }, 0);
  elMais?.addEventListener("focusout", aoPerderFoco);
  elInfo?.addEventListener("focusout", aoPerderFoco);

  // cliques no painel (delegação: o painel é refeito a cada mudança)
  elMais?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-md]");
    const item = e.target.closest("[data-md-id]");
    const id = item?.dataset.mdId;
    if (b && b.tagName === "INPUT") return;
    if (!b) {
      if (item && !e.target.closest("input")) ativar(id);
      return;
    }
    e.stopPropagation();
    const acao = b.dataset.md;
    if (acao === "prender") {
      E.prender = b.dataset.v === "desenho" ? "desenho" : "splat";
      gravarLocal(CHAVE_PRENDER, E.prender);
      if (E.prender === "splat") prepararGrade();
      dica(dicaDaCaptura());
      atualizarPainel();
    } else if (acao === "orto") abrirOrtofoto();
    else if (acao === "desfazer") desfazerBotao();
    else if (acao === "apagar-ponto") { if (E.sel !== null) apagarPonto(E.sel); }
    else if (acao === "csv") baixar(csv(), `medidas_${nomeDeArquivo(nomeObra())}.csv`, "text/csv;charset=utf-8");
    else if (acao === "baixar") baixarJSON();
    else if (acao === "carregar") { entradaArquivo.value = ""; entradaArquivo.click(); }
    else if (acao === "mais") maisPontos(id);
    else if (acao === "recalcular") recalcularPeloEncaixe(id);
    else if (acao === "no-site") alternarNoSite(id);
    else if (acao === "apagar") apagarMedida(id);
  });
  elMais?.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset?.md === "ver-todas") { E.verTodas = !!t.checked; redesenhar(); return; }
    if (t.dataset?.mdNome) renomear(t.dataset.mdNome, t.value);
  });
  elMais?.addEventListener("toggle", (e) => {
    if (e.target?.classList?.contains("md-arquivo")) E.arquivoAberto = e.target.open;
  }, true);
  elInfo?.addEventListener("change", (e) => {
    const t = e.target;
    const m = ativa();
    if (!podeMexer(m)) return;
    if (t.dataset?.md === "modo") {
      const v = t.value;
      t.blur();
      if (!M.MODOS[m.tipo].includes(v) || v === m.modo) return;
      mudar(`modo de ${m.nome}`, () => {
        m.modo = v;
        if (v === "face" && !m.face) m.face = eixoAtual() ? { tipo: "eixo" } : { tipo: "plano", pontos: [] };
        return m;
      });
    } else if (t.dataset?.md === "face") {
      const v = t.value;
      t.blur();
      mudar(`face de ${m.nome}`, () => {
        m.face = v === "eixo" ? { tipo: "eixo" } : { tipo: "plano", pontos: m.face?.tipo === "plano" ? m.face.pontos || [] : [] };
        return m;
      });
    }
  });
  elInfo?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-md]");
    if (b?.dataset.md === "marcar-face") { marcarFace(); return; }
    if (b?.dataset.md === "recalcular") { recalcularPeloEncaixe(E.ativaId); return; }
    const pt = e.target.closest("[data-md-pt]");
    if (pt && E.capturando && E.capturando.id === E.ativaId) {
      const i = Number(pt.dataset.mdPt);
      E.sel = E.sel === i ? null : i;
      redesenhar();
    }
  });

  function ativar(id) {
    const m = acharMedida(id);
    if (!m || id === E.ativaId) return;
    if (E.capturando) terminar();
    E.ativaId = id;
    E.sel = null;
    redesenhar();
  }

  function renomear(id, valor) {
    const m = acharMedida(id);
    const nome = String(valor || "").trim().slice(0, 80);
    if (!podeMexer(m) || !nome || nome === m.nome) { atualizarPainel(); return; }
    mudar(`renomear ${m.nome}`, () => { m.nome = nome; return m; });
  }

  function alternarNoSite(id) {
    const m = acharMedida(id);
    if (!podeMexer(m)) return;
    mudar(`${m.no_site ? "tirar do site" : "levar ao site"} ${m.nome}`, () => { m.no_site = !m.no_site; return m; });
  }

  function apagarMedida(id) {
    const m = acharMedida(id);
    if (!podeMexer(m)) return;
    if (!window.confirm(`Apagar a medida “${m.nome}”? (Ctrl+Z desfaz)`)) return;
    if (E.capturando?.id === id) terminar();
    mudar(`apagar ${m.nome}`, () => {
      E.lista = E.lista.filter((q) => q.id !== id);
      if (E.ativaId === id) E.ativaId = ultimaComPontos();
      E.sel = null;
      return null;
    });
  }

  /** Pontos do modelo (com splat_xyz) vão para o encaixe de agora; desenho e ortofoto ficam.
   *  O raio acompanha o ponto (mesma direção, mesma distância da câmera). */
  function recalcularPeloEncaixe(id) {
    const m = acharMedida(id);
    if (!podeMexer(m) || !ctx.recalcularSplat) return;
    // splat_xyz é a coordenada no splat do voo em que o ponto foi feito: pela matriz
    // do splat de OUTRO voo ele cairia em qualquer lugar. Esses pontos ficam.
    const voo = vooAtual();
    const deOutroVoo = (p) => !!voo && !!p.voo && p.voo !== voo;
    if (!m.pontos.some((p) => DO_SPLAT.includes(p.de_onde) && Array.isArray(p.splat_xyz) && !deOutroVoo(p))) {
      aviso(`${m.nome}: feita em outro voo — troque para esse voo para recalcular`, "erro");
      return;
    }
    const marca = marcaAtual();
    mudar(`recalcular ${m.nome} pelo encaixe atual`, () => {
      for (const p of m.pontos) {
        if (!DO_SPLAT.includes(p.de_onde) || !Array.isArray(p.splat_xyz) || deOutroVoo(p)) continue;
        let novo = null;
        try { novo = ctx.recalcularSplat(p.splat_xyz); } catch (_) { novo = null; }
        if (!Array.isArray(novo) || !novo.slice(0, 3).every(numOk)) continue;
        const aj = Array.isArray(p.ajuste_mao_m) ? p.ajuste_mao_m : [0, 0, 0];
        const xyz = [arred(novo[0] + aj[0], 3), arred(novo[1] + aj[1], 3), arred(novo[2] + aj[2], 3)];
        if (p.raio?.o && p.raio?.d) {
          const t = Math.hypot(p.xyz[0] - p.raio.o[0], p.xyz[1] - p.raio.o[1], p.xyz[2] - p.raio.o[2]);
          const d = p.raio.d;
          p.raio = { o: [arred(xyz[0] - d[0] * t, 4), arred(xyz[1] - d[1] * t, 4), arred(xyz[2] - d[2] * t, 4)], d };
        }
        p.xyz = xyz;
        p.encaixe = marca;
      }
      return m;
    });
    aviso(`${m.nome}: recalculada pelo encaixe atual`, "ok");
  }

  // ------------------------------------------------------------ arquivos
  function nomeObra() {
    try { return ctx.nomeObra?.() || "obra"; } catch (_) { return "obra"; }
  }

  function csv() {
    const todas = [...M.comPontos(E.lista), ...E.publicadas];
    const quadros = {};
    for (const m of todas) if (m.modo === "face") quadros[m.id] = quadroDe(m);
    return M.csv(todas, { obra: nomeObra(), quadros, opcoesAvisos: opcoesAvisos() });
  }

  function baixarJSON() {
    const texto = JSON.stringify({ versao: 1, obra: nomeObra(), medidas: M.comPontos(E.lista) }, null, 1);
    baixar(texto, `medidas_${nomeDeArquivo(nomeObra())}.json`, "application/json");
  }

  async function carregarArquivo(arquivo) {
    if (!arquivo) return;
    let d = null;
    try { d = JSON.parse(await arquivo.text()); } catch (_) { d = null; }
    const lista = d && typeof d === "object" && !Array.isArray(d) && Number(d.versao) === 1 && Array.isArray(d.medidas) ? d.medidas : null;
    const novas = lista ? M.normalizar(lista) : [];
    if (!lista || (lista.length && !novas.length)) { aviso(TXT.arquivoErrado, "erro"); return; }
    if (!novas.length) { aviso("o arquivo não tem medidas"); return; }
    const cabem = Math.max(0, M.MAX_MEDIDAS - M.comPontos(E.lista).length);
    const entram = novas.slice(0, cabem);
    mudar(`carregar ${entram.length} medida(s)`, () => {
      for (const m of entram) {
        if (acharMedida(m.id)) m.id = M.novoId();
        m.no_site = false;
        E.lista.push(m);
      }
      if (entram.length) E.ativaId = entram[entram.length - 1].id;
      return entram;
    });
    aviso(`${fmt.inteiro(entram.length)} medida(s) carregada(s)` + (entram.length < novas.length ? ` (limite de ${M.MAX_MEDIDAS})` : ""), "ok");
  }

  // ------------------------------------------------------------ ui
  const ui = {
    abrir,
    desenhar,
    terminar,
    foto,
    restaurar,
    adicionar,
    ativo: () => copia(ativa()),
    lista: () => copia(M.comPontos(E.lista)),
    csv,
    prender: () => E.prender,
    contarNoSite: () => M.comPontos(E.lista).filter((m) => m.no_site).length,
  };
  // depuração e bateria (console): SGmedir.lista(), SGmedir.csv()
  window.SGmedir = ui;
  atualizarPainel();
  return ui;
}
