// Vista da contenção no SITE (obras online): a foto de frente da face (a prancha
// da vista frontal, SEM os elementos desenhados) com as marcas dos grampos,
// tirantes e barbacãs por cima (verde = executado), a posição real que a LR
// marcou (bolinha azul com traço até a marca do projeto), a régua (a MESMA conta
// das Medidas: regua_vista.js) e a tabela do espaçamento dos executados, com o
// CSV no layout do boletim. Só leitura: nada daqui muda a obra; a régua guarda
// na lista LOCAL de quem visita (medir.js adicionar -> localStorage).
//
//   ctx = { obra, $, bytes(caminho) -> ArrayBuffer, aviso(texto, tipo), dica(texto),
//           medir: () => ui do medir.js | null, aoAbrir(), nomeObra() }
//   devolve { abrir(), fechar(), aberto() }
//
// A imagem vem SEMPRE por Blob URL: no site com senha dados/ chega cifrado e só
// bytes() abre (nunca <img src="dados/…">). Os dados vêm de dados/vista_frontal.json
// {grade, largura, altura, marcas, posicoes, espacamento, gerado_em}.

import { lerGrade, pixelParaPonto, pontoParaPixel, tangente } from "./eixo.js?v=88bd0fc404";
import { ligarRegua, nomeEstaca } from "./regua_vista.js?v=88bd0fc404";

const NS = "http://www.w3.org/2000/svg";
const MAX_LINHAS = 50;
const COLUNAS_CSV = "par;tipo;elemento A;elemento B;estaca A;cota A;projeto (m);medido (m);" +
  "diferença no espaçamento (cm);fora de linha (cm);vale ± (cm);contra o 3D (cm);situação";
const CRITERIO = "linha medida ao longo da face; coluna na vertical (cota), como no desenho. " +
  "Cada linha diz quanto a conferência vale.";
const DICA_REGUA = "régua: clique em 2 pontos da foto — a distância sai do 3D, a mesma conta das Medidas · " +
  "perto de uma marca gruda nela · Shift trava na horizontal/vertical · Esc limpa";
const DICA_REGUA_TOQUE = "régua: toque em 2 pontos da foto — a distância sai do 3D, a mesma conta das Medidas · " +
  "perto de uma marca gruda nela";

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const numOk = (v) => typeof v === "number" && isFinite(v);
/** Número com vírgula e `casas` casas (o _num do Python); fora do número: "". */
const num = (v, casas) => (numOk(v) ? v.toFixed(casas).replace(".", ",") : "");
const celula = (t) => { t = String(t ?? ""); return /[;"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
function toque() {
  try { return window.matchMedia("(pointer:coarse)").matches; } catch (_) { return false; }
}

/** CSV do espaçamento no layout do boletim (medir_contencao.espacamento_csv): BOM,
 *  ";", vírgula decimal, "\r\n"; resumo no topo, GRAMPOS e (se houver) TIRANTES. */
export function csvEspacamento(r, nomeObra, emitido) {
  const res = r?.resumo || {};
  const L = [
    "Espaçamento dos executados - " + celula(nomeObra || "obra"),
    "emitido em;" + (emitido || ""),
    "critério;" + celula(r?.aviso || CRITERIO),
    "limite (cm);" + num(res.limite_cm, 1),
    "pares conferidos;" + (res.pares ?? 0),
    "fogem;" + (res.fogem ?? 0),
    "mediana da diferença (cm);" + num(res.mediana_cm, 1),
    "p90 da diferença (cm);" + num(res.p90_cm, 1),
    "executados com posição real;" + (res.com_posicao ?? 0),
    "executados sem posição real;" + (res.sem_posicao ?? 0),
  ];
  for (const [elemento, titulo] of [["grampo", "GRAMPOS"], ["tirante", "TIRANTES"]]) {
    const pares = (r?.pares || []).filter((p) => (p.elemento || "grampo") === elemento);
    if (elemento === "tirante" && !pares.length) continue;
    L.push("", titulo, COLUNAS_CSV);
    pares.forEach((p, k) => {
      L.push([k + 1, p.tipo, p.a, p.b, nomeEstaca(Number(p.estaca_a)), num(p.cota_a, 2), num(p.projeto_m, 2),
        num(p.medido_m, 3), num(p.desvio_cm, 1), num(p.desalinho_cm, 1), num(p.vale_cm, 1),
        num(p.desvio_3d_cm, 1), p.situacao || (p.foge ? "FOGE" : p.falta_elemento ? "falta elemento" : "ok")]
        .map(celula).join(";"));
    });
  }
  return "﻿" + L.join("\r\n") + "\r\n";
}

/** Frase do resumo do espaçamento (a mesma da página, 8.6), para quem só olha. */
export function resumoEspacamento(r) {
  if (!r) return "esta exportação não trouxe a tabela do espaçamento";
  const s = r.resumo || {};
  if (!s.pares) {
    return "nenhum par com as duas posições reais ainda (a LR marca a posição real dos executados na vista frontal)" +
      (s.sem_posicao ? ` · ${s.sem_posicao} executado(s) ainda sem posição real` : "");
  }
  return `${s.pares} pares conferidos · ${s.fogem} fogem · mediana ${num(s.mediana_cm, 1)} cm` +
    (s.sem_posicao ? ` · ${s.sem_posicao} executado(s) ainda sem posição real` : "");
}

function baixar(texto, nome, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const nomeDeArquivo = (t) => String(t || "obra").normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "obra";

export function iniciarVistaSite(ctx) {
  const $ = ctx.$ || ((s) => document.querySelector(s));
  const obra = ctx.obra || {};
  const botao = $("#btn-vista-cont");
  const nada = { abrir() {}, fechar() {}, aberto: () => false };
  if (!botao || !obra.vista_frontal) return nada;
  botao.classList.remove("oculto");

  const aviso = (t, tipo = "") => { try { ctx.aviso?.(t, tipo); } catch (_) { /* nada */ } };
  const nomeObra = () => { try { return ctx.nomeObra?.() || obra.nome || "obra"; } catch (_) { return "obra"; } };
  let pacote = null, foto = null;        // vista_frontal.json e o Blob da prancha (lidos uma vez)
  let visor = null, abrindo = false;

  async function carregar() {
    if (!pacote) {
      const b = await ctx.bytes("./dados/vista_frontal.json");
      pacote = JSON.parse(new TextDecoder().decode(b));
    }
    if (!foto) foto = new Blob([await ctx.bytes("./dados/vista_frontal.jpg")], { type: "image/jpeg" });
  }

  async function abrir() {
    if (visor || abrindo) return;
    abrindo = true;
    botao.classList.add("ativo");
    try { ctx.aoAbrir?.(); } catch (_) { /* nada */ }
    const antes = botao.textContent;
    botao.textContent = "abrindo a vista…";
    try {
      await carregar();
      montar();
    } catch (erro) {
      console.warn("vista da contenção", erro);
      aviso("não consegui abrir a vista da contenção: " + (erro?.message || erro), "erro");
      botao.classList.remove("ativo");
    } finally {
      botao.textContent = antes;
      abrindo = false;
    }
  }

  function montar() {
    const W = Number(pacote.largura) || 1, H = Number(pacote.altura) || 1;
    let grade = null;
    try { grade = pacote.grade ? lerGrade(pacote.grade) : null; } catch (erro) { console.warn("vista: grade", erro); grade = null; }
    if (grade && !grade.eixoPrep) grade = null;
    const esp = pacote.espacamento || null;
    const largo = (() => { try { return window.matchMedia("(min-width: 701px)").matches; } catch (_) { return true; } })();
    const url = URL.createObjectURL(foto);
    const caixa = document.createElement("div");
    caixa.id = "visor-site";
    caixa.innerHTML =
      `<div class="barra"><b>Vista frontal da contenção</b>` +
      `<span class="fraco">${pacote.gerado_em ? "gerada em " + esc(pacote.gerado_em) + " · " : ""}só leitura</span>` +
      `<span class="empurra"></span>` +
      (grade ? `<button data-regua class="secundario ativo" title="Mede na foto: dois cliques dão a distância ao longo da face, a altura e na face (a mesma conta das Medidas)">régua</button>` : "") +
      `<button data-espac class="secundario${esp && largo ? " ativo" : ""}" title="Distância entre vizinhos executados comparada com o desenho do projeto">espaçamento</button>` +
      `<button data-z="-1" class="secundario" title="afastar">−</button>` +
      `<button data-z="0" class="secundario" title="encher a altura da janela">ajustar</button>` +
      `<button data-z="1" class="secundario" title="aproximar">+</button>` +
      `<button data-fechar class="secundario" title="Fechar (Esc)">Fechar ✕</button></div>` +
      `<div class="dica-visor"><span data-dica>${grade ? esc(toque() ? DICA_REGUA_TOQUE : DICA_REGUA)
        : "esta vista não tem a grade da régua: a LR precisa exportar o site de novo"}</span>` +
      ` · <span style="color:#3de66e">●</span> executado · <span style="color:#4fd1ff">●</span> posição real marcada pela LR</div>` +
      `<div class="corpo"><div class="rolagem"><div class="palco"><img draggable="false" alt="vista frontal da contenção">` +
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"></svg></div></div>` +
      `<div class="espac${esp && largo ? "" : " oculto"}"></div></div>`;
    ($("#area-3d") || document.body).appendChild(caixa);
    caixa.querySelector("img").src = url;
    const palco = caixa.querySelector(".palco"), svg = caixa.querySelector("svg"), rol = caixa.querySelector(".rolagem");
    const painel = caixa.querySelector(".espac");

    // ---- zoom (como o visor da página): px de tela por px da prancha
    let zoom = 1;
    const aplicarZoom = (z) => {
      zoom = Math.min(4, Math.max(0.05, z));
      palco.style.width = W * zoom + "px";
      palco.style.height = H * zoom + "px";
    };
    // face comprida e baixa: encher a ALTURA (rola para os lados) em vez de espremer na largura
    const ajustar = () => aplicarZoom(Math.max(rol.clientWidth / W, Math.min((rol.clientHeight - 18) / H, 1.5)));
    ajustar();
    caixa.querySelectorAll("[data-z]").forEach((b) => {
      b.onclick = () => (b.dataset.z === "0" ? ajustar() : aplicarZoom(zoom * (b.dataset.z === "1" ? 1.4 : 1 / 1.4)));
    });

    // ---- marcas do projeto (a prancha do site vem sem elementos: são estas)
    const marcas = (pacote.marcas || []).filter((m) => m && m.tipo !== "avulso" && numOk(m.x) && numOk(m.y));
    const porId = new Map(marcas.map((m) => [m.id, m]));
    const bolaDoId = new Map();
    for (const m of marcas) {
      const tir = m.tipo === "tirante";
      const r = m.tipo === "barbaca" ? 3 : tir ? 6 : 5;
      const c = document.createElementNS(NS, tir ? "rect" : "circle");
      if (tir) {
        c.setAttribute("x", m.x - r); c.setAttribute("y", m.y - r);
        c.setAttribute("width", 2 * r); c.setAttribute("height", 2 * r);
      } else {
        c.setAttribute("cx", m.x); c.setAttribute("cy", m.y); c.setAttribute("r", r);
      }
      c.setAttribute("class", "marca " + m.tipo + (m.executado ? " feito" : ""));
      const t = document.createElementNS(NS, "title");
      t.textContent = m.id + (m.comprimento ? ` · ${String(m.comprimento).replace(".", ",")} m` : "") +
        (m.executado ? " · executado" : "");
      c.appendChild(t);
      svg.appendChild(c);
      bolaDoId.set(m.id, c);
    }

    // ---- posição real (C.posicoes do painel): bolinha azul e traço até a marca
    const gPos = document.createElementNS(NS, "g");
    gPos.setAttribute("class", "pos-real");
    svg.appendChild(gPos);
    if (grade) {
      for (const [id, p] of Object.entries(pacote.posicoes || {})) {
        const m = porId.get(id);
        if (!m || !p || ![p.E, p.N, p.Z].every(numOk)) continue;
        const q = pontoParaPixel(grade, null, p.E, p.N, p.Z);
        if (!q || !numOk(q.x) || !numOk(q.y)) continue;
        // desvio aparente NA IMAGEM (ao longo da face e na vertical), como na página
        const proj = pixelParaPonto(grade, null, m.x, m.y);
        let cm = null;
        if (proj && !proj.fora) {
          const [tx, ty] = tangente(grade.eixoPrep, proj.s);
          cm = Math.round(Math.hypot((p.E - proj.E) * tx + (p.N - proj.N) * ty, p.Z - proj.Z) * 100);
        }
        const ln = document.createElementNS(NS, "line");
        ln.setAttribute("x1", m.x); ln.setAttribute("y1", m.y); ln.setAttribute("x2", q.x); ln.setAttribute("y2", q.y);
        ln.setAttribute("class", "traco");
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", q.x); c.setAttribute("cy", q.y); c.setAttribute("r", m.tipo === "tirante" ? 5 : 4);
        c.dataset.pos = id;
        const t = document.createElementNS(NS, "title");
        t.textContent = `${id}: posição real · ${cm === null ? "?" : cm} cm da marca do projeto na imagem ` +
          "(inclui o erro do encaixe, 11 a 36 cm: não é o erro de locação)";
        c.appendChild(t);
        gPos.append(ln, c);
      }
    }

    // ---- régua (8.3): guarda nas Medidas LOCAIS de quem visita
    let regua = null;
    if (grade) {
      const ui = (() => { try { return ctx.medir?.() || null; } catch (_) { return null; } })();
      regua = ligarRegua({
        svg, largura: W, altura: H, grade, marcas: marcas.map((m) => ({ x: m.x, y: m.y, id: m.id })), zoom: () => zoom,
        aoGuardar: ui ? (m) => {
          const id = ui.adicionar(m);
          if (id) aviso(`“${m.nome}” guardada nas suas Medidas (só neste navegador)`, "ok");
        } : null,
      });
      regua.ligar();
      const bR = caixa.querySelector("[data-regua]");
      bR.onclick = () => {
        if (regua.ligada()) regua.desligar(); else regua.ligar();
        bR.classList.toggle("ativo", regua.ligada());
        caixa.querySelector("[data-dica]").style.opacity = regua.ligada() ? "" : ".45";
      };
    }

    // ---- espaçamento (8.5/8.6): resumo, tabela (até 50) e o CSV
    function mostrarPar(a, b) {
      const ms = [a, b].map((id) => porId.get(id)).filter(Boolean);
      if (!ms.length) { aviso("esse par não aparece nesta vista frontal"); return; }
      if (zoom < 0.6) aplicarZoom(1);
      const cx = ms.reduce((s, m) => s + m.x, 0) / ms.length, cy = ms.reduce((s, m) => s + m.y, 0) / ms.length;
      rol.scrollLeft = cx * zoom - rol.clientWidth / 2;
      rol.scrollTop = cy * zoom - rol.clientHeight / 2;
      const els = [a, b].flatMap((id) => [bolaDoId.get(id), gPos.querySelector(`[data-pos="${id}"]`)]).filter(Boolean);
      for (const el of els) { el.classList.remove("pisca"); void el.getBoundingClientRect(); el.classList.add("pisca"); }
      setTimeout(() => els.forEach((el) => el.classList.remove("pisca")), 2800);
    }
    const pares = esp?.pares || [];
    painel.innerHTML = `<b>Espaçamento dos executados</b>` +
      `<div class="nota" style="color:var(--texto)">${esc(resumoEspacamento(esp))}</div>` +
      (esp ? `<div class="nota">${esc(esp.aviso || CRITERIO)} Limite ${num(esp.resumo?.limite_cm, 0)} cm.</div>` : "") +
      (pares.length ? `<table><tr><th>par</th><th title="medido menos o desenho">diferença no espaçamento (cm)</th>` +
        `<th title="o quanto o vizinho saiu da linha/coluna">fora de linha (cm)</th><th>vale ± (cm)</th><th>situação</th></tr>` +
        pares.slice(0, MAX_LINHAS).map((p, i) =>
          `<tr class="par${p.foge ? " foge" : p.falta_elemento ? " falta" : ""}" data-i="${i}" title="${esc(p.tipo)} · clique para ver na foto">` +
          `<td>${esc(p.a)}–${esc(p.b)}</td><td>${num(p.desvio_cm, 1)}</td><td>${num(p.desalinho_cm, 1)}</td>` +
          `<td>${num(p.vale_cm, 1)}</td><td>${esc(p.situacao || (p.foge ? "FOGE" : "ok"))}</td></tr>`).join("") + `</table>` +
        (pares.length > MAX_LINHAS ? `<div class="nota">mostrando ${MAX_LINHAS} de ${pares.length}; o CSV tem todos</div>` : "")
        : "") +
      (esp ? `<div style="margin-top:8px"><button data-csv class="secundario" title="Baixa a tabela do espaçamento (abre no Excel)">Baixar CSV</button></div>` : "");
    painel.addEventListener("click", (e) => {
      if (e.target.closest("[data-csv]")) {
        baixar(csvEspacamento(esp, nomeObra(), pacote.gerado_em || ""), `espacamento_${nomeDeArquivo(nomeObra())}.csv`,
          "text/csv;charset=utf-8");
        return;
      }
      const tr = e.target.closest("tr[data-i]");
      const p = tr && pares[Number(tr.dataset.i)];
      if (p) mostrarPar(p.a, p.b);
    });
    caixa.querySelector("[data-espac]").onclick = (e) => {
      painel.classList.toggle("oculto");
      e.currentTarget.classList.toggle("ativo", !painel.classList.contains("oculto"));
    };

    // ---- fechar (botão ou Esc; o Esc com a régua marcada só limpa a régua)
    const aoTecla = (e) => {
      if (e.key !== "Escape") return;
      const a = document.activeElement;
      if (a && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA")) return;
      e.preventDefault();
      fechar();
    };
    window.addEventListener("keydown", aoTecla);
    caixa.querySelector("[data-fechar]").onclick = () => fechar();
    visor = {
      fechar() {
        regua?.desligar();
        window.removeEventListener("keydown", aoTecla);
        caixa.remove();
        URL.revokeObjectURL(url);
      },
    };
  }

  function fechar() {
    const v = visor;
    visor = null;
    botao.classList.remove("ativo");
    try { v?.fechar(); } catch (_) { /* nada */ }
  }

  botao.onclick = () => (visor ? fechar() : abrir());
  return { abrir, fechar, aberto: () => !!visor };
}
