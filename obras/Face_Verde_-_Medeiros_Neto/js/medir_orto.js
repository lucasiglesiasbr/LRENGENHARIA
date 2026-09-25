// Medir na ORTOFOTO crua do voo (item 6 do "medir sem atravessar o splat"):
// visor 2D da foto aérea de 2 cm por pixel para marcar pontos de uma MEDIDA
// em planta (meio-fio, faixa, tampa, pé de muro). Não é o "ou na ortofoto" dos
// pontos de controle (marcar_orto.js): lá o clique troca a origem de um ponto
// do encaixe; aqui o clique vira ponto da medida ativa do medir.js.
//
// Conta da planta (a mesma do marcar_orto, D13): pixel da tif -> E, N do voo
// -> referencial do splat pelo desloc do ODX (x = E - dE, y = N - dN) -> obra
// pela matriz do voo (ctx.paraCena, que o medir.js monta). A altura vem do
// modelo (ctx.alturaSplat: raio vertical no referencial do voo, profundidade
// da imagem a 30 %), ou, só na página, do chão calculado do voo (ctx.alturaDTM
// = rota orto/ponto); sem nenhuma, a do ponto anterior, e a medida só vale em
// planta ("nenhum").
//
// Sem imports e sem tocar em window no import: vooDePixel e pixelDeVoo são
// puras (testadas em node contra splatgeo/marcar_orto.ponto). O Leaflet é o
// window.L (o site carrega sob pedido por ctx.carregarLeaflet).
//
// ctx = { container, I, tela(z,x,y) -> string | Promise<string|null> | null,
//         paraCena(x_voo,y_voo,z_voo) -> [x,y,z] (ou {x,y,z}) da cena,
//         alturaSplat(x_voo,y_voo) -> {z_voo, sigma_m} | null (pode ser Promise),
//         alturaDTM: null | async (u,v) -> {z_voo, z_de},
//         modoMedida() -> "livre" | "horizontal" | …, pontos() -> [{u, v, n?, xyz?, z_voo?}],
//         aoMarcar: async (ponto), aoFechar(), carregarLeaflet: async () }
//   opcionais: zCena(x_voo,y_voo) -> z_voo | null (terreno da cena, quando não há
//   altura nem ponto anterior); fechada() -> true desenha o contorno fechado (área).
// ponto de aoMarcar = { u, v, px:[u,v] (2 casas), x_voo, y_voo, z_voo, z_de:"splat"|"dtm"|"dsm"|"nenhum",
//   cena:[x,y,z] (sem a origem: o medir.js soma), sigma_m: 0.03 (planta), sigma_z_m (splat: o do
//   clique; dtm/dsm: 0.30; nenhum: null), aviso: null | "sem altura: vale só em planta",
//   orto: {voo, px, z_de} }
// Retorno: { fechar, aberto, desenhar (refaz as marcas por ctx.pontos()), mapa, pronto }.

/** Pixel contínuo da tif (quina de cima à esquerda = 0, 0) -> [x, y] no referencial do voo (splat). */
export function vooDePixel(I, u, v) {
  const d = I && Array.isArray(I.desloc) ? I.desloc : null;
  if (!d) return [NaN, NaN];
  return [I.E0 + u * I.sx - d[0], I.N0 - v * I.sy - d[1]];
}

/** Inversa de vooDePixel: [x, y] do voo -> pixel contínuo [u, v] da tif. */
export function pixelDeVoo(I, x, y) {
  const d = I && Array.isArray(I.desloc) ? I.desloc : null;
  if (!d) return [NaN, NaN];
  return [(x + d[0] - I.E0) / I.sx, (I.N0 - (y + d[1])) / I.sy];
}

const RODAPE = "Clique nas pontas NO CHÃO. Longe, o clique aproxima; no zoom máximo, o clique marca. " +
  "Serve para planta: meio-fio, faixa, tampa, pé de muro. Poste, beiral e topo de muro saem borrados.";
const SEM_ALTURA = "sem altura: vale só em planta";
const SIGMA_PLANTA = 0.03, SIGMA_DTM = 0.30;
const VERDE = "#3de66e";

const ESTILO = `
#medir-orto { position:absolute; inset:52px 12px 34px 12px; z-index:1600; display:flex; flex-direction:column;
  background:#14161a; border:2px solid ${VERDE}; border-radius:6px; overflow:hidden; color:#e6e8ec; font-size:13px; }
#medir-orto.oculto { display:none; }
#medir-orto .mo-barra { display:flex; gap:8px; align-items:center; padding:6px 10px; flex-wrap:wrap;
  background:#173d27; border-bottom:1px solid ${VERDE}; }
#medir-orto .mo-titulo { font-weight:600; }
#medir-orto .mo-titulo b { color:#9df5b8; }
#medir-orto .mo-barra button, #medir-orto .mo-barra select { width:auto; flex:none; }
#medir-orto .mo-altura { margin-left:auto; display:flex; gap:6px; align-items:center; font-size:12px; }
#medir-orto .mo-altura.oculto { display:none; }
#medir-orto .mo-fechar { margin-left:4px; }
#medir-orto .mo-mapa { flex:1; min-height:200px; background:#303030; }
#medir-orto .mo-mapa.mira { cursor:crosshair; } #medir-orto .mo-mapa.lupa { cursor:zoom-in; }
#medir-orto .leaflet-tile { image-rendering: pixelated; }
#medir-orto .mo-dica { padding:4px 10px; font-size:12px; }
#medir-orto .mo-dica:empty { display:none; }
#medir-orto .mo-dica .alerta { color:#ffb454; }
#medir-orto .mo-rodape { padding:2px 10px 6px; font-size:11px; color:#9aa3b2; }
#medir-orto .mo-bola { pointer-events:none; }
#medir-orto .mo-bola span { display:flex; align-items:center; justify-content:center; width:18px; height:18px;
  border-radius:50%; background:${VERDE}; color:#0a2814; font:700 11px/1 sans-serif; box-shadow:0 0 0 2px #0a2814; }
#medir-orto .mo-comp { background:rgba(10,40,20,.85); color:#e6ffe9; border:1px solid ${VERDE};
  font-size:11px; padding:1px 5px; box-shadow:none; }
#medir-orto .mo-comp::before { display:none; }
`;

function injetarEstilo() {
  if (document.getElementById("medir-orto-estilo")) return;
  const st = document.createElement("style");
  st.id = "medir-orto-estilo";
  st.textContent = ESTILO;
  document.head.appendChild(st);
}

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const m2 = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vooCurto = (v) => String(v || "").replace(/ \(voo processado\)$/, "");
const finito = (v) => typeof v === "number" && isFinite(v);
const comoLista = (p) => (Array.isArray(p) ? [p[0], p[1], p[2]] : p && typeof p === "object" ? [p.x, p.y, p.z] : null);

let atual = null;   // o visor aberto (um só por vez)

export function abrirMedirOrto(ctx) {
  if (atual) atual.fechar();
  const I = ctx.I;
  let estaAberto = true, geracao = 0, ocupado = false;
  let L = null, mapa = null, camada = null, marcas = null, zAnterior = null;
  let painel = null, elMapa = null, elDica = null, elAltura = null, elSelAltura = null;
  let observador = null;

  function fechar() {
    if (!estaAberto) return;
    estaAberto = false;
    geracao++;
    window.removeEventListener("keydown", teclas, true);
    window.removeEventListener("resize", aoRedimensionar);
    try { observador?.disconnect(); } catch (_) { /* nada */ }
    try { mapa?.remove(); } catch (_) { /* nada */ }
    mapa = camada = marcas = null;
    painel?.remove();
    painel = null;
    if (atual === ui) atual = null;
    try { ctx.aoFechar?.(); } catch (erro) { console.warn("medir na ortofoto: aoFechar", erro); }
  }

  const ui = { fechar, aberto: () => estaAberto, desenhar: () => desenhar(), mapa: () => mapa, pronto: null };
  atual = ui;

  // ------------------------------------------------------------- painel
  injetarEstilo();
  painel = document.createElement("div");
  painel.id = "medir-orto";
  const cmPx = finito(I?.sx) ? (I.sx * 100).toLocaleString("pt-BR", { maximumFractionDigits: I.sx < 0.01 ? 1 : 0 }) : "2";
  painel.innerHTML = `
    <div class="mo-barra">
      <span class="mo-titulo">MEDINDO na ortofoto do voo <b>${esc(vooCurto(I?.voo))}</b> (não é ponto de controle) · ${cmPx} cm por pixel</span>
      <label class="mo-altura" title="De onde vem a altura (Z) de cada ponto marcado aqui">altura:
        <select class="mo-sel-altura">
          <option value="splat">do modelo do drone</option>
          ${ctx.alturaDTM ? '<option value="dtm">do chão calculado do voo</option>' : ""}
        </select></label>
      <button class="secundario mo-fechar">Fechar (Esc)</button>
    </div>
    <div class="mo-mapa" tabindex="0"></div>
    <div class="mo-dica"></div>
    <div class="mo-rodape">${esc(RODAPE)}</div>`;
  (ctx.container || document.body).appendChild(painel);
  elMapa = painel.querySelector(".mo-mapa");
  elDica = painel.querySelector(".mo-dica");
  elAltura = painel.querySelector(".mo-altura");
  elSelAltura = painel.querySelector(".mo-sel-altura");
  painel.querySelector(".mo-fechar").onclick = () => fechar();
  // o Ctrl+Z e as teclas do medir ignoram foco em SELECT: devolve o foco ao mapa
  elSelAltura.onchange = () => { elSelAltura.blur(); elMapa.focus(); };

  const dica = (html) => { if (elDica) elDica.innerHTML = html || ""; };

  function atualizarAltura() {
    let modo = null;
    try { modo = ctx.modoMedida?.(); } catch (_) { modo = null; }
    elAltura?.classList.toggle("oculto", modo === "horizontal");
  }

  // ------------------------------------------------------------- teclas
  // Esc fecha o visor (e não chega ao medir.js, que encerraria a captura).
  // Setas, PageUp/PageDown e W/A/S/D/Q/E param aqui, na captura da window: com o
  // visor aberto a câmera 3D andaria escondida embaixo e o medir.js empurraria o
  // ponto selecionado. As setas andam a foto (80 px, 3x com Shift), como no marcar_orto.
  const PASSO_SETA = { ArrowUp: [0, -80], ArrowDown: [0, 80], ArrowLeft: [-80, 0], ArrowRight: [80, 0] };
  function teclas(e) {
    if (!estaAberto) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      fechar();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/^(Arrow|Page)/.test(e.key) && !/^[wasdqe]$/i.test(e.key)) return;
    const alvo = e.target;
    if (/INPUT|TEXTAREA|SELECT/.test(alvo?.tagName || "") || alvo?.isContentEditable) return;
    e.stopImmediatePropagation();
    if (!mapa || !/^(Arrow|Page)/.test(e.key)) return;
    e.preventDefault();
    const d = PASSO_SETA[e.key];
    if (d && !mapa._panAnim?._inProgress) mapa.panBy(e.shiftKey ? [d[0] * 3, d[1] * 3] : d);
  }
  window.addEventListener("keydown", teclas, true);

  const aoRedimensionar = () => mapa?.invalidateSize({ animate: false });
  window.addEventListener("resize", aoRedimensionar);

  // ------------------------------------------------------------- mapa
  async function montar() {
    const minha = geracao;
    L = window.L;
    if (!L && ctx.carregarLeaflet) {
      try { await ctx.carregarLeaflet(); } catch (erro) { console.warn("medir na ortofoto: Leaflet", erro); }
      if (minha !== geracao || !estaAberto) return;
      L = window.L;
    }
    if (!L) {
      dica('<span class="alerta">não consegui carregar o mapa da ortofoto neste navegador</span>');
      return;
    }
    if (!I || !finito(I.largura) || !finito(I.altura) || !finito(I.zoom_nativo)) {
      dica('<span class="alerta">a ortofoto do voo não está disponível</span>');
      return;
    }
    const f = 2 ** I.zoom_nativo;
    // no zoom nativo 1 px de tela = 1 px da tif; latlng = [v, u], v crescendo para baixo
    const crs = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(1 / f, 0, 1 / f, 0) });
    mapa = L.map(elMapa, { crs, minZoom: I.zoom_min, maxZoom: I.zoom_max, attributionControl: false,
      doubleClickZoom: false, zoomSnap: 1, keyboard: false });
    marcas = L.layerGroup().addTo(mapa);
    // as bolinhas numeradas ficam por cima dos rótulos de comprimento (tooltipPane = 650)
    mapa.createPane("mo-bolas").style.zIndex = 660;

    const Camada = L.GridLayer.extend({
      createTile(coords, pronto) {
        const img = document.createElement("img");
        img.alt = "";
        img.setAttribute("role", "presentation");
        const cinza = () => {
          img.removeAttribute("src");
          img.style.background = "#303030";
          pronto(null, img);
        };
        const usar = (url) => {
          if (img._moMorta) {
            if (typeof url === "string" && url.startsWith("blob:")) URL.revokeObjectURL(url);
            return;
          }
          if (!url) { cinza(); return; }
          img._moUrl = url;
          img.onload = () => pronto(null, img);
          img.onerror = () => { soltar(img); cinza(); };
          img.src = url;
        };
        let r;
        try { r = ctx.tela(coords.z, coords.x, coords.y); } catch (_) { r = null; }
        if (r && typeof r.then === "function") r.then(usar, () => usar(null));
        else setTimeout(() => usar(r || null), 0);    // o Leaflet espera o done depois do return
        return img;
      },
    });
    camada = new Camada({ tileSize: 256, noWrap: true, bounds: L.latLngBounds([0, 0], [I.altura, I.largura]),
      minZoom: I.zoom_min, maxZoom: I.zoom_max, minNativeZoom: I.zoom_min, maxNativeZoom: I.zoom_nativo,
      keepBuffer: 2 });
    // a tela que sai do mapa devolve o Blob URL (site); a que ainda não chegou não entra mais
    camada.on("tileunload", (e) => { if (e.tile) { e.tile._moMorta = true; soltar(e.tile); } });
    camada.addTo(mapa);
    camada.bringToBack();

    // arrastar não marca: o Leaflet não dispara click depois de arrastar.
    // O clique do mouse chega com clientX/clientY INTEIROS (quina do pixel da tela):
    // soma meio pixel da TELA, em pixels da tif (a mesma correção do marcar_orto).
    mapa.on("click", (e) => {
      const ev = e.originalEvent;
      const meio = ev && Number.isInteger(ev.clientX) && Number.isInteger(ev.clientY)
        ? 0.5 * 2 ** (I.zoom_nativo - mapa.getZoom()) : 0;
      marcar(e.latlng.lng + meio, e.latlng.lat + meio);
    });
    mapa.on("zoomend", atualizarCursor);

    if (window.ResizeObserver) {
      observador = new ResizeObserver(() => {
        if (mapa && estaAberto && elMapa.clientHeight > 0) mapa.invalidateSize({ animate: false, pan: false });
      });
      observador.observe(elMapa);
    }
    centralizar();
    desenhar();
    elMapa.focus();
  }

  function soltar(img) {
    const u = img?._moUrl;
    if (typeof u === "string" && u.startsWith("blob:")) URL.revokeObjectURL(u);
    if (img) img._moUrl = null;
  }

  function atualizarCursor() {
    if (!mapa) return;
    const perto = mapa.getZoom() >= I.zoom_nativo;
    elMapa.classList.toggle("mira", perto);
    elMapa.classList.toggle("lupa", !perto);
  }

  /** Abre no último ponto já marcado (no zoom nativo) ou na foto inteira. */
  function centralizar() {
    if (!mapa) return;
    mapa.invalidateSize({ animate: false, pan: false });
    const pts = lerPontos().filter((p) => finito(p.u) && finito(p.v));
    const ult = pts[pts.length - 1];
    if (ult) mapa.setView([ult.v, ult.u], I.zoom_nativo, { animate: false });
    else mapa.fitBounds([[0, 0], [I.altura, I.largura]], { animate: false });
    atualizarCursor();
  }

  function lerPontos() {
    let pts = [];
    try { pts = ctx.pontos?.() || []; } catch (_) { pts = []; }
    return Array.isArray(pts) ? pts : [];
  }

  // ------------------------------------------------------------- marcas
  /** Comprimento em planta de um trecho: pela obra (xyz) quando os dois têm, senão pelo pixel. */
  function emPlanta(a, b) {
    const pa = a.xyz, pb = b.xyz;
    if (Array.isArray(pa) && Array.isArray(pb) && [pa[0], pa[1], pb[0], pb[1]].every(finito)) {
      return Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    }
    return Math.hypot((b.u - a.u) * I.sx, (b.v - a.v) * I.sy);
  }

  function desenhar() {
    atualizarAltura();
    if (!mapa || !marcas || !L) return;
    marcas.clearLayers();
    const naoClica = { interactive: false, bubblingMouseEvents: false };
    const pts = lerPontos().map((p, i) => ({ ...p, n: p?.n ?? i + 1 }))
      .filter((p) => finito(p.u) && finito(p.v));
    const trechos = pts.slice(1).map((b, i) => [pts[i], b]);
    let fechada = false;
    try { fechada = !!ctx.fechada?.(); } catch (_) { fechada = false; }
    if (fechada && pts.length >= 3) trechos.push([pts[pts.length - 1], pts[0]]);
    for (const [a, b] of trechos) {
      L.polyline([[a.v, a.u], [b.v, b.u]], { ...naoClica, color: VERDE, weight: 2, opacity: 0.95 }).addTo(marcas);
      const c = emPlanta(a, b);
      if (!finito(c)) continue;
      L.tooltip({ permanent: true, direction: "center", className: "mo-comp", interactive: false })
        .setLatLng([(a.v + b.v) / 2, (a.u + b.u) / 2]).setContent(`${m2(c)} m`).addTo(marcas);
    }
    for (const p of pts) {
      L.marker([p.v, p.u], { interactive: false, keyboard: false, pane: "mo-bolas",
        icon: L.divIcon({ className: "mo-bola", html: `<span>${esc(p.n)}</span>`, iconSize: [18, 18], iconAnchor: [9, 9] }) })
        .addTo(marcas);
    }
  }

  // ------------------------------------------------------------- marcar
  async function marcar(u, v) {
    if (!estaAberto || !mapa) return;
    // longe demais o clique só aproxima (no zoom nativo 1 px da tela = 1 px da foto)
    if (mapa.getZoom() < I.zoom_nativo) {
      mapa.setView([v, u], I.zoom_nativo);
      dica("cliquei para aproximar: no zoom máximo da foto o clique marca");
      return;
    }
    if (!(u >= 0 && v >= 0 && u < I.largura && v < I.altura)) {
      dica('<span class="alerta">fora da foto: clique dentro da ortofoto</span>');
      return;
    }
    if (ocupado) return;                                  // um clique por vez
    ocupado = true;
    const minha = geracao;
    try {
      const [x, y] = vooDePixel(I, u, v);
      if (!finito(x) || !finito(y)) { dica('<span class="alerta">a ortofoto não tem o deslocamento do voo</span>'); return; }
      const querDTM = elSelAltura?.value === "dtm" && !!ctx.alturaDTM;
      let z = null, z_de = "nenhum", sigma_z = null, motivo = "";
      if (!querDTM && ctx.alturaSplat) {
        let r = null;
        try { r = await ctx.alturaSplat(x, y); } catch (erro) { r = null; motivo = erro?.message || ""; }
        if (minha !== geracao) return;
        if (r && finito(r.z_voo)) {
          z = r.z_voo;
          z_de = "splat";
          sigma_z = finito(r.sigma_m) ? r.sigma_m : null;
        }
      }
      let trocou = false;
      if (z == null && ctx.alturaDTM) {
        let r = null;
        try { r = await ctx.alturaDTM(u, v); } catch (erro) { r = null; motivo = erro?.message || motivo; }
        if (minha !== geracao) return;
        if (r && finito(r.z_voo)) {
          z = r.z_voo;
          z_de = r.z_de && r.z_de !== "clique" ? String(r.z_de) : "dtm";
          sigma_z = SIGMA_DTM;
          trocou = !querDTM;
        }
      }
      let aviso = null;
      if (z == null) {
        // sem altura: a do ponto anterior (ou a do terreno da cena); a medida vale só em planta
        let zc = zAnterior;
        if (zc == null) {
          const ant = lerPontos().filter((p) => finito(p?.z_voo));
          if (ant.length) zc = ant[ant.length - 1].z_voo;
        }
        if (zc == null && ctx.zCena) {
          try { const r = ctx.zCena(x, y); zc = finito(r) ? r : null; } catch (_) { zc = null; }
        }
        if (zc == null) {
          dica('<span class="alerta">não achei a altura aqui (nem o modelo nem um ponto anterior): ' +
            "marque primeiro um ponto onde o modelo do drone tem chão</span>");
          return;
        }
        z = zc;
        aviso = SEM_ALTURA;
      }
      const c = comoLista(ctx.paraCena(x, y, z));
      if (!c || !c.every(finito)) { dica('<span class="alerta">não consegui levar o ponto para a obra</span>'); return; }
      const px = [Math.round(u * 100) / 100, Math.round(v * 100) / 100];
      const ponto = { u, v, px, x_voo: x, y_voo: y, z_voo: z, z_de, cena: c,
        sigma_m: SIGMA_PLANTA, sigma_z_m: z_de === "splat" ? sigma_z : z_de === "nenhum" ? null : SIGMA_DTM,
        aviso, orto: { voo: I.voo ?? null, px, z_de } };
      await ctx.aoMarcar(ponto);
      if (minha !== geracao || !estaAberto) return;
      zAnterior = z;
      desenhar();
      dica(z_de === "splat" ? "ponto marcado · altura pelo modelo do drone"
        : z_de === "nenhum" ? `<span class="alerta">ponto marcado · ${esc(SEM_ALTURA)}</span>` +
          (motivo ? ` (${esc(motivo)})` : "")
        : `ponto marcado · altura pelo chão calculado do voo (±30 cm)` +
          (trocou ? " — o modelo do drone não tem chão aqui" : ""));
    } catch (erro) {
      if (minha === geracao) dica(`<span class="alerta">${esc(erro?.message || erro)}</span>`);
    } finally {
      if (minha === geracao) ocupado = false;
    }
  }

  atualizarAltura();
  ui.pronto = montar().catch((erro) => {
    console.warn("medir na ortofoto:", erro);
    dica(`<span class="alerta">${esc(erro?.message || erro)}</span>`);
  });
  return ui;
}
