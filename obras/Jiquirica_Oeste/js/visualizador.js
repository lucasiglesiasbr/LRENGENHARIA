// Visualizador avulso (GitHub Pages): abre a obra exportada em ./dados e
// deixa ver e medir — sem servidor. A cena é a mesma da ferramenta (cena.js).

import * as THREE from "three";
import { desempacotar, fmt } from "./api.js?v=88bd0fc404";
import { Cena } from "./cena.js?v=88bd0fc404";
import { iniciarDesenho } from "./desenhar.js?v=88bd0fc404";
import { iniciarMedir } from "./medir.js?v=88bd0fc404";
import { iniciarVistaSite } from "./vista_site.js?v=88bd0fc404";

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

// Site com login e senha (acesso.js): os dados chegam cifrados e são abertos aqui no
// navegador com a chave do usuário. Site aberto ou prévia local: tudo em claro.
const ACESSO = window.SGAcesso || null;
const PASTA_DA_OBRA = (() => {
  const partes = decodeURIComponent(location.pathname).split("/").filter(Boolean);
  const i = partes.lastIndexOf("obras");
  return i >= 0 ? partes[i + 1] || "" : "";
})();
async function bytes(caminho) {
  if (ACESSO) return ACESSO.buscar(PASTA_DA_OBRA, caminho);
  const r = await fetch(caminho);
  if (!r.ok) throw new Error(`${caminho}: ${r.status}`);
  return r.arrayBuffer();
}
async function json(caminho) {
  return JSON.parse(new TextDecoder().decode(await bytes(caminho)));
}
const protegido = ACESSO ? await ACESSO.ehProtegido() : false;
if (protegido) {
  await ACESSO.entrar(PASTA_DA_OBRA);
  ACESSO.registrar("abriu a obra", PASTA_DA_OBRA);
  $("#sair-do-site").style.display = "inline";
  $("#sair-do-site").onclick = (e) => { e.preventDefault(); ACESSO.sair(); };
}

function dica(texto) { $("#dica").textContent = texto || ""; }

/** Aviso que some sozinho (o site não tem a barra de avisos do painel). */
let relogioAviso = 0;
function aviso(texto, tipo = "") {
  let el = $("#aviso-site");
  if (!el) {
    el = document.createElement("div");
    el.id = "aviso-site";
    $("#area-3d").appendChild(el);
  }
  el.textContent = texto || "";
  el.className = (tipo || "") + (texto ? "" : " oculto");
  clearTimeout(relogioAviso);
  relogioAviso = setTimeout(() => el.classList.add("oculto"), tipo === "erro" ? 7000 : 4500);
}

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
    (obra.voo_data ? ` · voo de ${obra.voo_data}` : "") +
    (obra.gerado_em ? ` · exportado em ${obra.gerado_em}` : "");
  $("#credito").textContent = [obra.credito, "Splat Geo"].filter(Boolean).join(" · ");
  document.title = `${obra.nome} — Splat Geo`;
  if (obra.central) $("#voltar-central").style.display = "inline";

  if (obra.macico) {                 // maciço simulado pelas sondagens (só vem quando ele mandou)
    try {
      const m = await json("./dados/macico.json");
      cena.definirMacico(m);
      cena.moverMacico(m.desloc);
      // sem raio X, sólido embaixo da terra (como ele aprovou no site); a transparência da barra é da obra
      cena.ajustarMacico({ ver: $("#ver-macico").checked, raioX: $("#macico-raiox").checked, transparenteSemRaioX: false });
      $("#rotulo-macico").classList.remove("oculto");
      aplicarCamadas();                  // a lista de Camadas ganha a linha do maciço
      $("#rotulo-raiox").classList.remove("oculto");
      // legenda: só as cores das camadas (o aviso de "modelo simulado" ele mandou tirar)
      $("#legenda-macico").innerHTML = `<b>Maciço pelas sondagens</b> (${m.n_furos} furos SPT)` +
        m.unidades.map((u) => `<div><span class="cor" style="background:${u.cor}"></span>${u.nome}</div>`).join("");
      $("#legenda-macico").classList.toggle("oculto", !$("#ver-macico").checked);
    } catch (_) { /* site exportado sem o arquivo: segue sem o maciço */ }
  }
  $("#ver-macico").onchange = (e) => {
    cena.ajustarMacico({ ver: e.target.checked });
    $("#legenda-macico").classList.toggle("oculto", !e.target.checked);
  };
  $("#macico-raiox").onchange = (e) => cena.ajustarMacico({ raioX: e.target.checked });

  if (obra.topografia) {
    const t = await json("./dados/topo.json");
    const terreno = t.terreno;
    cena.definirTerreno({
      vertices: desempacotar(terreno.vertices_b64),
      indices: desempacotar(terreno.indices_b64, Uint32Array),
      uv: t.mosaico ? desempacotar(t.mosaico.uv_b64) : null,
    }, !t.mosaico ? null : !protegido ? "./dados/mosaico.jpg"
      : URL.createObjectURL(new Blob([await bytes("./dados/mosaico.jpg")], { type: "image/jpeg" })));
    if (t.mosaico) {
      const d = t.mosaico.desloc || [0, 0];
      cena.definirDeslocamentoImagem(d[0], d[1], t.mosaico.metros);
    }
    const cats = (t.categorias || []).map((c) => ({ ...c, xyz: desempacotar(c.b64) }));
    cena.definirDesenho(desempacotar(t.linhas_b64), desempacotar(t.pontos_b64),
      cats.length ? cats : null);
    if (cats.length) {
      $("#btn-categorias").classList.remove("oculto");
      montarPainelCategorias($("#painel-categorias"), cats, t.filtro,
        (id, ligada) => cena.mostrarCategoria(id, ligada));
    }
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
    if (t.grampos && (t.grampos.tipos?.length || t.grampos.tirantes)) {   // contenção do projeto, no talude
      const ti = t.grampos.tirantes, ba = t.grampos.barbacas;
      cena.definirGrampos({
        tipos: (t.grampos.tipos || []).map((g) => ({
          comprimento: g.comprimento, n: g.n, indices: g.indices,
          cabecas: desempacotar(g.cabecas_b64), pontas: desempacotar(g.pontas_b64) })),
        tirantes: ti && { n: ti.n, cabecas: desempacotar(ti.cabecas_b64),
          livre: desempacotar(ti.livre_b64), pontas: desempacotar(ti.pontas_b64) },
        barbacas: ba && { n: ba.n, posicoes: desempacotar(ba.posicoes_b64) },
      });
      const andamento = t.grampos.andamento;
      if (andamento) {                      // o que já foi executado aparece em verde
        const e = andamento.executados;
        cena.marcarExecutados({ grampo: new Set(e.grampo || []), tirante: new Set(e.tirante || []),
          barbaca: new Set(e.barbaca || []) });
      }
      if (ba) {
        $("#rotulo-barbacas").classList.remove("oculto");
        cena.mostrarBarbacas($("#ver-barbacas").checked);
      }
      if (ti) {
        $("#rotulo-tirantes").classList.remove("oculto");
        $("#n-tirantes").textContent = Number(ti.n).toLocaleString("pt-BR");
        $("#n-tirantes").classList.remove("oculto");
      }
      S.andamento = andamento || null;
      $("#rotulo-grampos").classList.remove("oculto");
      $("#rotulo-grampos-corpo").classList.remove("oculto");
      $("#n-grampos").textContent = Number(t.grampos.resumo.total).toLocaleString("pt-BR");
      $("#n-grampos").classList.remove("oculto");
      $("#painel-grampos").innerHTML = montarContagemDeGrampos(t.grampos.resumo) + montarAndamento(S.andamento);
    }
    cena.enquadrar();
  } else {
    $("#rotulo-secoes").classList.add("oculto");
  }

  if (obra.splat) {
    $("#carregando").textContent = `carregando o splat (${obra.splat.mb} MB, ` +
      `${(obra.splat.splats / 1e6).toFixed(1)} milhões de pontos)…`;
    const arquivos = obra.splat.arquivos || [obra.splat.arquivo];
    const fontes = [];
    for (const a of arquivos) {
      fontes.push(!protegido ? "./dados/" + a
        : { bytes: new Uint8Array(await bytes("./dados/" + a)), tipo: a.split(".").pop().toLowerCase() });
    }
    await cena.carregarSplats(fontes);
    fontes.length = 0;                  // os bytes do arquivo (cifrado ou aberto) não ficam guardados aqui
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
  // desenhar por cima da obra (fica guardado no navegador de quem desenha)
  S.aoDesenhar = () => medir?.terminar();
  iniciarDesenho({ cena, S, $, dica });
  return obra;
}

// ------------------------------------------------------------ visibilidade

$("#ver-splat").onchange = (e) => cena.todosSplats().forEach((m) => { m.visible = e.target.checked; });
$("#opacidade-splat").oninput = (e) => cena.todosSplats().forEach((m) => { m.opacity = Number(e.target.value) / 100; });
$("#ver-terreno").onchange = (e) => { if (cena.terreno) cena.terreno.visible = e.target.checked; };
$("#opacidade-terreno").oninput = (e) => cena.definirOpacidadeTerreno(Number(e.target.value) / 100);
$("#ver-linhas").onchange = (e) => { if (cena.linhas) cena.linhas.visible = e.target.checked; };
$("#btn-categorias").onclick = () => {
  $("#painel-camadas").classList.add("oculto");
  $("#painel-categorias").classList.toggle("oculto");
};

/** Painel das categorias de linhas: uma caixinha por categoria, com a cor que
 *  ela tem na tela e quantas linhas tem. `aoMudar(id, ligada)` avisa quem chama. */
function montarPainelCategorias(painel, cats, filtro, aoMudar) {
  const int = (v) => Number(v).toLocaleString("pt-BR");
  const hex = (c) => "#" + Number(c).toString(16).padStart(6, "0");
  painel.innerHTML =
    `<div class="titulo-cat"><b>linhas do desenho</b> por categoria
       <span class="acoes"><a data-todas="1">todas</a> · <a data-todas="0">nenhuma</a></span></div>` +
    cats.map((c) =>
      `<label class="cat" title="camadas do DWG: ${(c.camadas || []).join(", ")}">` +
      `<input type="checkbox" data-cat="${c.id}" ${c.ligada ? "checked" : ""}>` +
      `<span class="bolinha" style="background:${hex(c.cor)}"></span>` +
      `<span class="nome">${c.nome}</span><span class="n">${int(c.n)}</span></label>`).join("") +
    (filtro && filtro.antes > filtro.depois
      ? `<div class="nota-cat">filtro: de ${int(filtro.antes)} para ${int(filtro.depois)} linhas — saíram ` +
        `${int(filtro.repetidas)} repetidas e ${int(filtro.sobrepostas)} desenhadas em cima de outra</div>` : "");
  painel.querySelectorAll("[data-cat]").forEach((cx) => {
    cx.onchange = () => aoMudar(cx.dataset.cat, cx.checked);
  });
  painel.querySelectorAll("[data-todas]").forEach((a) => {
    a.onclick = () => painel.querySelectorAll("[data-cat]").forEach((cx) => {
      const quer = a.dataset.todas === "1";
      if (cx.checked !== quer) { cx.checked = quer; aoMudar(cx.dataset.cat, quer); }
    });
  });
}
$("#ver-pontos").onchange = (e) => { if (cena.pontos) cena.pontos.visible = e.target.checked; };
$("#ver-secoes").onchange = (e) => { if (cena.grupoSecoes) cena.grupoSecoes.visible = e.target.checked; };
$("#ver-grampos").onchange = (e) => cena.mostrarTipoDeContencao("grampo", e.target.checked);
$("#ver-tirantes").onchange = (e) => cena.mostrarTipoDeContencao("tirante", e.target.checked);
$("#n-tirantes").onclick = () => $("#painel-grampos").classList.toggle("oculto");
$("#ver-grampos-corpo").onchange = (e) => cena.mostrarCorpoDosGrampos(e.target.checked);
$("#ver-barbacas").onchange = (e) => cena.mostrarBarbacas(e.target.checked);

/** Andamento da obra: previsto x executado x saldo (em verde no 3D). */
function montarAndamento(a) {
  if (!a?.medicao?.linhas?.length) return "";
  const int = (v) => Number(v).toLocaleString("pt-BR");
  const m1 = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return `<div class="titulo-contagem" style="margin-top:8px"><span class="bolinha" style="background:#3de66e"></span>` +
    `<b>andamento</b> (em verde no 3D)</div><table><tr><th>item</th><th>previsto</th><th>executado</th><th>saldo</th><th>%</th></tr>` +
    a.medicao.linhas.map((l) => `<tr><td>${l.item}</td><td>${int(l.previsto_n)}</td><td><b>${int(l.executado_n)}</b></td>` +
      `<td>${int(l.saldo_n)}</td><td>${l.pct == null ? "" : m1(l.pct)}</td></tr>`).join("") + `</table>`;
}
$("#n-grampos").onclick = () => $("#painel-grampos").classList.toggle("oculto");

/** Quadro da contagem de grampos: por comprimento (com os metros de barra,
 *  que é o que vai para o quantitativo) e por trecho de estaca. */
function montarContagemDeGrampos(g) {
  const CORES = ["#4f8dff", "#ff5c5c", "#51c06a", "#ffb454", "#c77dff"];
  const comps = Object.keys(g.metros_por_comprimento || g.por_comprimento)
    .sort((a, b) => Number(b) - Number(a));
  const int = (v) => Number(v).toLocaleString("pt-BR");
  const m1 = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  // site exportado antes de existir a conta dos metros: sai do comprimento x quantidade
  const metrosDe = (c) => (g.metros_por_comprimento || {})[c] ?? Number(c) * (g.por_comprimento[c] || 0);
  const metrosTotal = g.metros_total ?? comps.reduce((a, c) => a + metrosDe(c), 0);
  let h = `<div class="titulo-contagem"><b>${int(g.total)} grampos de projeto</b>` +
    ` · ${m1(metrosTotal)} m de barra</div><table><tr><th>comprimento</th><th>grampos</th><th>metros</th></tr>`;
  comps.forEach((c, i) => {
    h += `<tr><td><span class="bolinha" style="background:${CORES[i % CORES.length]}"></span>${c} m</td>` +
      `<td>${int(g.por_comprimento[c] || 0)}</td><td>${m1(metrosDe(c))}</td></tr>`;
  });
  h += `<tr class="soma"><td>total</td><td>${int(g.total)}</td><td>${m1(metrosTotal)}</td></tr></table>`;
  if (g.tirantes?.total) {
    const t = g.tirantes;
    h += `<div class="titulo-contagem" style="margin-top:8px"><b>${int(t.total)} tirantes</b> · ${m1(t.metros_total)} m` +
      (t.livre_m ? ` (${m1(t.metros_livre)} m de trecho livre + ${m1(t.metros_ancorado)} m ancorados)` : "") + `</div>` +
      (t.quadro_do_projeto ? `<div class="nota-contagem">quadro de tirantes do projeto: ${int(t.quadro_do_projeto.quantidade)} un, ` +
        `${m1(t.quadro_do_projeto.metros)} m — ` + (t.quadro_do_projeto.quantidade === t.total &&
        Math.abs(t.quadro_do_projeto.metros - t.metros_total) < 0.5 ? "confere com a vista"
        : `<b style="color:#ffb454">DIFERE da vista: conferir</b>`) + `</div>` : "") +
      `<table><tr><th>comprimento</th><th>tirantes</th></tr>` +
      Object.entries(t.por_comprimento).map(([c, n]) =>
        `<tr><td><span class="bolinha" style="background:#ff50dc"></span>${c} m</td><td>${int(n)}</td></tr>`).join("") + `</table>`;
  }
  if (g.barbacas) {
    h += `<div class="titulo-contagem" style="margin-top:8px"><span class="bolinha" style="background:#5adcff"></span>` +
      `<b>${int(g.barbacas)} barbacãs</b></div>`;
  }
  if (g.por_trecho?.length) {
    h += `<div class="titulo-contagem" style="margin-top:8px">por trecho (entre as estacas da vista do projeto)</div>` +
      `<div class="rolagem"><table><tr><th>trecho</th>` + comps.map((c) => `<th>${c} m</th>`).join("") +
      `<th>total</th><th>metros</th></tr>`;
    for (const t of g.por_trecho) {
      h += `<tr><td>${t.trecho}</td>` + comps.map((c) => `<td>${int(t.por_comprimento[c] || 0)}</td>`).join("") +
        `<td><b>${int(t.total)}</b></td><td>${m1(t.metros)}</td></tr>`;
    }
    h += `</table></div>`;
  }
  return h + `<div class="nota-contagem">inclinação ${m1(g.inclinacao_graus)}° · malha ${String(g.malha_m).replace(".", ",")} m · ` +
    `cotas ${m1(g.cota_min)} a ${m1(g.cota_max)} m</div>`;
}
$("#desenho-por-cima").onchange = (e) => cena.definirDesenhoPorCima(e.target.checked);
$("#btn-topo").onclick = () => cena.vistaDeCima();

// --- camadas: quem fica por cima de quem. No site a ordem padrão põe o
// splat por cima do terreno (o terreno é referência; nunca deve esconder o
// splat) e o desenho por cima de tudo. "3D real" liga a profundidade.
const NOMES_CAMADAS = { desenho: "curvas e pontos", secoes: "seções",
  splat: "splat", terreno: "terreno", macico: "maciço (sondagens)" };
let ordemCamadas = ["desenho", "secoes", "splat", "terreno", "macico"];   // de cima para baixo
function ordemValida(ordem) {        // ordem antiga (sem o maciço) ganha o maciço por baixo
  if (!Array.isArray(ordem) || !ordem.every((c) => NOMES_CAMADAS[c])) return null;
  const limpa = ordem.filter((c, i) => ordem.indexOf(c) === i);
  if (limpa.length < 4) return null;
  return [...limpa, ...Object.keys(NOMES_CAMADAS).filter((c) => !limpa.includes(c))];
}
let camadas3dReal = false;
try {
  const g = JSON.parse(localStorage.getItem("splatgeo_site_camadas") || "null");
  if (g && ordemValida(g.ordem)) {
    ordemCamadas = ordemValida(g.ordem);
    camadas3dReal = !!g.real;
  }
} catch (_) { /* sem memória do navegador */ }

function aplicarCamadas() {
  cena.definirOrdemCamadas(camadas3dReal ? null : [...ordemCamadas].reverse());
  $("#camadas-real").checked = camadas3dReal;
  $("#btn-camadas").classList.toggle("ativo", !camadas3dReal);
  const lista = $("#lista-camadas");
  // a linha do maciço só aparece em obra publicada com maciço
  const visiveis = ordemCamadas.filter((c) => c !== "macico" || cena.grupoMacico);
  lista.innerHTML = ordemCamadas.map((c, i) => {
    const k = visiveis.indexOf(c);
    if (k < 0) return "";
    return '<div class="camada' + (camadas3dReal ? " apagada" : "") + '">' +
    '<button class="secundario" data-sobe="' + i + '" title="sobe uma posição"' +
      (k === 0 ? " disabled" : "") + '>↑</button>' +
    '<button class="secundario" data-desce="' + i + '" title="desce uma posição"' +
      (k === visiveis.length - 1 ? " disabled" : "") + '>↓</button>' +
    '<span>' + (k === 0 ? "por cima: " : k === visiveis.length - 1 ? "por baixo: " : "") +
      NOMES_CAMADAS[c] + '</span></div>';
  }).join("");
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

// A ferramenta de medir é a MESMA da página (medir.js): lista de medidas com nome,
// modo (livre, horizontal, prumo, na face), o clique que para na superfície do
// modelo, arrastar, setas, Ctrl+Z, CSV e o medir na ortofoto. O que muda no site
// vem no ctx: as medidas de quem visita ficam SÓ no navegador dele (localStorage,
// uma chave por obra), o desfazer é a pilha do próprio medir.js, e as medidas que a
// LR marcou "no site" chegam por dados/medidas.json, só leitura (🔒).
let medir = null;
const CHAVE_MEDIDAS = "splatgeo-medidas:" + location.pathname.replace(/index\.html$/, "");

function medidasGuardadas() {
  try {
    const g = JSON.parse(localStorage.getItem(CHAVE_MEDIDAS) || "null");
    return g && Array.isArray(g.medidas) ? g.medidas : [];
  } catch (_) { return []; }          // sem memória do navegador: começa vazio
}
let avisouMemoria = false;
function guardarMedidas(lista) {
  try {
    localStorage.setItem(CHAVE_MEDIDAS, JSON.stringify({ versao: 1, medidas: lista }));
  } catch (_) {
    if (!avisouMemoria) aviso("não consegui guardar as medidas neste navegador: use Baixar medidas para não perder", "erro");
    avisouMemoria = true;
  }
}

// Leaflet só quando alguém abre a ortofoto (é o mapa das telas); leva o carimbo
// do programa (window.SG_CARIMBO, posto pelo site.py) para não vir velho do cache
let leaflet = null;
function carregarLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leaflet) {
    const v = window.SG_CARIMBO ? "?v=" + window.SG_CARIMBO : "";
    leaflet = new Promise((ok, falhou) => {
      if (!document.getElementById("leaflet-css")) {
        const css = document.createElement("link");
        css.id = "leaflet-css";
        css.rel = "stylesheet";
        css.href = "./vendor/leaflet/leaflet.css" + v;
        document.head.appendChild(css);
      }
      const s = document.createElement("script");
      s.src = "./vendor/leaflet/leaflet.js" + v;
      s.onload = () => ok();
      s.onerror = () => { leaflet = null; s.remove(); falhou(new Error("não consegui carregar o mapa da ortofoto")); };
      document.head.appendChild(s);
    });
  }
  return leaflet;
}

/** Ortofoto crua do voo no site (só com a caixinha na exportação): telas em
 *  dados/orto/{z}/{x}/{y}.jpg, lidas por bytes() e entregues como Blob URL (o
 *  medir_orto.js devolve cada uma quando a tela sai); só se pede o que está no
 *  telas.json (as telas vazias não foram). M_voo leva o voo à cena do site. */
function ortofotoDoSite(obra) {
  const O = obra.ortofoto;
  if (!O || !O.M_voo || !(O.largura > 0)) return null;
  let telas = null;
  const listaDeTelas = () => (telas ??= json("./dados/orto/telas.json").then((t) => {
    const s = new Set();
    for (const [z, xy] of Object.entries(t?.z || {})) for (const [x, y] of xy) s.add(`${z}/${x}/${y}`);
    return s;
  }).catch((erro) => { console.warn("ortofoto: telas.json", erro); return new Set(); }));
  return {
    info: async () => ({ ...O, pode_marcar: true }),
    tela: async (I, z, x, y) => {
      if (!(await listaDeTelas()).has(`${z}/${x}/${y}`)) return null;     // tela vazia: cinza
      const b = await bytes(`./dados/orto/${z}/${x}/${y}.jpg`);
      return URL.createObjectURL(new Blob([b], { type: "image/jpeg" }));
    },
    // X_site = escala·R·x_voo + (translação − origem), a MESMA T do splat exportado
    matrizVoo: () => {
      const m = O.M_voo, R = m.rotacao, t = m.translacao, s = Number(m.escala) || 1;
      if (!Array.isArray(R) || R.length !== 3 || !Array.isArray(t) || t.length < 3) return null;
      return new THREE.Matrix4().set(
        s * R[0][0], s * R[0][1], s * R[0][2], t[0],
        s * R[1][0], s * R[1][1], s * R[1][2], t[1],
        s * R[2][0], s * R[2][1], s * R[2][2], t[2],
        0, 0, 0, 1);
    },
    alturaDTM: null,                     // o chão calculado do voo só existe no painel
    carregarLeaflet,
  };
}

/** Medir e Vista da contenção: depois que a obra abriu (o eixo, a ortofoto e as
 *  medidas publicadas vêm no obra.json). */
async function iniciarFerramentas(obra) {
  try {
    medir = iniciarMedir({
      onde: "site", cena, $, S,
      origem: () => S.origem,
      aviso, dica,
      gravar: guardarMedidas,
      registrar: null, ultimoDesfazer: null, redesenhar: null,
      aoComecar: () => S.sairDoDesenho?.(),          // medir e desenhar não andam juntos
      descricaoDoPonto: (p) => descricaoDoPonto(p),
      eixo: () => obra.contencao_eixo || null,
      encaixe: () => ({ fonte: "site:" + (obra.gerado_em || ""), data: obra.gerado_em || null }),
      recalcularSplat: null,
      lupa: true,
      splatReduzido: !!obra.splat_reduzido,
      ortofoto: ortofotoDoSite(obra),
      nomeObra: () => obra.nome || "obra",
    });
    let publicadas = [];
    if (obra.medidas) {
      try { publicadas = (await json("./dados/medidas.json")).medidas || []; } catch (erro) {
        console.warn("medidas publicadas", erro);
      }
    }
    medir.abrir(medidasGuardadas(), { publicadas });
  } catch (erro) {
    console.error(erro);
    aviso("a ferramenta de medir não abriu: " + (erro?.message || erro), "erro");
  }
  try {
    iniciarVistaSite({
      obra, $, bytes, aviso, dica,
      medir: () => medir,
      aoAbrir: () => { medir?.terminar(); S.sairDoDesenho?.(); },
      nomeObra: () => obra.nome || "obra",
    });
  } catch (erro) {
    console.error(erro);
  }
}

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
abrir().then((obra) => iniciarFerramentas(obra)).catch((erro) => {
  $("#carregando").textContent = "não consegui abrir a obra: " + erro.message;
  console.error(erro);
});
