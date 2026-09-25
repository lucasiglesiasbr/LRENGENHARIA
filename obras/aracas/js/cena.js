// Cena 3D: terreno com imagem de satélite, desenho do topógrafo e o splat.
// O sistema da cena é local e em metros: X = Este, Y = Norte, Z = altura,
// medidos a partir da origem da obra. Assim medir é só subtrair coordenadas.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const COR_LINHA = 0x51c06a;
const COR_PONTO = 0xffb454;
const COR_MEDIDA = 0x4da3ff;
// seções do projeto: perfil do terreno, estrutura, tirantes, drenagem
const COR_SECAO = { terreno: 0xd2a56d, projeto: 0xf2f2f2, tirante: 0xff5c5c,
  drenagem: 0x62d0ff };
const PASSO_MINIMO_ZOOM = 2.5;   // metros por tique da roda, perto de qualquer coisa
// qualidade de tela = teto do pixel ratio. Numa máquina sem placa de vídeo o
// que pesa é pixel × splat sobreposto: baixar a resolução é o que mais ajuda.
const QUALIDADES_TELA = { alta: 2.5, media: 1.0, baixa: 0.6 };
const FPS_MINIMO = 22;
// layers do three usadas no modo "camadas" (0 fica para luzes e manípulo)
const LAYER_DA_CAMADA = { splat: 1, terreno: 2, desenho: 3, secoes: 4, marcas: 5, macico: 6, grampos: 7 };
// Voar com o teclado: por segundo a câmera anda esta fração da distância ao
// alvo (longe anda rápido, perto anda devagar), nunca menos que o passo mínimo.
const VOO_FRACAO_POR_S = 0.35;
const VOO_CORRIDA = 3;           // com Shift
const TECLAS_VOO = {
  w: "frente", s: "tras", a: "esquerda", d: "direita", q: "baixo", e: "cima",
  arrowup: "frente", arrowdown: "tras", arrowleft: "esquerda",
  arrowright: "direita", pageup: "cima", pagedown: "baixo",
};

export class Cena {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false,
      preserveDrawingBuffer: true,   // para poder fotografar a cena (miniatura)
    });
    // resolução nativa do monitor (limite 2,5 só para não estourar em 4K a 300 %)
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2.5));
    this.renderer.setClearColor(0x0f1115);

    this.cena = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 40000);
    this.camera.up.set(0, 0, 1);            // Z para cima, como na topografia
    this.camera.position.set(80, -120, 70);

    this.controles = new OrbitControls(this.camera, canvas);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.08;
    this.controles.screenSpacePanning = true;
    this.controles.zoomToCursor = true;      // o zoom vai para onde o mouse aponta
    this.controles.minDistance = 0.02;
    this.controles.maxDistance = Infinity;
    // Zoom "infinito": o OrbitControls anda uma fração da distância até o
    // alvo a cada tique, então perto do alvo ele freia. Quando a câmera chega
    // perto, empurramos o alvo para a frente e o passo volta a ter tamanho.
    canvas.addEventListener("wheel", (e) => this._mirarZoom(e), { passive: true });
    // WASD/setas voam pela cena (Q/E descem e sobem, Shift corre); câmera e
    // alvo andam juntos, então girar depois continua em volta do que se vê
    this.teclas = new Set();
    this.correndo = false;
    this._ultimoQuadro = performance.now();
    document.addEventListener("keydown", (e) => this._tecla(e, true));
    document.addEventListener("keyup", (e) => this._tecla(e, false));
    window.addEventListener("blur", () => this.teclas.clear());

    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.cena.add(this.spark);

    this.grupoDesenho = new THREE.Group();
    this.grupoMarcas = new THREE.Group();
    this.cena.add(this.grupoDesenho, this.grupoMarcas);

    this.splat = null;
    this.splatsExtras = [];      // partes extras (site partido em pedaços)
    // profundidade da imagem (medir): grade sob pedido, ver prepararProfundidade
    this._prof = null;           // {chave, resultado, partes} da grade pronta
    this._tarefaProf = null;     // montagem em curso
    this._modProf = null;        // profundidade.js (import dinâmico)
    this._versaoSplat = 0;       // sobe quando os grãos mudam sem recarregar a malha
    // opção escondida (localStorage "splatgeo-limite-imagem" = "0.5"): para em 50 %
    this.limiteImagem = 0.3;
    try {
      if (localStorage.getItem("splatgeo-limite-imagem") === "0.5") this.limiteImagem = 0.5;
    } catch { /* navegador sem localStorage: fica o padrão */ }
    this.terreno = null;
    this.linhas = null;
    this.pontos = null;
    this.rotulos = [];
    this.rotulosFixos = [];      // nomes das seções (não somem com as marcas)
    this.grupoSecoes = null;
    this.ordemCamadas = null;    // null = profundidade real; senão, de baixo para cima
    this.raio = new THREE.Raycaster();
    this.raio.layers.enableAll();     // o modo camadas espalha os objetos em layers
    this.raio.params.Line = { threshold: 0.6 };
    this.raio.params.Points = { threshold: 0.8 };

    this.camadaRotulos = document.createElement("div");
    this.camadaRotulos.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    canvas.parentElement.appendChild(this.camadaRotulos);

    new ResizeObserver(() => this.redimensionar()).observe(canvas.parentElement);
    this.redimensionar();
    this.animar();
  }

  redimensionar() {
    const l = this.canvas.parentElement.clientWidth;
    const a = this.canvas.parentElement.clientHeight;
    this.renderer.setSize(l, a, false);
    this.camera.aspect = l / Math.max(1, a);
    this.camera.updateProjectionMatrix();
  }

  animar = () => {
    requestAnimationFrame(this.animar);
    this._medirDesempenho(performance.now());
    this._voar();
    this.controles.update();
    this._ajustarNear();
    this._acompanharAlca();
    this._render();
    this.atualizarRotulos();
  };

  /** O plano "near" acompanha a distância ao alvo. Com near fixo em 2 cm, a
   *  200 m a profundidade só distingue ~12 cm: o chão do splat e o terreno,
   *  que ficam a centímetros um do outro, brigam pixel a pixel e a imagem
   *  "pisca" quando a câmera anda. near = distância/600 dá ~1 cm a 200 m. */
  _ajustarNear() {
    const d = this.camera.position.distanceTo(this.controles.target);
    const near = Math.min(4, Math.max(0.02, d / 600));
    if (Math.abs(near - this.camera.near) > 0.1 * this.camera.near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /** "auto" (baixa a resolução sozinho se o quadro cair), "alta", "media"
   *  ou "baixa". O modo auto só desce, nunca sobe (para não oscilar). */
  definirQualidade(nivel) {
    this.qualidade = nivel;
    this._aplicarQualidade(nivel === "auto" ? "alta" : nivel);
    this._quadros = 0;
    this._t0fps = null;
  }

  _aplicarQualidade(nivel) {
    this.qualidadeAtual = nivel;
    const teto = QUALIDADES_TELA[nivel] ?? 2.5;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, teto));
    this.redimensionar();
  }

  _medirDesempenho(agora) {
    if (this.qualidade !== "auto" || !this.splat) return;
    this._quadros = (this._quadros || 0) + 1;
    if (!this._t0fps) { this._t0fps = agora; return; }
    if (agora - this._t0fps < 2500) return;
    const fps = (this._quadros * 1000) / (agora - this._t0fps);
    this._quadros = 0;
    this._t0fps = agora;
    const ordem = ["alta", "media", "baixa"];
    const i = ordem.indexOf(this.qualidadeAtual);
    if (fps < FPS_MINIMO && i >= 0 && i < ordem.length - 1) {
      this._aplicarQualidade(ordem[i + 1]);
      if (this.aoMudarQualidade) this.aoMudarQualidade(ordem[i + 1], fps);
    }
  }

  /** Ordem das camadas: null = 3D real (a profundidade decide); senão uma
   *  lista de "macico", "terreno", "splat", "desenho", "secoes" de BAIXO para CIMA. */
  definirOrdemCamadas(ordem) {
    this.ordemCamadas = ordem && ordem.length ? [...ordem] : null;
    if (!this.ordemCamadas) this._espalharLayers(true);   // tudo de volta à 0
  }

  _objetosPorCamada() {
    return {
      splat: [this.spark, this.splat, ...this.splatsExtras],
      terreno: [this.terreno],
      desenho: [this.grupoDesenho],
      secoes: [this.grupoSecoes],
      // os grampos andam com as seções, mas têm layer própria: com o maciço acima das
      // seções eles são pintados logo depois dele (ver _render)
      grampos: [this.grupoGrampos],
      marcas: [this.grupoMarcas],
      // sem camada própria o maciço ficava na layer 0, que entra em TODOS os passes:
      // era redesenhado depois de cada limpeza de profundidade e saía por cima de tudo
      macico: [this.grupoMacico],
    };
  }

  /** Cada camada na sua layer (ou todas na 0, para voltar ao normal).
   *  O manípulo e as luzes ficam na 0: aparecem em todos os passes. */
  _espalharLayers(zerar = false) {
    for (const [nome, objetos] of Object.entries(this._objetosPorCamada())) {
      for (const o of objetos) {
        if (!o) continue;
        o.traverse((x) => x.layers.set(zerar ? 0 : LAYER_DA_CAMADA[nome]));
      }
    }
    if (zerar) this.camera.layers.set(0);
  }

  _render() {
    if (!this.ordemCamadas) {
      this.renderer.render(this.cena, this.camera);
      return;
    }
    // Camada por camada, limpando a profundidade entre uma e outra: dentro
    // da camada a profundidade vale, entre camadas manda a ordem escolhida.
    // A câmera só enxerga a layer do passe — nada de ligar e desligar o
    // splat, que faz o Spark perder a ordenação e o splat piscar.
    this._espalharLayers();
    this.renderer.autoClear = false;
    this.renderer.clear();
    // lista antiga (sem o maciço): ele vai por baixo de tudo, em vez de sumir
    let ordem = this.ordemCamadas.includes("macico") ? this.ordemCamadas : ["macico", ...this.ordemCamadas];
    // raio X no modo camadas: o maciço é pintado por último (só as marcas ficam acima)
    if (this.grupoMacico && this._macicoAjuste?.raioX) ordem = [...ordem.filter((c) => c !== "macico"), "macico"];
    // Grampos por cima do maciço (pedido de 23/09: "no máximo não dê pra ver nada dentro
    // dele, somente os grampos"): se o maciço vem acima das seções, os grampos saem da
    // passada das seções e são pintados logo depois do maciço — o resto continua embaixo.
    const iM = ordem.indexOf("macico"), iS = Math.max(0, ordem.indexOf("secoes"));
    const gramposDepoisDoMacico = !!(this.grupoGrampos && this.grupoMacico?.visible && iM > iS);
    const passadas = [];
    if (!ordem.includes("secoes") && !gramposDepoisDoMacico) passadas.push(["grampos"]);
    for (const nome of ordem) {
      passadas.push(nome === "secoes" && !gramposDepoisDoMacico ? ["secoes", "grampos"] : [nome]);
      if (nome === "macico" && gramposDepoisDoMacico) passadas.push(["grampos"]);
    }
    passadas.push(["marcas"]);                    // marcas por cima
    for (const camadas of passadas) {
      this.camera.layers.set(0);
      for (const nome of camadas) this.camera.layers.enable(LAYER_DA_CAMADA[nome]);
      this.renderer.clearDepth();
      this.renderer.render(this.cena, this.camera);
    }
    this.camera.layers.set(0);
    this.renderer.autoClear = true;
  }

  /** O alvo do zoom vai para o que está debaixo do ponteiro.
   *  O passo de cada tique é 5 % da distância ao alvo, então o alvo tem de
   *  ser a coisa que você quer alcançar: o chão (terreno, mesmo escondido) ou
   *  o desenho sob o cursor — 2 ms de conta. O splat fica de fora (160 ms por
   *  teste); quando nada é atingido, vale o piso de 3 m. */
  /** Zoom livre: o OrbitControls anda 5 % da distância ao alvo por tique
   *  (rápido de longe) e freia perto. Aqui completamos o passo até um mínimo
   *  fixo em metros, movendo câmera E alvo juntos na direção do ponteiro —
   *  o pivô de rotação não muda e o zoom nunca desacelera. */
  _mirarZoom(e) {
    if (!e.deltaY) return;
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const aproximando = e.deltaY < 0;
    // o OrbitControls já aplicou o tique dele (chama update() no evento):
    // ao aproximar, o raio virou 95 % do que era; ao afastar, 1/0,95
    const tiques = Math.abs(e.deltaY) / 100;
    const escala = Math.pow(0.95, this.controles.zoomSpeed * tiques);
    const d = this.camera.position.distanceTo(this.controles.target);
    const andou = aproximando ? d * (1 / escala - 1) : d * (1 - escala);
    const minimo = PASSO_MINIMO_ZOOM * tiques;
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1);
    const direcao = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(this.camera)
      .sub(this.camera.position).normalize();
    if (andou < minimo) {                    // completa o passo, sem freio
      const desloc = direcao.clone()
        .multiplyScalar((minimo - andou) * (aproximando ? 1 : -1));
      this.camera.position.add(desloc);
      this.controles.target.add(desloc);
    }
    // o pivô de rotação nunca fica colado na câmera (senão girar vira
    // "olhar em volta" e o zoom para fora do OrbitControls morre)
    if (this.camera.position.distanceTo(this.controles.target) < 1.5) {
      this.controles.target.copy(this.camera.position)
        .addScaledVector(direcao, 1.5);
    }
    if (this.camera.near > 0.02) {           // de perto, não cortar a cena
      this.camera.near = 0.02;
      this.camera.updateProjectionMatrix();
    }
  }

  _tecla(e, apertou) {
    this.correndo = e.shiftKey;
    const acao = TECLAS_VOO[String(e.key).toLowerCase()];
    if (!acao) return;
    if (!apertou) { this.teclas.delete(acao); return; }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const alvo = e.target;
    if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" ||
        alvo.tagName === "SELECT" || alvo.isContentEditable)) return;
    this.teclas.add(acao);
    if (e.key.startsWith("Arrow") || e.key.startsWith("Page")) e.preventDefault();
  }

  _voar() {
    const agora = performance.now();
    const dt = Math.min(0.1, (agora - this._ultimoQuadro) / 1000);
    this._ultimoQuadro = agora;
    if (!this.teclas.size || !this.controles.enabled) return;
    const d = this.camera.position.distanceTo(this.controles.target);
    const passo = Math.max(PASSO_MINIMO_ZOOM, d * VOO_FRACAO_POR_S) * dt *
      (this.correndo ? VOO_CORRIDA : 1);
    const frente = this.camera.getWorldDirection(new THREE.Vector3());
    const direita = new THREE.Vector3()
      .setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const cima = this.camera.up.clone().normalize();
    const desloc = new THREE.Vector3();
    if (this.teclas.has("frente")) desloc.add(frente);
    if (this.teclas.has("tras")) desloc.sub(frente);
    if (this.teclas.has("direita")) desloc.add(direita);
    if (this.teclas.has("esquerda")) desloc.sub(direita);
    if (this.teclas.has("cima")) desloc.add(cima);
    if (this.teclas.has("baixo")) desloc.sub(cima);
    if (desloc.lengthSq() === 0) return;
    desloc.normalize().multiplyScalar(passo);
    this.camera.position.add(desloc);
    this.controles.target.add(desloc);
  }

  // ------------------------------------------------------------------ splat

  /** `fonte` = endereço do arquivo, ou {bytes, tipo} quando a página já tem o arquivo
   *  na mão (site com login: o arquivo chega cifrado e é aberto no navegador). */
  _opcoesDoSplat(fonte) {
    const comum = { raycastable: true, minRaycastOpacity: 0.3, extSplats: true };
    return typeof fonte === "string" ? { url: fonte, ...comum }
      : { fileBytes: fonte.bytes, fileType: fonte.tipo, ...comum };
  }

  /** `aoProgredir(f)` (opcional): fração 0–1 do arquivo já lido, ou null se o
   *  tamanho não é conhecido. Sem ele, igual a antes. */
  async carregarSplat(url, aoProgredir = null) {
    this.removerSplat();
    // extSplats: posição em float32 (32 B/splat). O formato compacto do Spark
    // guarda o centro em float16 — a 5 unidades da origem o passo é ~0,004 un,
    // do tamanho do próprio splat, e a textura fina vira borrão.
    const malha = new SplatMesh({
      ...this._opcoesDoSplat(url),
      ...(aoProgredir ? { onProgress: (e) => {
        try { aoProgredir(e.total ? Math.min(1, e.loaded / e.total) : null); } catch (_) { /* nada */ }
      } } : {}),
    });
    malha.frustumCulled = false;
    this.cena.add(malha);
    await malha.initialized;
    this.splat = malha;
    // a transparência escolhida vale também para o splat que chega depois
    // (obra reaberta, splat recarregado depois de limpar ou do laço)
    if (this.opacidadeSplat != null) malha.opacity = this.opacidadeSplat;
    this._t0fps = null;                     // mede o desempenho com o splat na tela
    this._quadros = 0;
    // a caixa percorre todos os splats (~250 ms em 2,6 milhões): calcula uma
    // vez e reaproveita — o zoom e o enquadramento a consultam a cada tique
    const caixa = malha.getBoundingBox(true).clone();
    this._caixaLocalSplat = caixa;
    return {
      min: caixa.min.toArray(),
      max: caixa.max.toArray(),
      tamanho: caixa.getSize(new THREE.Vector3()).toArray(),
    };
  }

  removerSplat() {
    this.esquecerProfundidade();
    for (const m of this.splatsExtras) {
      this.cena.remove(m);
      m.dispose?.();
    }
    this.splatsExtras = [];
    if (!this.splat) return;
    this.cena.remove(this.splat);
    this.splat.dispose?.();
    this.splat = null;
    this._caixaLocalSplat = null;
  }

  /** Todas as malhas de splat (a principal e as partes extras). */
  todosSplats() {
    return this.splat ? [this.splat, ...this.splatsExtras] : [];
  }

  /** Carrega um splat que veio em várias partes (site do GitHub): a primeira
   *  vira `this.splat`, as outras acompanham em tudo (posição, opacidade,
   *  visibilidade, clique). */
  async carregarSplats(urls) {
    const caixa = await this.carregarSplat(urls[0]);
    for (const url of urls.slice(1)) {
      const malha = new SplatMesh(this._opcoesDoSplat(url));
      malha.frustumCulled = false;
      this.cena.add(malha);
      await malha.initialized;
      this.splatsExtras.push(malha);
      const c = malha.getBoundingBox(true).clone();
      this._caixaLocalSplat.union(c);
    }
    this.esquecerProfundidade();      // a grade tem de levar todas as partes
    return caixa;
  }

  /** Coloca o splat no lugar: X_cena = escala·R·x_splat + (t − origem). */
  /** Matriz que leva um ponto do arquivo do splat até a tela (-1..1), do
   *  jeito que está sendo visto agora: projeção x câmera x posição do splat.
   *  É o que o laço manda para o servidor decidir quem está dentro. */
  /** Onde o raio que sai da câmera por (x, y) da tela (-1..1) encontra o
   *  terreno; onde não há terreno, o plano horizontal na altura da origem.
   *  Devolve [x, y, z] da cena, ou null se o raio não desce. */
  chaoEmNDC(x, y) {
    this.camera.updateMatrixWorld(true);
    this.raio.setFromCamera(new THREE.Vector2(x, y), this.camera);
    if (this.terreno) {
      const a = this.raio.intersectObject(this.terreno, false);
      if (a.length) return a[0].point.toArray();
    }
    const r = this.raio.ray;
    if (Math.abs(r.direction.z) < 1e-6) return null;
    const t = -r.origin.z / r.direction.z;
    if (t <= 0) return null;
    return [r.origin.x + t * r.direction.x, r.origin.y + t * r.direction.y, 0];
  }

  matrizDoLaco() {
    if (!this.splat) return null;
    this.camera.updateMatrixWorld(true);
    this.splat.updateMatrixWorld(true);
    const m = new THREE.Matrix4()
      .multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
      .multiply(this.splat.matrixWorld);
    return Array.from(m.elements);
  }

  aplicarTransformacao(t, origem) {
    if (!this.splat) return;
    if (!t) {
      this.splat.position.set(0, 0, 0);
      this.splat.quaternion.identity();
      this.splat.scale.setScalar(1);
      return;
    }
    const q = t.quaternion;   // vem como w, x, y, z
    this.splat.quaternion.set(q[1], q[2], q[3], q[0]);
    this.splat.scale.setScalar(t.escala);
    this.splat.position.set(
      t.translacao[0] - origem[0],
      t.translacao[1] - origem[1],
      t.translacao[2] - origem[2],
    );
    this.splat.updateMatrixWorld(true);
    for (const m of this.splatsExtras) {
      m.quaternion.copy(this.splat.quaternion);
      m.scale.copy(this.splat.scale);
      m.position.copy(this.splat.position);
      m.updateMatrixWorld(true);
    }
  }

  /** Converte um ponto da cena para o sistema original do splat. */
  paraSistemaSplat(pontoCena) {
    if (!this.splat) return null;
    return this.splat.worldToLocal(pontoCena.clone()).toArray();
  }

  // ---------------------------------------------------------------- terreno

  definirTerreno({ vertices, indices, uv }, texturaUrl) {
    this.removerTerreno();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    if (uv) geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    let material;
    if (texturaUrl) {
      const textura = new THREE.TextureLoader().load(texturaUrl, () => {
        this.renderer.render(this.cena, this.camera);
      });
      textura.colorSpace = THREE.SRGBColorSpace;
      textura.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      textura.wrapS = textura.wrapT = THREE.ClampToEdgeWrapping;
      material = new THREE.MeshBasicMaterial({ map: textura });
    } else {
      material = new THREE.MeshLambertMaterial({ color: 0x5a6472,
        side: THREE.DoubleSide, flatShading: false });
      if (!this.luz) {
        this.luz = new THREE.DirectionalLight(0xffffff, 2.0);
        this.luz.position.set(-0.4, -0.6, 1);
        this.cena.add(this.luz, new THREE.AmbientLight(0xffffff, 0.7));
      }
    }
    // no empate de profundidade o terreno cede: o chão do splat aparece
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 2;
    this.terreno = new THREE.Mesh(geo, material);
    this.terreno.renderOrder = -1;
    this.cena.add(this.terreno);
    this.definirOpacidadeTerreno(this.opacidadeTerreno ?? 1);
    if (this.malhaTerrenoLigada) this.mostrarMalhaTerreno(true);
    if (texturaUrl && this.deslocImagem) {
      this.definirDeslocamentoImagem(...this.deslocImagem);
    }
  }

  /** Desloca a imagem de satélite em metros (E, N) sobre o terreno — a
   *  imagem tem erro de posição de metros, a topografia é a referência.
   *  Só a textura anda (offset UV); terreno, cotas e medidas ficam. */
  definirDeslocamentoImagem(dE, dN, metros) {
    if (metros) this.metrosImagem = metros;
    this.deslocImagem = [Number(dE) || 0, Number(dN) || 0];
    const map = this.terreno?.material?.map;
    if (!map || !this.metrosImagem) return;
    const [W, H] = this.metrosImagem;
    // mover a imagem para leste = ler a textura mais a oeste
    map.offset.set(-this.deslocImagem[0] / W, -this.deslocImagem[1] / H);
    map.needsUpdate = true;
  }

  /** Transparência do terreno (0 a 1): para ver o splat por baixo dele. */
  definirOpacidadeTerreno(v) {
    this.opacidadeTerreno = Math.min(1, Math.max(0, Number(v)));
    if (!this.terreno) return;
    const m = this.terreno.material;
    m.transparent = this.opacidadeTerreno < 1;
    m.opacity = this.opacidadeTerreno;
    m.needsUpdate = true;
  }

  /** Arestas do TIN por cima do terreno (para achar o vértice errado). */
  mostrarMalhaTerreno(ligado) {
    this.malhaTerrenoLigada = !!ligado;
    if (this.malhaTerreno) {
      this.cena.remove(this.malhaTerreno);
      this.malhaTerreno.geometry.dispose();
      this.malhaTerreno.material.dispose();
      this.malhaTerreno = null;
    }
    if (!ligado || !this.terreno) return;
    this.malhaTerreno = new THREE.LineSegments(
      new THREE.WireframeGeometry(this.terreno.geometry),
      new THREE.LineBasicMaterial({ color: 0x9be7ff, depthTest: false,
        transparent: true, opacity: 0.55 }));
    this.malhaTerreno.renderOrder = 90;
    this.cena.add(this.malhaTerreno);
  }

  removerTerreno() {
    if (this.malhaTerreno) this.mostrarMalhaTerreno(false);
    if (!this.terreno) return;
    this.cena.remove(this.terreno);
    this.terreno.geometry.dispose();
    this.terreno.material.map?.dispose();
    this.terreno.material.dispose();
    this.terreno = null;
  }

  /** Curvas e pontos do topógrafo sempre visíveis, mesmo dentro do splat. */
  definirDesenhoPorCima(ligado) {
    this.desenhoPorCima = !!ligado;
    const secoes = this.grupoSecoes ? this.grupoSecoes.children : [];
    for (const obj of [...this._objetosDeLinha(), this.pontos, ...secoes]) {
      if (!obj) continue;
      obj.material.depthTest = !ligado;
      // na lista "transparente" o three desenha depois dos splats, e o
      // renderOrder alto garante que seja o último a pintar
      obj.material.transparent = !!ligado;
      obj.material.needsUpdate = true;
      obj.renderOrder = ligado ? 100 : 0;
    }
  }

  /** As linhas do desenho como lista: uma por categoria, ou a única antiga. */
  _objetosDeLinha() {
    if (!this.linhas) return [];
    return this.linhas.isGroup ? this.linhas.children : [this.linhas];
  }

  /** Liga ou desliga uma categoria de linhas (curvas, drenagem, edificações…). */
  mostrarCategoria(id, sim) {
    for (const c of this.categoriasDesenho || []) if (c.id === id) c.objeto.visible = !!sim;
  }

  /** `categorias` (opcional): [{id, cor, ligada, xyz}] — uma malha de linhas por
   *  categoria, cada uma com a sua cor; `this.linhas` vira o grupo de todas
   *  (a caixinha geral das linhas continua mandando em tudo). */
  definirDesenho(linhas, pontos, categorias = null) {
    this.grupoDesenho.clear();
    this.linhas = this.pontos = null;
    this.categoriasDesenho = [];
    if (categorias && categorias.length) {
      this.linhas = new THREE.Group();
      for (const c of categorias) {
        if (!c.xyz?.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(c.xyz, 3));
        const obj = new THREE.LineSegments(geo,
          new THREE.LineBasicMaterial({ color: c.cor ?? COR_LINHA }));
        obj.userData.categoria = c.id;
        obj.visible = c.ligada !== false;
        this.linhas.add(obj);
        this.categoriasDesenho.push({ id: c.id, objeto: obj });
      }
      this.grupoDesenho.add(this.linhas);
    } else if (linhas && linhas.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(linhas, 3));
      this.linhas = new THREE.LineSegments(geo,
        new THREE.LineBasicMaterial({ color: COR_LINHA }));
      this.grupoDesenho.add(this.linhas);
    }
    if (pontos && pontos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pontos, 3));
      this.pontos = new THREE.Points(geo, new THREE.PointsMaterial({
        color: COR_PONTO, size: 4, sizeAttenuation: false,
      }));
      this.grupoDesenho.add(this.pontos);
    }
    if (this.desenhoPorCima) this.definirDesenhoPorCima(true);
  }

  // ----------------------------------------------------------------- seções

  /** Seções do projeto de pé no lugar delas: um LineSegments por grupo
   *  (terreno, projeto, tirante, drenagem) e o nome de cada uma no alto. */
  definirSecoes(secoes) {
    this.removerSecoes();
    if (!secoes || !secoes.linhas) return;
    this.grupoSecoes = new THREE.Group();
    for (const [grupo, dados] of Object.entries(secoes.linhas)) {
      if (!dados.xyz?.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(dados.xyz, 3));
      const linhas = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: COR_SECAO[grupo] || COR_SECAO.projeto }));
      linhas.userData.grupo = grupo;
      this.grupoSecoes.add(linhas);
    }
    this.cena.add(this.grupoSecoes);
    for (const r of secoes.rotulos || []) {
      const div = document.createElement("div");
      div.className = "rotulo3d secao";
      div.textContent = r.texto;
      this.camadaRotulos.appendChild(div);
      this.rotulosFixos.push({ div, posicao: new THREE.Vector3(r.x, r.y, r.z) });
    }
    if (this.desenhoPorCima) this.definirDesenhoPorCima(true);
  }

  /** Elementos de contenção do projeto. Grampos: cabeças sempre à vista (a face
   *  de projeto corre uns 0,5 m por dentro do terreno e o splat as esconderia),
   *  uma cor por comprimento como na prancha (12 m azul, 8 m vermelho) e VERDE
   *  quando já executado; o corpo para dentro do maciço liga à parte. Tirantes:
   *  quadrado magenta, trecho livre claro e trecho ancorado magenta. Barbacãs:
   *  pontinhos azul-claros. Cada tipo guarda as posições na ordem da tabela
   *  (G-001…, T-01…, B-001…) para a medição escolher por clique ou laço. */
  definirGrampos(grampos) {
    this.removerGrampos();
    if (!grampos?.tipos?.length && !grampos?.tirantes && !grampos?.barbacas) return;
    const CORES = [0x4f8dff, 0xff5c5c, 0x51c06a, 0xffb454, 0xc77dff];
    this.grupoGrampos = new THREE.Group();
    this.grupoGrampos.userData.corpos = [];
    this.elementos = {};
    const pontos = (posicoes, coresBase, tamanho, ordem, forma) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(posicoes, 3));
      g.setAttribute("color", new THREE.BufferAttribute(coresBase.slice(), 3));
      const o = new THREE.Points(g, new THREE.PointsMaterial({
        size: tamanho, sizeAttenuation: false, depthTest: false, vertexColors: true,
        map: this._formaDePonto(forma), alphaTest: 0.5 }));
      o.renderOrder = ordem;
      this.grupoGrampos.add(o);
      return o;
    };
    const segmentos = (tipo, a, b, cor, opacidade) => {
      const seg = new Float32Array(a.length * 2);
      for (let k = 0; k < a.length / 3; k++) {
        seg.set(a.subarray(3 * k, 3 * k + 3), 6 * k);
        seg.set(b.subarray(3 * k, 3 * k + 3), 6 * k + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(seg, 3));
      const o = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        color: cor, transparent: true, opacity: opacidade, depthTest: false }));
      o.renderOrder = 19;
      o.visible = false;
      o.userData.tipo = tipo;
      this.grupoGrampos.add(o);
      this.grupoGrampos.userData.corpos.push(o);
      return o;
    };
    const tipos = grampos.tipos || [];
    const total = tipos.reduce((n, t) => n + t.cabecas.length / 3, 0);
    if (total) {
      // todas as cabeças num objeto só, na ordem da tabela (o site antigo não
      // manda `indices`: aí vale a ordem em que os tipos chegam)
      const pos = new Float32Array(total * 3), base = new Float32Array(total * 3);
      const c = new THREE.Color();
      let corrido = 0;
      tipos.forEach((t, i) => {
        c.setHex(CORES[i % CORES.length]);
        for (let k = 0; k < t.cabecas.length / 3; k++) {
          const g = t.indices ? t.indices[k] : corrido + k;
          pos.set(t.cabecas.subarray(3 * k, 3 * k + 3), 3 * g);
          base.set([c.r, c.g, c.b], 3 * g);
        }
        corrido += t.cabecas.length / 3;
        segmentos("grampo", t.cabecas, t.pontas, CORES[i % CORES.length], 0.6);
      });
      this.elementos.grampo = { obj: pontos(pos, base, 9, 20, "bola"), base, n: total };
    }
    const ti = grampos.tirantes;
    if (ti?.n) {
      const base = new Float32Array(ti.n * 3);
      for (let k = 0; k < ti.n; k++) base.set([1.0, 0.31, 0.86], 3 * k);
      this.elementos.tirante = { obj: pontos(ti.cabecas, base, 15, 21, "quadrado"), base, n: ti.n };
      segmentos("tirante", ti.cabecas, ti.livre, 0xffffff, 0.55);
      segmentos("tirante", ti.livre, ti.pontas, 0xff50dc, 0.9);
    }
    const ba = grampos.barbacas;
    if (ba?.n) {
      const base = new Float32Array(ba.n * 3);
      for (let k = 0; k < ba.n; k++) base.set([0.35, 0.86, 1.0], 3 * k);
      this.elementos.barbaca = { obj: pontos(ba.posicoes, base, 5, 18, "bola"), base, n: ba.n };
    }
    for (const tipo of Object.keys(this.elementos)) {
      this.elementos[tipo].obj.visible = this._verContencao?.[tipo] !== false;
    }
    this.cena.add(this.grupoGrampos);
    if (this.ordemCamadas) this._espalharLayers();
    if (this._executados) this.marcarExecutados(this._executados);
  }

  /** Pinta de verde o que já foi executado. `feitos` = { grampo: Set de
   *  índices (0 = G-001), tirante: Set, barbaca: Set }. */
  marcarExecutados(feitos) {
    this._executados = feitos;
    for (const [tipo, el] of Object.entries(this.elementos || {})) {
      const cor = el.obj.geometry.attributes.color;
      cor.array.set(el.base);
      for (const i of feitos?.[tipo] || []) {
        if (i < el.n) cor.array.set([0.24, 0.9, 0.43], 3 * i);
      }
      cor.needsUpdate = true;
    }
  }

  /** Forma da cabeça no 3D, igual à da prancha: grampo e barbacã = bolinha,
   *  tirante = quadrado com borda escura. Branco: a cor vem do vértice. */
  _formaDePonto(forma) {
    this._formas = this._formas || {};
    if (this._formas[forma]) return this._formas[forma];
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    if (forma === "quadrado") {
      g.fillStyle = "#000"; g.fillRect(4, 4, 56, 56);
      g.fillStyle = "#fff"; g.fillRect(13, 13, 38, 38);
    } else {
      g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this._formas[forma] = t;
    return t;
  }

  /** Liga ou desliga um tipo — "grampo", "tirante" ou "barbaca" — com o corpo dele. */
  mostrarTipoDeContencao(tipo, sim) {
    this._verContencao = { ...(this._verContencao || {}), [tipo]: !!sim };
    if (this.elementos?.[tipo]) this.elementos[tipo].obj.visible = !!sim;
    this.mostrarCorpoDosGrampos(this._verCorpos);
  }

  /** Mostra ou esconde o corpo dos grampos e tirantes (o comprimento dentro do
   *  maciço); só aparece o corpo do tipo que está ligado. */
  mostrarCorpoDosGrampos(sim) {
    this._verCorpos = !!sim;
    for (const o of this.grupoGrampos?.userData.corpos || []) {
      o.visible = !!sim && this._verContencao?.[o.userData.tipo] !== false;
    }
  }

  mostrarBarbacas(sim) { this.mostrarTipoDeContencao("barbaca", sim); }

  _elementoNaTela(tipo, i, v) {
    const p = this.elementos[tipo].obj.geometry.attributes.position;
    v.set(p.getX(i), p.getY(i), p.getZ(i)).project(this.camera);
    return v.z <= 1;
  }

  /** Elemento mais próximo do cursor na tela: { tipo, indice } ou null. */
  elementoSobCursor(evento, tipos = ["grampo", "tirante"], tolerancia = 12) {
    if (!this.elementos || !this.grupoGrampos?.visible) return null;
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    let melhor = null, menor = tolerancia;
    for (const tipo of tipos) {
      const el = this.elementos[tipo];
      if (!el || !el.obj.visible) continue;
      for (let i = 0; i < el.n; i++) {
        if (!this._elementoNaTela(tipo, i, v)) continue;
        const d = Math.hypot((v.x * 0.5 + 0.5) * r.width - (evento.clientX - r.left),
          (-v.y * 0.5 + 0.5) * r.height - (evento.clientY - r.top));
        if (d < menor) { menor = d; melhor = { tipo, indice: i }; }
      }
    }
    return melhor;
  }

  /** Elementos dentro de um contorno desenhado na tela (pontos em NDC, -1..1). */
  elementosNoContorno(contorno, tipos = ["grampo", "tirante"]) {
    const saida = [];
    if (!this.elementos || contorno.length < 3) return saida;
    const dentro = (x, y) => {
      let sim = false;
      for (let i = 0, j = contorno.length - 1; i < contorno.length; j = i++) {
        const [xi, yi] = contorno[i], [xj, yj] = contorno[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) sim = !sim;
      }
      return sim;
    };
    const v = new THREE.Vector3();
    for (const tipo of tipos) {
      const el = this.elementos[tipo];
      if (!el || !el.obj.visible) continue;
      for (let i = 0; i < el.n; i++) {
        if (this._elementoNaTela(tipo, i, v) && dentro(v.x, v.y)) saida.push({ tipo, indice: i });
      }
    }
    return saida;
  }

  removerGrampos() {
    this.elementos = {};
    if (!this.grupoGrampos) return;
    this.cena.remove(this.grupoGrampos);
    for (const o of this.grupoGrampos.children) { o.geometry.dispose(); o.material.dispose(); }
    this.grupoGrampos = null;
  }

  /** Prévia da seleção do passo 2: os centros dos splats marcados, em vermelho,
   *  por cima de tudo. As posições estão no sistema do ARQUIVO do splat: o
   *  objeto copia a matriz do splat a cada quadro e acompanha qualquer ajuste. */
  definirPreviaDeSelecao(xyz) {
    if (this._previaSelecao) {
      this.cena.remove(this._previaSelecao);
      this._previaSelecao.geometry.dispose();
      this._previaSelecao.material.dispose();
      this._previaSelecao = null;
    }
    if (!xyz || !xyz.length || !this.splat) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(xyz, 3));
    const o = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xff3030, size: 3, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.9 }));
    o.renderOrder = 30;
    o.frustumCulled = false;
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = false;
    o.onBeforeRender = () => { if (this.splat) o.matrixWorld.copy(this.splat.matrixWorld); };
    this._previaSelecao = o;
    this.cena.add(o);
  }

  /** Linhas soltas das ferramentas de contenção, por nome: "eixo" (polilinha),
   *  "secoes" (pares de pontos), "avulsos" (pontos). `null` apaga. */
  definirLinhaDeContencao(nome, xyz, { cor = 0xffd24a, pares = false, pontos = false, tamanho = 9 } = {}) {
    this._contencao = this._contencao || {};
    const velho = this._contencao[nome];
    if (velho) {
      this.cena.remove(velho);
      velho.geometry.dispose();
      velho.material.dispose();
      delete this._contencao[nome];
    }
    if (!xyz || xyz.length < 3) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(xyz), 3));
    const o = pontos
      ? new THREE.Points(g, new THREE.PointsMaterial({ color: cor, size: tamanho, sizeAttenuation: false, depthTest: false }))
      : new (pares ? THREE.LineSegments : THREE.Line)(g, new THREE.LineBasicMaterial({ color: cor, depthTest: false }));
    o.renderOrder = 22;
    this._contencao[nome] = o;
    this.cena.add(o);
  }

  /** Maciço simulado pelas sondagens: um sólido por unidade de solo (cor por
   *  vértice, desbotada longe dos furos) e os furos como colunas coloridas com o
   *  nome. `null` apaga. Em "raio X" aparece através do splat e do terreno. */
  definirMacico(dados) {
    if (this._alvoDoGizmo === "macico") this.desativarGizmo();
    if (this.grupoMacico) {
      this.cena.remove(this.grupoMacico);
      this.grupoMacico.traverse((o) => {
        o.geometry?.dispose();
        o.material?.map?.dispose();
        o.material?.dispose();
      });
      this.grupoMacico = null;
    }
    if (!dados) return;
    const de64 = (txt, Tipo) => {
      const bin = atob(txt), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Tipo(bytes.buffer);
    };
    const grupo = new THREE.Group();
    for (const sol of dados.solidos || []) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(de64(sol.xyz_b64, Float32Array), 3));
      g.setAttribute("color", new THREE.BufferAttribute(de64(sol.cor_b64, Float32Array), 3));
      g.setIndex(new THREE.BufferAttribute(de64(sol.tri_b64, Uint32Array), 1));
      // o topo do maciço É o terreno: sem empurrar um pouco para trás os dois disputam o mesmo pixel e a tela pisca
      const malha = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true,
        polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }));
      malha.userData.unidade = sol.unidade;
      grupo.add(malha);
    }
    for (const f of dados.furos3d || []) {
      for (const t of f.coluna) {
        const cil = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, t.ate - t.de, 14),
          new THREE.MeshBasicMaterial({ color: t.cor, transparent: true }));
        cil.rotation.x = Math.PI / 2;                      // o cilindro nasce ao longo de Y; a cota aqui é Z
        cil.position.set(f.boca[0], f.boca[1], f.boca[2] - (t.de + t.ate) / 2);
        cil.userData.furo = true;
        grupo.add(cil);
        const aro = new THREE.LineSegments(new THREE.EdgesGeometry(cil.geometry, 40), new THREE.LineBasicMaterial({ color: 0x111111, transparent: true }));
        aro.rotation.copy(cil.rotation);
        aro.position.copy(cil.position);
        aro.userData.furo = true;
        grupo.add(aro);
      }
      const tela = document.createElement("canvas");
      tela.width = 256; tela.height = 64;
      const c2 = tela.getContext("2d");
      c2.font = "bold 40px sans-serif"; c2.textAlign = "center"; c2.textBaseline = "middle";
      c2.lineWidth = 8; c2.strokeStyle = "#000"; c2.strokeText(f.nome, 128, 32);
      c2.fillStyle = "#fff"; c2.fillText(f.nome, 128, 32);
      const rotulo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tela), depthTest: false, transparent: true }));
      rotulo.scale.set(6, 1.5, 1);
      rotulo.position.set(f.boca[0], f.boca[1], f.boca[2] + 1.6);
      rotulo.renderOrder = 24;
      grupo.add(rotulo);
    }
    // raio X: antes do primeiro sólido a profundidade da tela é zerada; daí em diante o
    // maciço se desenha POR CIMA do splat e do terreno, mas uma camada continua tampando
    // a outra do jeito certo (sem isso as cinco se misturam numa mancha só)
    const limpador = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position",
      new THREE.BufferAttribute(new Float32Array(9), 3)), new THREE.MeshBasicMaterial({ transparent: true, colorWrite: false, depthWrite: false, depthTest: false }));
    limpador.frustumCulled = false;
    limpador.userData.limpador = true;
    limpador.onBeforeRender = (renderer) => { if (this._macicoAjuste?.raioX) renderer.clearDepth(); };
    grupo.add(limpador);
    this.grupoMacico = grupo;
    this.cena.add(grupo);
    this.moverMacico(this._macicoDesloc);
    this.ajustarMacico({});
  }

  /** {ver, raioX, opacidade, transparenteSemRaioX}: o que não vier fica como estava.
   *  Sem raio X o maciço fica embaixo da terra, tampado pelo terreno e pelo splat, e só
   *  aparece quando se baixa a opacidade deles. O splat (Spark) vai na lista transparente
   *  e não grava profundidade: um maciço transparente com a mesma prioridade podia sair
   *  por cima dele (queixa de 21/09). Por isso, sem raio X, o maciço transparente ganha
   *  renderOrder -2: é pintado ANTES do terreno (-1) e do splat (0), grava a profundidade
   *  (uma camada tampa a outra) e os dois se pintam por cima dele. A opacidade vale nos
   *  dois modos (23/09: sem isso a barra "sumia" com o raio X desligado). O site publicado
   *  passa transparenteSemRaioX: false e fica sólido como ele aprovou. */
  ajustarMacico(ajuste) {
    const a = this._macicoAjuste = { ver: true, raioX: false, opacidade: 0.6, transparenteSemRaioX: true,
      ...(this._macicoAjuste || {}), ...ajuste };
    if (!this.grupoMacico) return;
    this.grupoMacico.visible = a.ver;
    const vidroSemRaioX = !a.raioX && a.transparenteSemRaioX && a.opacidade < 0.999;
    this.grupoMacico.traverse((o) => {
      if (!o.material || o.isSprite) return;
      if (o.userData.limpador) { o.renderOrder = 14; o.visible = a.raioX; return; }
      const furo = !!o.userData.furo;
      o.material.transparent = a.raioX || (vidroSemRaioX && !furo);
      o.material.depthTest = !(a.raioX && furo);      // no raio X o furo aparece sempre, mesmo dentro do sólido
      o.material.depthWrite = !(a.raioX && furo);
      o.material.opacity = furo ? 1 : a.raioX || vidroSemRaioX ? a.opacidade : 1;
      o.renderOrder = a.raioX ? (furo ? 21 : 15) : vidroSemRaioX && !furo ? -2 : 0;
      o.material.needsUpdate = true;
    });
    for (const o of this.grupoMacico.children) if (o.isSprite) o.material.depthTest = false;
  }

  /** Desloca o maciço inteiro (sólidos e furos), em metros: [leste, norte, cota]. */
  moverMacico(desloc) {
    this._macicoDesloc = (desloc || [0, 0, 0]).map((v) => Number(v) || 0);
    if (this.grupoMacico) this.grupoMacico.position.set(...this._macicoDesloc);
  }

  removerSecoes() {
    if (this.grupoSecoes) {
      this.cena.remove(this.grupoSecoes);
      for (const o of this.grupoSecoes.children) {
        o.geometry.dispose();
        o.material.dispose();
      }
      this.grupoSecoes = null;
    }
    this.rotulosFixos.forEach((r) => r.div.remove());
    this.rotulosFixos = [];
  }

  // --------------------------------------------------------------- marcações

  marcar(id, posicao, texto, cor = COR_MEDIDA) {
    // a esfera é a mesma para todos os marcadores (a escala vem da tela); o
    // material é de cada um (muda de cor ao arrastar) e limparMarcas o libera
    if (!this._geoMarcador) this._geoMarcador = new THREE.SphereGeometry(1, 12, 10);
    const esfera = new THREE.Mesh(this._geoMarcador,
      new THREE.MeshBasicMaterial({ color: cor, depthTest: false }));
    esfera.position.copy(posicao);
    esfera.renderOrder = 10;
    esfera.userData.id = id;
    esfera.userData.escalaTela = true;
    esfera.userData.descartarMaterial = true;
    this.grupoMarcas.add(esfera);
    if (texto) this.rotular(posicao, texto, cor === COR_MEDIDA);
    return esfera;
  }

  /** Marcador mais próximo do cursor na tela (até `tolerancia` px). Com `prefixo`,
   *  só os marcadores cujo id começa com ele (a medida usa "m"). */
  marcaSobCursor(evento, tolerancia = 14, prefixo = null) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    let melhor = null, menor = tolerancia;
    for (const m of this.grupoMarcas.children) {
      if (!m.isMesh || !m.userData.id) continue;
      if (prefixo && !String(m.userData.id).startsWith(prefixo)) continue;
      v.copy(m.position).project(this.camera);
      if (v.z > 1) continue;
      const dx = (v.x * 0.5 + 0.5) * r.width - (evento.clientX - r.left);
      const dy = (-v.y * 0.5 + 0.5) * r.height - (evento.clientY - r.top);
      const d = Math.hypot(dx, dy);
      if (d < menor) { menor = d; melhor = m; }
    }
    return melhor;
  }

  /** Ponto do raio do cursor num plano paralelo à tela que passa por `p`. */
  pontoNoPlanoDaTela(evento, p) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((evento.clientX - r.left) / r.width) * 2 - 1,
      -((evento.clientY - r.top) / r.height) * 2 + 1);
    this.raio.setFromCamera(ndc, this.camera);
    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    const plano = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p);
    const saida = new THREE.Vector3();
    return this.raio.ray.intersectPlane(plano, saida) ? saida : null;
  }

  desenharLinhaMedida(pontos, fechar = false, cor = COR_MEDIDA) {
    if (pontos.length < 2) return null;
    const p = fechar ? [...pontos, pontos[0]] : pontos;
    const geo = new THREE.BufferGeometry().setFromPoints(p);
    const linha = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: cor, depthTest: false, linewidth: 2 }));
    linha.renderOrder = 9;
    linha.userData.descartar = true;           // geometria própria: limparMarcas libera
    this.grupoMarcas.add(linha);
    return linha;
  }

  /** Linha tracejada (medida "horizontal": do nível do 1º ponto até cada ponto real).
   *  Some com limparMarcas, como a linha da medida. */
  linhaTracejada(pontos, cor = COR_MEDIDA) {
    if (!pontos || pontos.length < 2) return null;
    const geo = new THREE.BufferGeometry().setFromPoints(pontos);
    const linha = new THREE.Line(geo, new THREE.LineDashedMaterial({
      color: cor, dashSize: 0.10, gapSize: 0.08, depthTest: false }));
    linha.computeLineDistances();
    linha.renderOrder = 9;
    linha.userData.descartar = true;           // geometria própria: limparMarcas libera
    this.grupoMarcas.add(linha);
    return linha;
  }

  /** Rótulo pequeno e discreto (nome das outras medidas com "ver todas"). Não é
   *  marcador: não entra em marcaSobCursor; some com limparMarcas. */
  rotuloPequeno(pontoCena, texto, cor = 0x7f8a9a) {
    const div = this.rotular(this._v3(pontoCena), texto);
    div.style.fontSize = "10px";
    div.style.padding = "0 4px";
    div.style.opacity = "0.85";
    div.style.color = "#" + new THREE.Color(cor).getHexString();
    return div;
  }

  rotular(posicao, texto, medida = false) {
    const div = document.createElement("div");
    div.className = "rotulo3d" + (medida ? " medida" : "");
    div.textContent = texto;
    this.camadaRotulos.appendChild(div);
    this.rotulos.push({ div, posicao: posicao.clone() });
    return div;
  }

  /** Seta de `de` até `para` (Vector3 da cena), com a ponta de tamanho fixo na
   *  tela e, se vier `texto`, um rótulo no meio. Fica em grupoMarcas (some com
   *  limparMarcas, vai na camada "marcas") e sem userData.id: não dá para
   *  arrastar. Não depende de nada de fora: o site publicado recebe este arquivo. */
  seta(de, para, cor = 0xffd24a, texto = "") {
    const material = () => new THREE.MeshBasicMaterial({ color: cor, depthTest: false, transparent: true });
    const haste = new THREE.Line(new THREE.BufferGeometry().setFromPoints([de, para]),
      new THREE.LineBasicMaterial({ color: cor, depthTest: false, transparent: true }));
    haste.renderOrder = 11;
    haste.userData.descartar = true;           // geometria própria: limparMarcas libera
    this.grupoMarcas.add(haste);
    const direcao = new THREE.Vector3().subVectors(para, de);
    if (direcao.lengthSq() > 1e-12) {
      // cone de altura 3,2 com a PONTA na origem (a esfera do marcador tem raio 1)
      if (!this._geoPontaSeta) {
        this._geoPontaSeta = new THREE.ConeGeometry(0.9, 3.2, 10).translate(0, -1.6, 0);
      }
      const ponta = new THREE.Mesh(this._geoPontaSeta, material());
      ponta.position.copy(para);
      ponta.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direcao.normalize());
      ponta.renderOrder = 11;
      ponta.userData.escalaTela = true;
      ponta.userData.descartarMaterial = true;   // a geometria é compartilhada: fica
      this.grupoMarcas.add(ponta);
    }
    if (texto) this.rotular(de.clone().lerp(para, 0.5), texto).classList.add("seta");
    return haste;
  }

  /** Pinta uma grade em planta como pontos quadrados semitransparentes, um por
   *  célula: `pontos` = [x,y,z, …] da cena, `cores` = [r,g,b(,a), …] de 0 a 1 por
   *  ponto, `tamanho` = lado do quadrado em metros. Uma grade só por vez (a nova
   *  troca a velha); `null` apaga. Fica em grupoMarcas, por cima de tudo. */
  pintarGrade(pontos, cores, tamanho = 2, opacidade = 0.35) {
    if (this._gradePintada) {
      this.grupoMarcas.remove(this._gradePintada);
      this._gradePintada.geometry.dispose();
      this._gradePintada.material.dispose();
      this._gradePintada = null;
    }
    if (!pontos || pontos.length < 3) return null;
    const n = Math.floor(pontos.length / 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(
      pontos instanceof Float32Array ? pontos : new Float32Array(pontos), 3));
    const porPonto = cores ? cores.length / n : 0;
    const comCor = porPonto === 3 || porPonto === 4;
    if (comCor) {
      g.setAttribute("color", new THREE.BufferAttribute(
        cores instanceof Float32Array ? cores : new Float32Array(cores), porPonto));
    }
    // com sizeAttenuation o three faz lado na tela = size × (meia altura da tela) /
    // profundidade; dividir o lado em metros pela tangente de meio campo de visão
    // dá o mesmo tamanho na tela que um quadrado de `tamanho` metros ali
    const meio = Math.tan(THREE.MathUtils.degToRad((this.camera.fov || 55) / 2));
    const o = new THREE.Points(g, new THREE.PointsMaterial({
      size: tamanho / meio, sizeAttenuation: true, vertexColors: comCor,
      color: comCor ? 0xffffff : 0x57c98a, transparent: true, opacity: opacidade,
      depthTest: false, depthWrite: false }));
    o.renderOrder = 8;                         // embaixo das esferas e das setas
    o.frustumCulled = false;
    this._gradePintada = o;
    this.grupoMarcas.add(o);
    return o;
  }

  limparMarcas() {
    // libera da placa de vídeo o que foi criado para cada marca: geometria
    // própria (hastes das setas, linhas) e o material; a geometria
    // compartilhada (esfera dos marcadores, ponta das setas) fica
    for (const m of this.grupoMarcas.children) {
      if (m.userData.descartar) {
        m.geometry?.dispose();
        m.material?.dispose();
      } else if (m.userData.descartarMaterial) {
        m.material?.dispose();
      }
    }
    this.grupoMarcas.clear();
    this.rotulos.forEach((r) => r.div.remove());
    this.rotulos = [];
  }

  atualizarRotulos() {
    if (!this.rotulos.length && !this.rotulosFixos.length &&
        !this.grupoMarcas.children.length) return;
    const l = this.canvas.clientWidth;
    const a = this.canvas.clientHeight;
    const v = new THREE.Vector3();
    const secoesVisiveis = !!this.grupoSecoes?.visible;
    for (const { div, posicao } of [...this.rotulos, ...this.rotulosFixos]) {
      v.copy(posicao).project(this.camera);
      const visivel = v.z < 1 && (div.classList.contains("secao")
        ? secoesVisiveis : true);
      div.style.display = visivel ? "block" : "none";
      if (visivel) {
        div.style.left = `${(v.x * 0.5 + 0.5) * l}px`;
        div.style.top = `${(-v.y * 0.5 + 0.5) * a}px`;
      }
    }
    // esferas com tamanho constante na tela (~4 px)
    for (const m of this.grupoMarcas.children) {
      if (!m.userData.escalaTela) continue;
      const d = this.camera.position.distanceTo(m.position);
      m.scale.setScalar(Math.max(0.05, d * 0.006));
    }
  }

  // ---------------------------------------------------------------- escolher

  /** Devolve o ponto sob o cursor: primeiro o splat, depois terreno/desenho. */
  apontar(evento, opcoes = {}) {
    const r = this.canvas.getBoundingClientRect();
    const ponteiro = new THREE.Vector2(
      ((evento.clientX - r.left) / r.width) * 2 - 1,
      -((evento.clientY - r.top) / r.height) * 2 + 1);
    // tolerância conforme o zoom: de longe, um ponto cotado tem meio pixel
    const olhando = this.camera.position.distanceTo(this.controles.target);
    this.raio.params.Points = { threshold: Math.max(0.25, olhando * 0.005) };
    this.raio.params.Line = { threshold: Math.max(0.2, olhando * 0.004) };
    this.raio.setFromCamera(ponteiro, this.camera);
    // `apenas`: "splat" ou "topografia" — na marcação de pontos cada lado
    // só enxerga a própria camada, senão um clique no splat pega o terreno
    // que está logo atrás (ou na frente) dele.
    const querSplat = opcoes.apenas ? opcoes.apenas === "splat"
      : opcoes.splat !== false;
    const querTopo = opcoes.apenas ? opcoes.apenas === "topografia" : true;
    const alvos = [];
    if (querSplat && this.splat && this.splat.visible) {
      alvos.push(this.splat, ...this.splatsExtras.filter((m) => m.visible));
    }
    if (querTopo) {
      if (this.terreno && this.terreno.visible) alvos.push(this.terreno);
      if (this.pontos && this.pontos.visible) alvos.push(this.pontos);
      if (this.linhas && this.linhas.visible) {
        alvos.push(...this._objetosDeLinha().filter((o) => o.visible));
      }
    }
    if (!alvos.length) return null;
    const acertos = this.raio.intersectObjects(alvos, false);
    if (!acertos.length) return null;
    let a = acertos[0];
    // marcar na topografia: gruda no ponto cotado, que é a coordenada exata
    if (opcoes.preferirPonto) {
      const noPonto = acertos.find((h) => h.object === this.pontos);
      if (noPonto) a = noPonto;
    }
    const tipo = (a.object === this.splat || this.splatsExtras.includes(a.object)) ? "splat"
      : a.object === this.terreno ? "terreno"
        : a.object === this.pontos ? "ponto" : "linha";
    // clique em ponto do desenho: devolve o vértice exato, não o raio
    let ponto = a.point.clone();
    if (tipo === "ponto" && a.index !== undefined) {
      const p = this.pontos.geometry.attributes.position;
      ponto.set(p.getX(a.index), p.getY(a.index), p.getZ(a.index));
    }
    return { tipo, ponto, distancia: a.distance,
      splatLocal: this.splat ? this.paraSistemaSplat(ponto) : null };
  }

  // ------------------------------------------- profundidade da imagem (medir)
  // O clique da MEDIÇÃO para onde a imagem do modelo fica cheia (30 % de opacidade
  // acumulada no raio), e não no primeiro grão que o Spark acha — que às vezes é um
  // grão solto na frente, às vezes já é o lado de trás. A conta está em
  // profundidade.js, que entra SÓ por import dinâmico: um site com este cena.js e
  // sem o profundidade.js ao lado continua abrindo (o clique fica "simples").
  // A grade dos grãos é montada uma vez por splat, na primeira medida, e guardada
  // com uma CHAVE (arrays do Spark de cada parte, quantidade de grãos e
  // _versaoSplat); a chave é conferida a cada clique e, se mudou, a grade é remontada.
  // Toda função que muda, esconde ou apaga grãos SEM recarregar a malha tem de fazer
  // this._versaoSplat++. Hoje nenhuma faz isso: laço, limpeza, seleção, voos e
  // restauração recarregam o splat, e carregarSplat/carregarSplats/removerSplat
  // passam por esquecerProfundidade. Posição, giro e escala do splat não entram na
  // chave: a matriz de cada parte é lida de novo em cada clique.

  _chaveProf() {
    const malhas = this.todosSplats();
    return {
      refs: malhas.map((m) => m.extSplats?.extArrays?.[0] ?? null),
      ns: malhas.map((m) => m.extSplats?.numSplats ?? 0),
      versao: this._versaoSplat,
    };
  }

  _mesmaChaveProf(a, b) {
    if (!a || !b || a.versao !== b.versao || a.refs.length !== b.refs.length) return false;
    return a.refs.every((r, i) => r === b.refs[i] && a.ns[i] === b.ns[i]);
  }

  /** Esquece a grade (splat trocado ou removido). Uma montagem em curso é descartada
   *  quando termina, porque a chave dela deixa de valer. */
  esquecerProfundidade() {
    this._versaoSplat++;
    this._prof = null;
    this._tarefaProf = null;
  }

  /** Monta (uma vez por chave) a grade dos grãos de todas as partes do splat, em
   *  fatias, com teto de memória (60 MB no celular, 160 MB no PC) e prazo de 4 s.
   *  Devolve a MESMA promessa para quem pedir com a mesma chave; `progresso(fração)`
   *  alimenta a dica "preparando o clique fino no modelo… X %".
   *  -> {ok, motivo, ms, bytes, splats}; sem splat {ok:false, motivo:"sem splat"}. */
  prepararProfundidade({ progresso = null } = {}) {
    if (!this.splat) return Promise.resolve({ ok: false, motivo: "sem splat" });
    const chave = this._chaveProf();
    if (this._prof && this._mesmaChaveProf(this._prof.chave, chave)) {
      return Promise.resolve(this._prof.resultado);
    }
    this._prof = null;             // chave velha: solta a grade antes de montar outra
    const emCurso = this._tarefaProf;
    if (emCurso && this._mesmaChaveProf(emCurso.chave, chave)) {
      if (progresso) emCurso.ouvintes.push(progresso);
      return emCurso.promessa;
    }
    const tarefa = { chave, ouvintes: progresso ? [progresso] : [], promessa: null };
    this._tarefaProf = tarefa;
    tarefa.promessa = this._montarProf(tarefa)
      .catch((e) => ({ resultado: { ok: false, motivo: "erro ao preparar: " + (e?.message || e) } }))
      .then(({ resultado, partes = null }) => {
        // só guarda se ninguém trocou o splat enquanto montava
        if (this._tarefaProf === tarefa && this._mesmaChaveProf(chave, this._chaveProf())) {
          // cancelada pelo prazo: não fica guardada (o próximo clique tenta de novo),
          // a não ser na 2ª vez seguida com o mesmo splat (aparelho lento de verdade)
          const prazo = !!resultado?.prazo;
          const vezes = prazo && this._prazoProf && this._mesmaChaveProf(this._prazoProf.chave, chave)
            ? this._prazoProf.vezes + 1 : 1;
          this._prazoProf = prazo ? { chave, vezes } : null;
          if (!prazo || vezes >= 2) this._prof = { chave, resultado, partes };
          this._tarefaProf = null;
        }
        return resultado;
      });
    return tarefa.promessa;
  }

  async _montarProf(tarefa) {
    const avisar = (f) => {
      for (const o of tarefa.ouvintes) { try { o(f); } catch { /* a dica não para a montagem */ } }
    };
    if (!this._modProf) this._modProf = await import("./profundidade.js?v=88bd0fc404").catch(() => null);
    const P = this._modProf;
    if (!P) return { resultado: { ok: false, motivo: "módulo da profundidade não carregou" } };
    const malhas = this.todosSplats();
    if (!malhas.length) return { resultado: { ok: false, motivo: "sem splat" } };
    // guarda: os grãos são lidos direto da memória do Spark, num formato interno dele;
    // se o meu leitor não bater com o do Spark, a profundidade fica desligada até
    // recarregar o splat (e o clique volta ao do Spark)
    for (const m of malhas) {
      const c = P.conferirDecodificador(m, 64);
      if (!c.ok) {
        console.warn("Splat Geo: profundidade da imagem desligada —", c.motivo);
        return { resultado: { ok: false, motivo: c.motivo } };
      }
    }
    let movel = false;
    try {
      const sp = await import("@sparkjsdev/spark");
      movel = typeof sp.isMobile === "function" && !!sp.isMobile();
    } catch { /* sem o Spark aqui: conta como PC */ }
    // o prazo de 4 s é do TRABALHO da montagem: o download do módulo (no site vem
    // pela rede), a conferência e as pausas da página (aba escondida, troca de app
    // no celular) não contam — cada parte recebe o que sobrou do trabalho
    const t0 = performance.now();
    const PRAZO_MS = 4000;
    const teto = P.tetoDeMemoria(movel);
    const total = malhas.reduce((s, m) => s + (m.extSplats?.numSplats || 0), 0) || 1;
    const partes = [];
    let bytes = 0, feitos = 0, trabalho = 0;
    for (const malha of malhas) {
      const fonte = P.fonteDeSplatMesh(malha);
      if (!fonte) return { resultado: { ok: false, motivo: "não consegui ler os grãos do splat" } };
      const G = await P.construirGrade(fonte, {
        tetoBytes: teto - bytes,
        prazoMs: Math.max(1, PRAZO_MS - trabalho),
        progresso: (f) => avisar(Math.min(1, (feitos + f * fonte.n) / total)),
      });
      if (G?.cancelada && G.prazo) {
        return { resultado: { ok: false, prazo: true, motivo: `a preparação passou de ${PRAZO_MS / 1000} s` } };
      }
      if (!G || G.cancelada) return { resultado: { ok: false, motivo: G?.motivo || "a grade não foi montada" } };
      trabalho += G.trabalho_ms ?? G.ms ?? 0;
      partes.push({ G, malha });
      bytes += G.bytes;
      feitos += fonte.n;
    }
    return {
      resultado: { ok: true, motivo: null, ms: Math.round(performance.now() - t0), bytes, splats: feitos },
      partes,
    };
  }

  /** Grades prontas para um raio do MUNDO: cada parte com a inversa da SUA matriz de
   *  agora. null se a grade não está pronta ou se a chave mudou. */
  _gradesProf() {
    const p = this._prof;
    if (!p || !p.partes || !this._modProf || !this._mesmaChaveProf(p.chave, this._chaveProf())) return null;
    const grades = [];
    for (const { G, malha } of p.partes) {
      malha.updateMatrixWorld(true);
      const M_inv = this._modProf.inverterAfim(malha.matrixWorld.elements);
      if (M_inv) grades.push({ G, M_inv });
    }
    return grades.length ? grades : null;
  }

  _v3(v) {
    return v?.isVector3 ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]);
  }

  /** Raio (unitário, mundo) que sai da câmera `cam` pelo ponto (clientX, clientY) da tela. */
  _raioDoPixel(x, y, cam = this.camera, r = this.canvas.getBoundingClientRect()) {
    const rc = this._raioMedida || (this._raioMedida = new THREE.Raycaster());
    rc.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1,
      -((y - r.top) / r.height) * 2 + 1), cam);
    return { o: rc.ray.origin.clone(), d: rc.ray.direction.clone().normalize() };
  }

  /** Profundidade da imagem ao longo de um raio da cena (todas as partes do splat
   *  numa composição só). t em metros (a direção é normalizada aqui).
   *  -> {p30, p50, p70: Vector3|null, t30, t50, t70, opacidade, n, n30} | null (sem grade). */
  profundidadeNoRaio(origem, direcao, { limites, faixa } = {}) {
    const grades = this._gradesProf();
    if (!grades) return null;
    const o = this._v3(origem), d = this._v3(direcao);
    if (!(d.lengthSq() > 0)) return null;
    d.normalize();
    const r = this._modProf.profundidade(grades, o.toArray(), d.toArray(), { limites, faixa });
    const em = (t) => (t == null ? null : o.clone().addScaledVector(d, t));
    return { ...r, p30: em(r.t30), p50: em(r.t50), p70: em(r.t70) };
  }

  /** O clique da MEDIÇÃO. prender "splat" (modelo do drone): feixe de 3x3 raios
   *  (±1,5 px) na profundidade da imagem, com o ângulo da superfície por um feixe 5x5
   *  (raio rasante, abaixo de 35°, usa 50 %); sem grade, ou se nenhum raio parou, cai
   *  no clique do Spark ("splat-bruto", sem qualidade). prender "desenho" (desenho do
   *  topógrafo): só a topografia, grudando no ponto cotado.
   *  -> {de_onde, ponto (cena), sigma_m, espessura_m, qualidade, limite, aviso,
   *      opacidade, normal (virada para a câmera), raio:{o, d}, splat_xyz, cota,
   *      indice, motivo, angulo, grade:{ok, motivo}, transparente}.
   *  Sem ponto: ponto null e motivo "sem splat" | "splat escondido" | "nada acertado".
   *  Com grade desligada o motivo dela vem em `motivo` (dica do "clique simples"). */
  async apontarMedida(evento, { prender = "splat" } = {}) {
    // a câmera do instante do clique (a grade pode levar um tempo na 1ª vez)
    this.camera.updateMatrixWorld(true);
    const cam = this.camera.clone();
    const rect = this.canvas.getBoundingClientRect();
    const cx = evento.clientX, cy = evento.clientY;
    const { o, d } = this._raioDoPixel(cx, cy, cam, rect);
    const saida = {
      de_onde: null, ponto: null, sigma_m: null, espessura_m: null, qualidade: null, limite: null,
      aviso: null, opacidade: null, normal: null, raio: { o, d }, splat_xyz: null, cota: null,
      indice: null, motivo: null, angulo: null, grade: null, transparente: false,
    };
    if (prender === "desenho") {
      const h = this.apontar(evento, { apenas: "topografia", preferirPonto: true });
      if (!h) return { ...saida, motivo: "nada acertado" };
      if (h.tipo === "ponto") {
        return { ...saida, de_onde: "ponto cotado", ponto: h.ponto, cota: h.ponto.z,
          indice: this._indiceDoPontoCotado(h.ponto) };
      }
      return { ...saida, de_onde: h.tipo === "terreno" ? "terreno" : "curva", ponto: h.ponto,
        aviso: "levantamento antigo" };
    }
    if (!this.splat) return { ...saida, motivo: "sem splat" };
    if (!this.splat.visible) return { ...saida, motivo: "splat escondido" };
    let pr = await this.prepararProfundidade();
    // o splat trocou enquanto a grade montava: mais uma vez, com o splat novo
    if (pr.ok && !this._gradesProf()) pr = await this.prepararProfundidade();
    const grades = pr.ok ? this._gradesProf() : null;
    saida.grade = { ok: !!grades, motivo: grades ? null : pr.motivo || "a grade não está pronta" };
    saida.transparente = (this.splat.opacity ?? 1) < 0.5;
    if (grades) {
      const P = this._modProf;
      const arr = (v) => [v.x, v.y, v.z];
      const raioPx = (dx, dy) => this._raioDoPixel(cx + dx, cy + dy, cam, rect);
      let central = null, plano = null;
      const amostrar = (dx, dy) => {
        const r = raioPx(dx, dy);
        const a = P.profundidade(grades, arr(r.o), arr(r.d));
        if (dx === 0 && dy === 0) central = a;
        return a;
      };
      // ângulo com a superfície: plano dos p30 de um feixe 5x5 com passo fixo NO ALVO
      // (em px de tela pela distância T30), cada raio só perto de T30
      const angulo = (T30) => {
        const frente = cam.getWorldDirection(new THREE.Vector3());
        const prof = T30 * Math.max(0.05, d.dot(frente));
        const mPorPx = 2 * prof * Math.tan(THREE.MathUtils.degToRad((cam.fov || 55) / 2)) / Math.max(1, rect.height);
        const passo = P.PASSO_PLANO_M / Math.max(1e-9, mPorPx);
        const faixa = [T30 - P.FAIXA_PLANO_M, T30 + P.FAIXA_PLANO_M];
        plano = P.planoDoFeixe((i, j) => {
          const r = raioPx(i * passo, j * passo);
          const a = P.profundidade(grades, arr(r.o), arr(r.d), { faixa });
          return a.t30 == null ? null : [r.o.x + a.t30 * r.d.x, r.o.y + a.t30 * r.d.y, r.o.z + a.t30 * r.d.z];
        }, { lado: 5, minimo: 12 });
        return plano ? P.anguloComPlano(arr(d), plano.normal) : null;
      };
      const r = P.cliqueEmFeixe(amostrar, { limite: this.limiteImagem, angulo });
      if (r.t != null) {
        const ponto = o.clone().addScaledVector(d, r.t);
        const normal = plano ? new THREE.Vector3(...plano.normal) : null;
        if (normal && normal.dot(d) > 0) normal.negate();
        return {
          ...saida, de_onde: "splat", ponto, sigma_m: r.sigma,
          espessura_m: Number.isFinite(r.espessura) ? r.espessura : null,
          qualidade: r.qualidade, limite: r.t_limite, aviso: r.aviso,
          opacidade: central ? central.opacidade : null, normal, angulo: r.angulo,
          splat_xyz: this.paraSistemaSplat(ponto),
        };
      }
    }
    // nenhum raio parou (ou grade desligada): o clique do Spark, com a câmera DO
    // INSTANTE do clique — enquanto a grade montava (1º clique, até uns segundos) a
    // vista pode ter girado, e apontar() usaria a câmera de agora (o ponto cairia
    // longe de onde ele tocou, com o raio guardado da vista antiga)
    this.camera.updateMatrixWorld(true);
    const mesmaVista = this.camera.matrixWorld.equals(cam.matrixWorld)
      && this.camera.projectionMatrix.equals(cam.projectionMatrix);
    const bruto = mesmaVista ? this.apontar(evento, { apenas: "splat" }) : this._apontarSplatCom(cam, rect, cx, cy);
    if (!bruto || bruto.tipo !== "splat") {
      return { ...saida, motivo: grades ? "nada acertado" : saida.grade.motivo };
    }
    return {
      ...saida, de_onde: "splat-bruto", ponto: bruto.ponto, splat_xyz: bruto.splatLocal,
      aviso: grades ? "atravessou" : null, motivo: grades ? null : saida.grade.motivo,
    };
  }

  /** O clique do Spark (só o splat) com uma câmera dada: a do instante do clique,
   *  quando a vista mudou enquanto a grade montava. Mesmo retorno de apontar(). */
  _apontarSplatCom(cam, rect, x, y) {
    if (!this.splat || !this.splat.visible) return null;
    const rc = new THREE.Raycaster();
    rc.layers.enableAll();             // como this.raio: o modo camadas espalha os objetos em layers
    rc.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1), cam);
    const alvos = [this.splat, ...this.splatsExtras.filter((m) => m.visible)];
    const a = rc.intersectObjects(alvos, false)[0];
    if (!a) return null;
    const ponto = a.point.clone();
    return { tipo: "splat", ponto, distancia: a.distance, splatLocal: this.paraSistemaSplat(ponto) };
  }

  /** Índice do ponto cotado do desenho com exatamente estas coordenadas (o vértice
   *  que apontar() devolveu), ou null. */
  _indiceDoPontoCotado(p) {
    const pos = this.pontos?.geometry?.attributes?.position;
    if (!pos) return null;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) === p.x && pos.getY(i) === p.y && pos.getZ(i) === p.z) return i;
    }
    return null;
  }

  /** Plano da superfície do modelo em volta de um ponto da cena: feixe 7x7 de raios
   *  paralelos a `direcao` (ou à da câmera), com passo raio/3, saindo 5 m antes do
   *  ponto; plano robusto dos p30. Com menos de 20 raios bons, plano dos centros dos
   *  grãos a até `raio` ("graos"). Normal virada para quem olha.
   *  -> {normal: Vector3, n, rms, de: "feixe"|"graos"} | null (sem grade ou sem plano). */
  planoLocal(pontoCena, { raio = 0.5, direcao = null } = {}) {
    const grades = this._gradesProf();
    if (!grades) return null;
    const P = this._modProf;
    const p = this._v3(pontoCena);
    const d = direcao ? this._v3(direcao) : this.camera.getWorldDirection(new THREE.Vector3());
    if (!(d.lengthSq() > 0)) return null;
    d.normalize();
    const e1 = new THREE.Vector3().crossVectors(d, Math.abs(d.z) < 0.9
      ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
    const e2 = new THREE.Vector3().crossVectors(d, e1).normalize();
    const passo = raio / 3, recuo = 5;
    const faixa = [recuo - P.FAIXA_PLANO_M, recuo + P.FAIXA_PLANO_M];
    let pl = P.planoDoFeixe((i, j) => {
      const o = p.clone().addScaledVector(e1, i * passo).addScaledVector(e2, j * passo)
        .addScaledVector(d, -recuo);
      const a = P.profundidade(grades, o.toArray(), d.toArray(), { faixa });
      return a.t30 == null ? null : [o.x + a.t30 * d.x, o.y + a.t30 * d.y, o.z + a.t30 * d.z];
    }, { lado: 7, minimo: 20 });
    let de = "feixe";
    if (!pl) {
      pl = P.ajustarPlano(P.vizinhos(grades, p.toArray(), raio));
      de = "graos";
    }
    if (!pl) return null;
    const normal = new THREE.Vector3(...pl.normal);
    if (normal.dot(d) > 0) normal.negate();
    return { normal, n: pl.n, rms: pl.rms, de };
  }

  // ----------------------------------------------------------------- câmera

  enquadrar(caixa) {
    const alvo = caixa || this.caixaTudo();
    if (!alvo || alvo.isEmpty()) return;
    const centro = alvo.getCenter(new THREE.Vector3());
    const raio = Math.max(5, alvo.getBoundingSphere(new THREE.Sphere()).radius);
    this.controles.target.copy(centro);
    this.camera.position.set(centro.x + raio * 0.8, centro.y - raio * 1.2,
      centro.z + raio * 0.9);
    this.camera.near = 0.02;
    this.camera.far = Math.max(1e5, raio * 500);
    this.camera.updateProjectionMatrix();
    this.controles.update();
  }

  vistaDeCima() {
    this.vistaDeCimaDe(this.caixaTudo());
  }

  /** Olha uma caixa de cima, ao longo de `cima` (Z do mundo por padrão).
   *  Com o eixo vertical do próprio splat, o splat aparece "em planta" mesmo
   *  quando ainda está deitado ou de pé no arquivo. */
  vistaDeCimaDe(caixa, cima = new THREE.Vector3(0, 0, 1)) {
    if (!caixa || caixa.isEmpty()) return;
    const centro = caixa.getCenter(new THREE.Vector3());
    const raio = Math.max(5, caixa.getBoundingSphere(new THREE.Sphere()).radius);
    // o "norte" da tela: o Y do mundo projetado no plano da vista (ou Z, se
    // o eixo de cima estiver deitado sobre Y)
    const norte = new THREE.Vector3(0, 1, 0).projectOnPlane(cima);
    if (norte.lengthSq() < 1e-6) norte.set(0, 0, 1).projectOnPlane(cima);
    norte.normalize();
    this.definirCima(cima);
    this.controles.target.copy(centro);
    this.camera.position.copy(centro).addScaledVector(cima, raio * 2.2)
      .addScaledVector(norte, -0.001);
    this.controles.update();
  }

  /** Vista em planta do splat: olha ao longo do eixo vertical do arquivo
   *  (`normalLocal`, achado pelo nivelamento) levado para a cena. */
  vistaDeCimaDoSplat(normalLocal, caixaLocal) {
    if (!this.splat) return;
    this.splat.updateMatrixWorld(true);
    const caixa = caixaLocal?.min
      ? new THREE.Box3(new THREE.Vector3(...caixaLocal.min),
        new THREE.Vector3(...caixaLocal.max)).applyMatrix4(this.splat.matrixWorld)
      : this.caixaSplatNaCena();
    const cima = normalLocal
      ? new THREE.Vector3(...normalLocal).transformDirection(this.splat.matrixWorld)
      : new THREE.Vector3(0, 0, 1);
    // O sinal dessa normal vem de uma estatística (assimetria) que falha em
    // sítio liso: olhar "de baixo" mostra o splat espelhado. Se o splat já
    // está mais ou menos deitado na cena (grudado, assentado, eixo escolhido),
    // o para cima é o do mundo; se ainda está de pé, ao menos não olha de
    // baixo. "Ver do outro lado" resolve o resto.
    if (Math.abs(cima.z) > 0.5) cima.set(0, 0, 1);
    else if (cima.z < -1e-6) cima.negate();
    this._cimaSplat = cima.clone();
    this._caixaSplatPlanta = caixa;
    this.vistaDeCimaDe(caixa, cima);
  }

  /** A vista em planta do splat pelo lado oposto (quando saiu espelhada). */
  virarVistaDoSplat() {
    if (!this._cimaSplat || !this._caixaSplatPlanta) return false;
    this._cimaSplat.negate();
    this.vistaDeCimaDe(this._caixaSplatPlanta, this._cimaSplat);
    return true;
  }

  /** Muda o "para cima" da câmera; o OrbitControls guarda uma cópia dele. */
  definirCima(v) {
    this.camera.up.copy(v).normalize();
    const c = this.controles;
    if (c._quat) {
      c._quat.setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 1, 0));
      c._quatInverse = c._quat.clone().invert();
    }
  }

  /** Guarda a vista atual para voltar depois (restaurarVista). */
  guardarVista() {
    this._vistaGuardada = {
      posicao: this.camera.position.clone(), alvo: this.controles.target.clone(),
      cima: this.camera.up.clone(), near: this.camera.near,
    };
  }

  restaurarVista() {
    const v = this._vistaGuardada;
    if (!v) return false;
    this._vistaGuardada = null;
    this.definirCima(v.cima);
    this.camera.position.copy(v.posicao);
    this.controles.target.copy(v.alvo);
    this.camera.near = v.near;
    this.camera.updateProjectionMatrix();
    this.controles.update();
    return true;
  }

  caixaTudo() {
    // O terreno manda no enquadramento: é comum o DXF ter linhas e textos em
    // Z = 0 (limites, legenda) que esticariam a cena para baixo.
    const caixa = new THREE.Box3();
    if (this.terreno) caixa.union(new THREE.Box3().setFromObject(this.terreno));
    if (caixa.isEmpty() && this.linhas) {
      caixa.union(new THREE.Box3().setFromObject(this.linhas));
    }
    if (caixa.isEmpty() && this.splat) {
      const c = this.caixaSplatNaCena();
      if (c) caixa.union(c);
    }
    return caixa;
  }

  // ------------------------------------------------------- mexer com o mouse

  /** Liga o manípulo no splat: "translate", "rotate" ou "scale". */
  ativarGizmo(modo = "translate") {
    if (!this.splat) return false;
    this._criarGizmo();
    this._largarMacico();
    return this._ligarGizmo(modo, modo);
  }

  /** A mesma alça, em modo mover, mas quem anda é o maciço das sondagens.
   *  `aoMoverMacico([leste, norte, cota])` avisa a cada movimento. */
  ativarAlcaDoMacico() {
    if (!this.grupoMacico) return false;
    this._criarGizmo();
    this._alvoDoGizmo = "macico";
    return this._ligarGizmo("translate", "macico");
  }

  _largarMacico() {
    const era = this._alvoDoGizmo === "macico";
    this._alvoDoGizmo = "splat";
    if (era && this.aoLargarMacico) this.aoLargarMacico();
  }

  _criarGizmo() {
    if (!this.gizmo) {
      this.gizmo = new TransformControls(this.camera, this.canvas);
      this.gizmo.setSpace("world");
      // A alça NÃO fica presa no splat: a origem interna do arquivo pode estar
      // a centenas de metros do modelo (e da vista). Ela fica num ponto
      // auxiliar, posto onde o Lucas está olhando; o que ele faz na alça é
      // repassado ao splat como o mesmo movimento em torno desse ponto.
      this.alca = new THREE.Object3D();
      this.cena.add(this.alca);
      this.gizmo.addEventListener("dragging-changed", (e) => {
        this.controles.enabled = !e.value;      // não gira a câmera junto
        this._arrastandoAlca = e.value;
        if (this._alvoDoGizmo === "macico") {
          this._macicoInicio = e.value && this.grupoMacico
            ? { alca: this.alca.position.clone(), macico: this.grupoMacico.position.clone() } : null;
          return;
        }
        if (e.value) {
          this.alca.updateMatrix();
          this.splat.updateMatrix();
          this._alcaInicioInv = this.alca.matrix.clone().invert();
          this._splatInicio = this.splat.matrix.clone();
          if (this.aoPegarGizmo) this.aoPegarGizmo();
        } else {
          // entre um arrasto e outro a alça volta a "neutra" (só a posição fica)
          this.alca.quaternion.identity();
          this.alca.scale.set(1, 1, 1);
          this._alcaInicioInv = null;
          if (this.aoSoltarGizmo) this.aoSoltarGizmo();
        }
      });
      this.gizmo.addEventListener("objectChange", () => {
        if (this._alvoDoGizmo === "macico") {
          if (!this._macicoInicio || !this.grupoMacico) return;
          const d = this.alca.position.clone().sub(this._macicoInicio.alca).add(this._macicoInicio.macico);
          this.moverMacico([d.x, d.y, d.z].map((v) => Math.round(v * 100) / 100));
          if (this.aoMoverMacico) this.aoMoverMacico(this._macicoDesloc.slice());
          return;
        }
        if (!this.splat || !this._alcaInicioInv) return;
        if (this.gizmo.mode === "scale") {      // escala sempre igual nos 3
          const e = this.alca.scale;
          const media = Math.max(1e-6, (e.x + e.y + e.z) / 3);
          e.set(media, media, media);
        }
        // splat novo = (alça agora) x (alça no início)^-1 x (splat no início)
        this.alca.updateMatrix();
        const m = this.alca.matrix.clone()
          .multiply(this._alcaInicioInv).multiply(this._splatInicio);
        const pos = new THREE.Vector3(), giro = new THREE.Quaternion(), esc = new THREE.Vector3();
        m.decompose(pos, giro, esc);
        const tamanho = (esc.x + esc.y + esc.z) / 3;
        this.splat.position.copy(pos);
        this.splat.quaternion.copy(giro);
        this.splat.scale.set(tamanho, tamanho, tamanho);
        this.splat.updateMatrixWorld(true);
        if (this.aoMexerGizmo) this.aoMexerGizmo();
      });
      this.cena.add(this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo);
    }
  }

  _ligarGizmo(modo, nome) {
    this.gizmo.setMode(modo);
    this.alca.position.copy(this._pontoDaVista());
    this.alca.quaternion.identity();
    this.alca.scale.set(1, 1, 1);
    this.gizmo.attach(this.alca);
    this.gizmo.enabled = true;
    const ajudante = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    ajudante.visible = true;
    this.gizmoModo = nome;
    return true;
  }

  /** O ponto onde a alça deve aparecer: o que está no meio da tela (splat,
   *  senão terreno); sem nada ali, o alvo da câmera se estiver à vista; em
   *  último caso, um ponto à frente da câmera. */
  _pontoDaVista() {
    this.camera.updateMatrixWorld(true);
    this.raio.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const alvos = [];
    if (this.splat && this.splat.visible) alvos.push(this.splat);
    if (this.terreno && this.terreno.visible) alvos.push(this.terreno);
    if (alvos.length) {
      const a = this.raio.intersectObjects(alvos, false);
      if (a.length) return a[0].point.clone();
    }
    const alvo = this.controles.target.clone();
    if (this._naTela(alvo, 0.6)) return alvo;
    const frente = this.camera.getWorldDirection(new THREE.Vector3());
    const d = Math.max(1, this.camera.position.distanceTo(this.controles.target));
    return this.camera.position.clone().addScaledVector(frente, d);
  }

  /** O ponto aparece na tela, com folga (1 = a borda)? */
  _naTela(ponto, folga = 0.92) {
    const v = ponto.clone().project(this.camera);
    return v.z > -1 && v.z < 1 && Math.abs(v.x) < folga && Math.abs(v.y) < folga;
  }

  /** A cada quadro: se a alça está ligada e saiu da tela porque a câmera
   *  andou, ela volta para o meio da vista — mas só quando a câmera parou
   *  (procurar o ponto custa ~0,2 s num splat grande) e nunca no meio de um
   *  arrasto. */
  _acompanharAlca() {
    if (!this.gizmoModo || !this.alca || this._arrastandoAlca) return;
    // "parada" com tolerância: o amortecimento do OrbitControls refaz a posição
    // a cada quadro e ela treme ~1e-13 m mesmo sem ninguém mexer
    const pos = this.camera.position, giro = this.camera.quaternion;
    if (!this._camPosAnt) { this._camPosAnt = pos.clone(); this._camGiroAnt = giro.clone(); }
    const folga = 1e-6 * Math.max(1, pos.distanceTo(this.controles.target));
    const parada = pos.distanceTo(this._camPosAnt) < folga
      && 1 - Math.abs(giro.dot(this._camGiroAnt)) < 1e-12;
    this._camPosAnt.copy(pos);
    this._camGiroAnt.copy(giro);
    this._quadrosParada = parada ? (this._quadrosParada || 0) + 1 : 0;
    if (this._quadrosParada < 8 || this._naTela(this.alca.position)) return;
    this.alca.position.copy(this._pontoDaVista());
  }

  desativarGizmo() {
    if (!this.gizmo) return;
    this.gizmo.detach();
    this.gizmo.enabled = false;
    const ajudante = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    ajudante.visible = false;
    this.controles.enabled = true;
    this.gizmoModo = null;
    this._arrastandoAlca = false;
    this._alcaInicioInv = null;
    this._macicoInicio = null;
    this._largarMacico();
  }

  /** Lê do splat a transformação que o mouse deixou (escala, giro, posição). */
  transformacaoDoSplat(origem) {
    if (!this.splat) return null;
    const m = new THREE.Matrix4().makeRotationFromQuaternion(this.splat.quaternion);
    const e = m.elements;                       // three guarda por coluna
    return {
      escala: this.splat.scale.x,
      rotacao: [[e[0], e[4], e[8]], [e[1], e[5], e[9]], [e[2], e[6], e[10]]],
      quaternion: [this.splat.quaternion.w, this.splat.quaternion.x,
        this.splat.quaternion.y, this.splat.quaternion.z],
      translacao: [this.splat.position.x + origem[0],
        this.splat.position.y + origem[1],
        this.splat.position.z + origem[2]],
    };
  }

  /** Foto da vista atual (JPEG em base64) para o cartão da obra no painel. */
  miniatura(largura = 640) {
    if (!this.canvas.width || !this.canvas.height) this.redimensionar();
    if (!this.canvas.width || !this.canvas.height) return null;  // janela oculta
    this._render();
    const escala = Math.min(1, largura / this.canvas.width);
    const alvo = document.createElement("canvas");
    alvo.width = Math.round(this.canvas.width * escala);
    alvo.height = Math.round(this.canvas.height * escala);
    const ctx = alvo.getContext("2d");
    ctx.drawImage(this.canvas, 0, 0, alvo.width, alvo.height);
    return alvo.toDataURL("image/jpeg", 0.82);
  }

  caixaSplatNaCena() {
    if (!this.splat) return null;
    this.splat.updateMatrixWorld(true);
    if (!this._caixaLocalSplat) {
      this._caixaLocalSplat = this.splat.getBoundingBox(true).clone();
    }
    return this._caixaLocalSplat.clone().applyMatrix4(this.splat.matrixWorld);
  }
}
