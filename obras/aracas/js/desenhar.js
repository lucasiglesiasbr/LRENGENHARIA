// Desenhar por cima da obra, no site publicado: linha, traço livre, seta e texto,
// presos na superfície do modelo (splat ou terreno). O site é estático — não tem
// servidor para guardar nada — então o desenho fica NO NAVEGADOR de quem desenhou
// (localStorage, por obra) e pode ser baixado/carregado como arquivo para mandar
// a outra pessoa. As coordenadas guardadas são E, N, Z de verdade.

import * as THREE from "three";

const CORES = ["#ff3b3b", "#ffd24a", "#3de66e", "#4da3ff", "#ffffff", "#ff50dc"];
const ESPESSURAS = { fino: 0.05, medio: 0.12, grosso: 0.25 };     // raio do traço, em metros

export function iniciarDesenho({ cena, S, $, dica }) {
  const chave = "splatgeo-desenho:" + location.pathname.replace(/index\.html$/, "");
  const grupo = new THREE.Group();
  grupo.renderOrder = 40;
  cena.cena.add(grupo);
  let itens = [];                  // { tipo, cor, esp, pontos: [[E,N,Z]…], texto }
  let modo = null;                 // "linha" | "livre" | "seta" | "texto" | "apagar"
  let atual = null;                // item em construção
  let cor = CORES[0], esp = "medio";
  let arrastando = false;
  const rotulos = [];              // { div, pos: Vector3 }

  const paraCena = (q) => new THREE.Vector3(q[0] - S.origem[0], q[1] - S.origem[1], q[2] - S.origem[2]);
  const paraTerreno = (v) => [+(v.x + S.origem[0]).toFixed(3), +(v.y + S.origem[1]).toFixed(3), +(v.z + S.origem[2]).toFixed(3)];

  // ---- geometria: cada trecho vira um prisma de 6 lados (linha de 1 px some na tela)
  function tubo(pontos, raio) {
    const pos = [], idx = [];
    const L = 6, eixo = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i + 1 < pontos.length; i++) {
      const p = pontos[i], q = pontos[i + 1];
      eixo.subVectors(q, p);
      if (eixo.lengthSq() < 1e-8) continue;
      eixo.normalize();
      a.set(0, 0, 1);
      if (Math.abs(eixo.z) > 0.9) a.set(1, 0, 0);
      a.cross(eixo).normalize();
      b.crossVectors(eixo, a);
      const base = pos.length / 3;
      for (const c of [p, q]) {
        for (let k = 0; k < L; k++) {
          const t = (k / L) * Math.PI * 2;
          pos.push(c.x + raio * (Math.cos(t) * a.x + Math.sin(t) * b.x),
            c.y + raio * (Math.cos(t) * a.y + Math.sin(t) * b.y),
            c.z + raio * (Math.cos(t) * a.z + Math.sin(t) * b.z));
        }
      }
      for (let k = 0; k < L; k++) {
        const k2 = (k + 1) % L;
        idx.push(base + k, base + k2, base + L + k, base + k2, base + L + k2, base + L + k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  /** Linha de 1 px por cima do tubo: de longe o tubo some, o fio não. */
  function fio(pontos, cor) {
    const g = new THREE.BufferGeometry().setFromPoints(pontos);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: cor, depthTest: false }));
  }

  function pontosDaSeta(p, q) {
    // haste + duas abas na ponta, no plano que contém a haste e o "para cima"
    const d = new THREE.Vector3().subVectors(q, p);
    const comp = d.length();
    if (comp < 1e-6) return [[p, q]];
    d.normalize();
    let lado = new THREE.Vector3(0, 0, 1).cross(d);
    if (lado.lengthSq() < 1e-6) lado = new THREE.Vector3(1, 0, 0);
    lado.normalize();
    const aba = Math.min(comp * 0.3, 2.5);
    const base = q.clone().addScaledVector(d, -aba);
    return [[p, q], [q, base.clone().addScaledVector(lado, aba * 0.5)], [q, base.clone().addScaledVector(lado, -aba * 0.5)]];
  }

  function desenharItem(it) {
    const mat = new THREE.MeshBasicMaterial({ color: it.cor, depthTest: false, transparent: true, opacity: 0.95 });
    const pts = it.pontos.map(paraCena);
    const raio = ESPESSURAS[it.esp] || ESPESSURAS.medio;
    const obj = new THREE.Group();
    if (it.tipo === "marcador") {
      const pe = pts[0], alto = pe.clone().add(new THREE.Vector3(0, 0, 2.5));
      obj.add(new THREE.Mesh(tubo([pe, alto], 0.05), mat));
      const bola = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), mat);
      bola.position.copy(alto);
      bola.userData.tamanhoNaTela = true;
      obj.add(bola);
      const div = document.createElement("div");
      div.className = "rotulo3d anotacao marcador";
      div.style.borderColor = it.cor;
      const curto = it.texto.length > 28 ? it.texto.slice(0, 27) + "…" : it.texto;
      div.innerHTML = `<b style="color:${it.cor}">📍 ${it.n}</b> <span class="curto"></span><div class="cheio"></div>`;
      div.querySelector(".curto").textContent = curto;
      div.querySelector(".cheio").textContent = it.texto;
      div.title = "clique para abrir/fechar a observação";
      div.onclick = () => div.classList.toggle("aberto");
      cena.camadaRotulos.appendChild(div);
      rotulos.push({ div, pos: alto, it });
    } else if (it.tipo === "texto") {
      const div = document.createElement("div");
      div.className = "rotulo3d anotacao";
      div.textContent = it.texto;
      div.style.borderColor = it.cor;
      div.style.color = it.cor;
      cena.camadaRotulos.appendChild(div);
      rotulos.push({ div, pos: pts[0], it });
      const bola = new THREE.Mesh(new THREE.SphereGeometry(raio * 2.2, 10, 8), mat);
      bola.position.copy(pts[0]);
      obj.add(bola);
    } else if (it.tipo === "seta" && pts.length >= 2) {
      for (const par of pontosDaSeta(pts[0], pts[pts.length - 1])) { obj.add(new THREE.Mesh(tubo(par, raio), mat)); obj.add(fio(par, it.cor)); }
    } else if (pts.length >= 2) {
      obj.add(new THREE.Mesh(tubo(pts, raio), mat));
      obj.add(fio(pts, it.cor));
    } else if (pts.length === 1) {
      const bola = new THREE.Mesh(new THREE.SphereGeometry(raio * 1.6, 10, 8), mat);
      bola.position.copy(pts[0]);
      obj.add(bola);
    }
    obj.traverse((o) => { o.renderOrder = 40; o.frustumCulled = false; });
    obj.userData.item = it;
    grupo.add(obj);
    return obj;
  }

  function redesenhar() {
    for (const o of [...grupo.children]) {
      grupo.remove(o);
      o.traverse((x) => { x.geometry?.dispose(); x.material?.dispose(); });
    }
    for (const r of rotulos.splice(0)) r.div.remove();
    for (const it of itens) desenharItem(it);
    if (atual && atual.pontos.length) desenharItem(atual);
    atualizarInfo();
    listarMarcadores();
  }

  function comprimento(it) {
    let t = 0;
    for (let i = 0; i + 1 < it.pontos.length; i++) {
      t += Math.hypot(it.pontos[i + 1][0] - it.pontos[i][0], it.pontos[i + 1][1] - it.pontos[i][1], it.pontos[i + 1][2] - it.pontos[i][2]);
    }
    return t;
  }

  function atualizarInfo() {
    const n = itens.length;
    const ultimo = itens[n - 1];
    $("#info-desenho").innerHTML = n
      ? `${n} desenho(s) guardado(s) neste navegador` +
        (ultimo && ultimo.tipo !== "texto" && ultimo.tipo !== "marcador" ? ` · o último tem <b>${comprimento(ultimo).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m</b>` : "")
      : "";
    $("#btn-des-desfazer").disabled = !n;
    $("#btn-des-limpar").disabled = !n;
    $("#btn-des-baixar").disabled = !n;
  }

  /** Lista dos marcadores no painel: clicar leva a câmera até o lugar. */
  function listarMarcadores() {
    const lista = $("#lista-marcadores");
    const ms = itens.filter((it) => it.tipo === "marcador");
    lista.innerHTML = ms.length ? `<div class="titulo-marc">Marcadores (${ms.length})</div>` + ms.map((it) =>
      `<div class="marc" data-n="${it.n}" title="ir até o marcador"><b style="color:${it.cor}">📍 ${it.n}</b> <span></span></div>`).join("") : "";
    lista.querySelectorAll(".marc").forEach((el) => {
      const it = ms.find((m) => String(m.n) === el.dataset.n);
      el.querySelector("span").textContent = it.texto;
      el.onclick = () => {
        const alvo = paraCena(it.pontos[0]);
        const dir = new THREE.Vector3().subVectors(cena.camera.position, cena.controles.target);
        dir.setLength(Math.min(Math.max(dir.length(), 15), 40));
        cena.controles.target.copy(alvo);
        cena.camera.position.copy(alvo).add(dir);
        cena.controles.update();
        rotulos.forEach((r) => r.div.classList.toggle("aberto", r.it === it));
      };
    });
  }

  function guardar() {
    try { localStorage.setItem(chave, JSON.stringify({ versao: 1, itens })); } catch (_) { /* navegador sem armazenamento */ }
  }

  function concluir() {
    if (atual && (atual.pontos.length >= 2 || ((atual.tipo === "texto" || atual.tipo === "marcador") && atual.pontos.length))) {
      itens.push(atual);
      guardar();
    }
    atual = null;
    redesenhar();
  }

  // ---- rótulos de texto acompanham a câmera
  const v = new THREE.Vector3();
  (function quadro() {
    const l = cena.canvas.clientWidth, a = cena.canvas.clientHeight;
    for (const r of rotulos) {
      v.copy(r.pos).project(cena.camera);
      const visivel = v.z < 1 && grupo.visible;
      r.div.style.display = visivel ? "block" : "none";
      if (visivel) { r.div.style.left = `${(v.x * 0.5 + 0.5) * l}px`; r.div.style.top = `${(-v.y * 0.5 + 0.5) * a - 14}px`; }
    }
    grupo.traverse((o) => {                           // o alfinete não some de longe
      if (o.userData.tamanhoNaTela) o.scale.setScalar(Math.max(1, cena.camera.position.distanceTo(o.position) * 0.02));
    });
    requestAnimationFrame(quadro);
  })();

  // ---- modos
  const DICAS = {
    linha: "Linha: clique nos pontos sobre o modelo; duplo clique (ou Enter) termina. Esc cancela.",
    livre: "Traço livre: segure o botão esquerdo e arraste sobre o modelo. Para girar a vista, desligue a ferramenta.",
    seta: "Seta: clique onde ela começa e depois para onde aponta.",
    texto: "Texto: clique no lugar e escreva a anotação.",
    marcador: "Marcador: clique no lugar e escreva a observação. Depois, clique na etiqueta para ler; a lista leva até ele.",
    apagar: "Apagar: clique em cima de um desenho para tirar só ele.",
  };
  function sair() {
    if (atual) concluir();
    modo = null;
    cena.controles.enabled = true;
    document.querySelectorAll("#desenhar [data-modo]").forEach((b) => b.classList.remove("ativo"));
    $("#tela").style.cursor = "";
    dica("");
  }
  function entrar(novo) {
    const mesmo = modo === novo;
    sair();
    if (mesmo) return;
    S.aoDesenhar?.();                                  // encerra a medição, se houver
    modo = novo;
    document.querySelector(`#desenhar [data-modo="${novo}"]`).classList.add("ativo");
    $("#tela").style.cursor = "crosshair";
    if (novo === "livre") cena.controles.enabled = false;   // senão o arrasto gira a vista
    dica(DICAS[novo]);
  }
  S.desenhando = () => !!modo;
  S.sairDoDesenho = sair;

  function itemSobCursor(e, tolerancia = 12) {
    const r = cena.canvas.getBoundingClientRect();
    let melhor = null, menor = tolerancia;
    for (const it of itens) {
      for (const q of it.pontos) {
        v.copy(paraCena(q)).project(cena.camera);
        if (v.z > 1) continue;
        const d = Math.hypot((v.x * 0.5 + 0.5) * r.width - (e.clientX - r.left), (-v.y * 0.5 + 0.5) * r.height - (e.clientY - r.top));
        if (d < menor) { menor = d; melhor = it; }
      }
    }
    return melhor;
  }

  const tela = $("#tela");
  let inicio = null;
  tela.addEventListener("pointerdown", (e) => {
    inicio = { x: e.clientX, y: e.clientY, t: Date.now() };
    if (modo !== "livre" || e.button !== 0) return;
    const alvo = cena.apontar(e, {});
    if (!alvo) return;
    arrastando = true;
    try { tela.setPointerCapture(e.pointerId); } catch (_) { /* sem captura funciona igual */ }
    atual = { tipo: "livre", cor, esp, pontos: [paraTerreno(alvo.ponto)] };
  });
  tela.addEventListener("pointermove", (e) => {
    if (!arrastando || !atual) return;
    const alvo = cena.apontar(e, {});
    if (!alvo) return;
    const q = paraTerreno(alvo.ponto), u = atual.pontos[atual.pontos.length - 1];
    if (Math.hypot(q[0] - u[0], q[1] - u[1], q[2] - u[2]) < 0.15) return;
    atual.pontos.push(q);
    redesenhar();
  });
  tela.addEventListener("pointerup", (e) => {
    if (arrastando) {
      arrastando = false;
      try { tela.releasePointerCapture(e.pointerId); } catch (_) { /* não estava preso */ }
      concluir();
      return;
    }
    if (!modo || modo === "livre" || !inicio) return;
    const arrastou = Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 4;
    const demorou = Date.now() - inicio.t > 400;
    inicio = null;
    if (arrastou || demorou || e.button !== 0) return;
    if (modo === "apagar") {
      const it = itemSobCursor(e);
      if (!it) { dica("nenhum desenho aí — clique em cima de uma ponta ou dobra do desenho"); return; }
      itens = itens.filter((x) => x !== it);
      guardar();
      redesenhar();
      return;
    }
    const alvo = cena.apontar(e, {});
    if (!alvo) { dica("clique em cima do modelo (splat ou terreno)"); return; }
    const q = paraTerreno(alvo.ponto);
    if (modo === "marcador") {
      const texto = (prompt("Observação deste marcador:") || "").trim();
      if (!texto) return;
      const n = itens.reduce((m, it) => Math.max(m, it.tipo === "marcador" ? Number(it.n) || 0 : 0), 0) + 1;
      atual = { tipo: "marcador", cor, esp, pontos: [q], texto: texto.slice(0, 600), n };
      concluir();
      return;
    }
    if (modo === "texto") {
      const texto = (prompt("Texto da anotação:") || "").trim();
      if (!texto) return;
      atual = { tipo: "texto", cor, esp, pontos: [q], texto: texto.slice(0, 120) };
      concluir();
      return;
    }
    if (!atual) atual = { tipo: modo, cor, esp, pontos: [] };
    atual.pontos.push(q);
    if (modo === "seta" && atual.pontos.length === 2) { concluir(); return; }
    redesenhar();
  });
  tela.addEventListener("dblclick", () => { if (modo === "linha" && atual) { atual.pontos.pop(); concluir(); } });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && modo === "linha" && atual) concluir();
    if (e.key === "Escape" && modo) { atual = null; sair(); redesenhar(); }
  });

  // ---- painel
  const caixa = $("#desenhar");
  caixa.querySelector(".cores").innerHTML = CORES.map((c, i) =>
    `<span class="cor${i ? "" : " ativa"}" data-cor="${c}" style="background:${c}" title="cor do traço"></span>`).join("");
  caixa.querySelectorAll("[data-cor]").forEach((el) => {
    el.onclick = () => {
      cor = el.dataset.cor;
      caixa.querySelectorAll("[data-cor]").forEach((x) => x.classList.toggle("ativa", x === el));
    };
  });
  caixa.querySelectorAll("[data-modo]").forEach((b) => { b.onclick = () => entrar(b.dataset.modo); });
  $("#des-espessura").onchange = (e) => { esp = e.target.value; };
  $("#ver-desenho").onchange = (e) => { grupo.visible = e.target.checked; };
  $("#btn-des-desfazer").onclick = () => { itens.pop(); guardar(); redesenhar(); };
  $("#btn-des-limpar").onclick = () => {
    if (!confirm("Apagar TODOS os desenhos desta obra neste navegador?")) return;
    itens = []; guardar(); redesenhar();
  };
  $("#btn-des-baixar").onclick = () => {
    const blob = new Blob([JSON.stringify({ versao: 1, obra: document.title, origem: S.origem, itens }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "desenho_" + (document.title.split("—")[0].trim().replace(/[^\w\-]+/g, "_") || "obra") + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $("#des-arquivo").onchange = async (e) => {
    const arq = e.target.files[0];
    if (!arq) return;
    try {
      const d = JSON.parse(await arq.text());
      const novos = (d.itens || []).filter((it) => Array.isArray(it.pontos) && it.pontos.length);
      if (!novos.length) throw new Error("vazio");
      let n = itens.reduce((m, it) => Math.max(m, it.tipo === "marcador" ? Number(it.n) || 0 : 0), 0);
      for (const it of novos) if (it.tipo === "marcador") it.n = ++n;
      itens = itens.concat(novos);
      guardar(); redesenhar();
      dica(`${novos.length} desenho(s) carregado(s) do arquivo`);
    } catch (_) { dica("esse arquivo não é um desenho do Splat Geo"); }
    e.target.value = "";
  };
  $("#btn-des-carregar").onclick = () => $("#des-arquivo").click();

  try { itens = (JSON.parse(localStorage.getItem(chave) || "{}").itens || []).filter((it) => Array.isArray(it.pontos)); } catch (_) { itens = []; }
  redesenhar();
  return { sair, quantos: () => itens.length };
}
