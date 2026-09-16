// Visualizador avulso (GitHub Pages): abre a obra exportada em ./dados e
// deixa ver e medir — sem servidor. A cena é a mesma da ferramenta (cena.js).

import * as THREE from "three";
import { desempacotar, fmt } from "./api.js";
import { Cena } from "./cena.js";

const $ = (s) => document.querySelector(s);
const cena = new Cena($("#tela"));
const S = { origem: [0, 0, 0], rotulos: [], medindo: null };

// máquina fraca (sem placa de vídeo): a resolução cai sozinha se o quadro
// cair abaixo de ~22 por segundo; o seletor deixa forçar
cena.definirQualidade("auto");
cena.aoMudarQualidade = (nivel, fps) => {
  $("#qualidade").value = nivel;
  dica(`resolução reduzida para "${nivel}" — o computador estava a ${fps.toFixed(0)} quadros/s`);
};
$("#qualidade").onchange = (e) => cena.definirQualidade(e.target.value);

async function json(caminho) {
  const r = await fetch(caminho);
  if (!r.ok) throw new Error(`${caminho}: ${r.status}`);
  return r.json();
}

function dica(texto) { $("#dica").textContent = texto || ""; }

function pontoDaCenaParaTerreno(p) {
  return [p.x + S.origem[0], p.y + S.origem[1], p.z + S.origem[2]];
}

function descricaoDoPonto(pontoCena, raio = 3.0) {
  if (!S.rotulos.length) return "";
  const perto = S.rotulos
    .map((t) => ({ t, d: Math.hypot(t.x - pontoCena.x, t.y - pontoCena.y) }))
    .filter((o) => o.d <= raio)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((o) => o.t.texto);
  return [...new Set(perto)].join(" ");
}

// ------------------------------------------------------------------ carga

async function abrir() {
  const obra = await json("./dados/obra.json");
  S.origem = obra.origem;
  $("#titulo").textContent = obra.nome;
  $("#subtitulo").textContent = `${obra.nome_epsg || "EPSG:" + obra.epsg}` +
    (obra.gerado_em ? ` · exportado em ${obra.gerado_em}` : "");
  $("#credito").textContent = [obra.credito, "Splat Geo"].filter(Boolean).join(" · ");
  document.title = `${obra.nome} — Splat Geo`;
  if (obra.central) $("#voltar-central").style.display = "inline";

  if (obra.topografia) {
    const t = await json("./dados/topo.json");
    const terreno = t.terreno;
    cena.definirTerreno({
      vertices: desempacotar(terreno.vertices_b64),
      indices: desempacotar(terreno.indices_b64, Uint32Array),
      uv: t.mosaico ? desempacotar(t.mosaico.uv_b64) : null,
    }, t.mosaico ? "./dados/mosaico.jpg" : null);
    if (t.mosaico) {
      const d = t.mosaico.desloc || [0, 0];
      cena.definirDeslocamentoImagem(d[0], d[1], t.mosaico.metros);
    }
    cena.definirDesenho(desempacotar(t.linhas_b64), desempacotar(t.pontos_b64));
    S.rotulos = (t.rotulos || []).map((r) => ({
      texto: r.texto, x: r.E - S.origem[0], y: r.N - S.origem[1], z: r.Z - S.origem[2],
    }));
    if (t.secoes?.secoes?.length) {
      const linhas = {};
      for (const [g, d] of Object.entries(t.secoes.linhas)) {
        linhas[g] = { xyz: desempacotar(d.b64), n: d.n };
      }
      cena.definirSecoes({
        linhas,
        rotulos: t.secoes.rotulos.map((r) => ({ texto: r.texto,
          x: r.E - S.origem[0], y: r.N - S.origem[1], z: r.Z - S.origem[2] })),
      });
    } else {
      $("#rotulo-secoes").classList.add("oculto");
    }
    cena.enquadrar();
  } else {
    $("#rotulo-secoes").classList.add("oculto");
  }

  if (obra.splat) {
    $("#carregando").textContent = `carregando o splat (${obra.splat.mb} MB, ` +
      `${(obra.splat.splats / 1e6).toFixed(1)} milhões de pontos)…`;
    const arquivos = obra.splat.arquivos || [obra.splat.arquivo];
    await cena.carregarSplats(arquivos.map((a) => "./dados/" + a));
    cena.splat.position.set(...(obra.splat.posicao || [0, 0, 0]));
    if (obra.splat.quaternion) {          // w, x, y, z
      const q = obra.splat.quaternion;
      cena.splat.quaternion.set(q[1], q[2], q[3], q[0]);
    }
    cena.splat.scale.setScalar(obra.splat.escala || 1);
    cena.splat.updateMatrixWorld(true);
    if (!obra.topografia) cena.enquadrar();
  }
  $("#carregando").textContent = "";
  if (obra.aviso) dica(obra.aviso);
}

// ------------------------------------------------------------ visibilidade

$("#ver-splat").onchange = (e) => cena.todosSplats().forEach((m) => { m.visible = e.target.checked; });
$("#opacidade-splat").oninput = (e) => cena.todosSplats().forEach((m) => { m.opacity = Number(e.target.value) / 100; });
$("#ver-terreno").onchange = (e) => { if (cena.terreno) cena.terreno.visible = e.target.checked; };
$("#opacidade-terreno").oninput = (e) => cena.definirOpacidadeTerreno(Number(e.target.value) / 100);
$("#ver-linhas").onchange = (e) => { if (cena.linhas) cena.linhas.visible = e.target.checked; };
$("#ver-pontos").onchange = (e) => { if (cena.pontos) cena.pontos.visible = e.target.checked; };
$("#ver-secoes").onchange = (e) => { if (cena.grupoSecoes) cena.grupoSecoes.visible = e.target.checked; };
$("#desenho-por-cima").onchange = (e) => cena.definirDesenhoPorCima(e.target.checked);
$("#btn-topo").onclick = () => cena.vistaDeCima();

// --- camadas: quem fica por cima de quem. No site a ordem padrão põe o
// splat por cima do terreno (o terreno é referência; nunca deve esconder o
// splat) e o desenho por cima de tudo. "3D real" liga a profundidade.
const NOMES_CAMADAS = { desenho: "curvas e pontos", secoes: "seções",
  splat: "splat", terreno: "terreno" };
let ordemCamadas = ["desenho", "secoes", "splat", "terreno"];   // de cima para baixo
let camadas3dReal = false;
try {
  const g = JSON.parse(localStorage.getItem("splatgeo_site_camadas") || "null");
  if (g && Array.isArray(g.ordem) && g.ordem.length === 4 &&
      g.ordem.every((c) => NOMES_CAMADAS[c])) {
    ordemCamadas = g.ordem;
    camadas3dReal = !!g.real;
  }
} catch (_) { /* sem memória do navegador */ }

function aplicarCamadas() {
  cena.definirOrdemCamadas(camadas3dReal ? null : [...ordemCamadas].reverse());
  $("#camadas-real").checked = camadas3dReal;
  $("#btn-camadas").classList.toggle("ativo", !camadas3dReal);
  const lista = $("#lista-camadas");
  lista.innerHTML = ordemCamadas.map((c, i) =>
    '<div class="camada' + (camadas3dReal ? " apagada" : "") + '">' +
    '<button class="secundario" data-sobe="' + i + '" title="sobe uma posição"' +
      (i === 0 ? " disabled" : "") + '>↑</button>' +
    '<button class="secundario" data-desce="' + i + '" title="desce uma posição"' +
      (i === ordemCamadas.length - 1 ? " disabled" : "") + '>↓</button>' +
    '<span>' + (i === 0 ? "por cima: " : i === ordemCamadas.length - 1 ? "por baixo: " : "") +
      NOMES_CAMADAS[c] + '</span></div>').join("");
  lista.querySelectorAll("[data-sobe]").forEach((b) => {
    b.onclick = () => moverCamada(+b.dataset.sobe, -1);
  });
  lista.querySelectorAll("[data-desce]").forEach((b) => {
    b.onclick = () => moverCamada(+b.dataset.desce, 1);
  });
  try {
    localStorage.setItem("splatgeo_site_camadas",
      JSON.stringify({ ordem: ordemCamadas, real: camadas3dReal }));
  } catch (_) { /* sem memória do navegador */ }
}

function moverCamada(i, passo) {
  const j = i + passo;
  if (j < 0 || j >= ordemCamadas.length) return;
  [ordemCamadas[i], ordemCamadas[j]] = [ordemCamadas[j], ordemCamadas[i]];
  camadas3dReal = false;
  aplicarCamadas();
}

$("#camadas-real").onchange = (e) => { camadas3dReal = e.target.checked; aplicarCamadas(); };
$("#btn-camadas").onclick = () => $("#painel-camadas").classList.toggle("oculto");
aplicarCamadas();
$("#btn-enquadrar").onclick = () => cena.enquadrar();
$("#btn-foto").onclick = () => {
  const dados = cena.miniatura(4096);
  if (!dados) return;
  const a = document.createElement("a");
  a.href = dados;
  a.download = `${document.title.replace(/[^\w\- ]+/g, "")}.jpg`;
  a.click();
};

// ------------------------------------------------------------------ medir

function iniciarMedicao(tipo) {
  if (S.medindo?.tipo === tipo) { terminarMedicao(); return; }
  S.medindo = { tipo, pontos: [] };
  $("#btn-medir-dist").classList.toggle("ativo", tipo === "dist");
  $("#btn-medir-area").classList.toggle("ativo", tipo === "area");
  dica(tipo === "dist"
    ? "clique nos pontos para medir (Esc encerra)."
    : "clique no contorno da área; feche onde começou (Esc encerra).");
}

function terminarMedicao() {
  S.medindo = null;
  $("#btn-medir-dist").classList.remove("ativo");
  $("#btn-medir-area").classList.remove("ativo");
  dica("");
}

$("#btn-medir-dist").onclick = () => iniciarMedicao("dist");
$("#btn-medir-area").onclick = () => iniciarMedicao("area");
$("#btn-medir-limpar").onclick = () => {
  cena.limparMarcas(); $("#info-medicao").textContent = ""; terminarMedicao();
};

function atualizarMedicao() {
  const pts = S.medindo.pontos;
  cena.limparMarcas();
  pts.forEach((p, i) => cena.marcar("m" + i, p, "", 0x4da3ff));
  cena.desenharLinhaMedida(pts, S.medindo.tipo === "area" && pts.length > 2);
  if (pts.length < 2) { $("#info-medicao").textContent = "marque outro ponto…"; return; }
  if (S.medindo.tipo === "dist") {
    let total = 0, horiz = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      total += a.distanceTo(b);
      horiz += Math.hypot(b.x - a.x, b.y - a.y);
      cena.rotular(a.clone().lerp(b, 0.5), `${fmt.metro(a.distanceTo(b))} m`, true);
    }
    const a = pts[0], b = pts[pts.length - 1];
    const dz = b.z - a.z;
    const hDireto = Math.hypot(b.x - a.x, b.y - a.y);
    $("#info-medicao").innerHTML =
      `caminho: <b>${fmt.metro(total)} m</b> (horizontal ${fmt.metro(horiz)} m)<br>` +
      `início → fim: ${fmt.metro(a.distanceTo(b))} m · horizontal ${fmt.metro(hDireto)} m · ` +
      `desnível ${fmt.metro(dz)} m<br>` +
      `inclinação ${hDireto > 0.01 ? fmt.num(100 * dz / hDireto, 1) + " %" : "—"}` +
      ` (1:${hDireto > 0.01 && Math.abs(dz) > 0.01 ? fmt.num(hDireto / Math.abs(dz), 2) : "—"})`;
  } else {
    let area = 0, perim = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      area += a.x * b.y - b.x * a.y;
      perim += Math.hypot(b.x - a.x, b.y - a.y);
    }
    area = Math.abs(area) / 2;
    const zs = pts.map((p) => p.z);
    $("#info-medicao").innerHTML =
      `área em planta: <b>${fmt.metro(area)} m²</b><br>` +
      `perímetro ${fmt.metro(perim)} m · ${pts.length} vértices<br>` +
      `cota ${fmt.metro(Math.min(...zs))} a ${fmt.metro(Math.max(...zs))} m`;
  }
}

// clique = apertar e soltar no mesmo lugar (arrastar é girar a câmera)
let inicioClique = null;
$("#tela").addEventListener("pointerdown", (e) => {
  inicioClique = { x: e.clientX, y: e.clientY, t: Date.now() };
});
$("#tela").addEventListener("pointerup", (e) => {
  if (!inicioClique) return;
  const arrastou = Math.hypot(e.clientX - inicioClique.x, e.clientY - inicioClique.y) > 4;
  const demorou = Date.now() - inicioClique.t > 400;
  inicioClique = null;
  if (arrastou || demorou || e.button !== 0 || !S.medindo) return;
  const alvo = cena.apontar(e, {});
  if (!alvo) { dica("clique em cima do splat, do terreno ou do desenho"); return; }
  S.medindo.pontos.push(alvo.ponto);
  atualizarMedicao();
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape") terminarMedicao(); });

// coordenadas na barra de baixo (só terreno e desenho: barato)
let ultimoMovimento = 0;
$("#tela").addEventListener("pointermove", (e) => {
  const agora = performance.now();
  if (agora - ultimoMovimento < 90) return;
  ultimoMovimento = agora;
  const alvo = cena.apontar(e, { splat: false });
  if (!alvo) { $("#coord").textContent = "—"; return; }
  const [E, N, Z] = pontoDaCenaParaTerreno(alvo.ponto);
  const etiqueta = alvo.tipo === "ponto" ? descricaoDoPonto(alvo.ponto, 2.5) : "";
  $("#coord").textContent =
    `E ${fmt.num(E, 2)}   N ${fmt.num(N, 2)}   Z ${fmt.num(Z, 2)}` + (etiqueta ? `   ${etiqueta}` : "");
});

window.SG = { cena, estado: S, THREE };
abrir().catch((erro) => {
  $("#carregando").textContent = "não consegui abrir a obra: " + erro.message;
  console.error(erro);
});
