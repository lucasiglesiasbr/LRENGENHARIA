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
const LAYER_DA_CAMADA = { splat: 1, terreno: 2, desenho: 3, secoes: 4, marcas: 5 };
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
   *  lista de "splat", "terreno", "desenho", "secoes" de BAIXO para CIMA. */
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
      marcas: [this.grupoMarcas],
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
    for (const nome of [...this.ordemCamadas, "marcas"]) {   // marcas por cima
      this.camera.layers.set(0);
      this.camera.layers.enable(LAYER_DA_CAMADA[nome]);
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

  async carregarSplat(url) {
    this.removerSplat();
    // extSplats: posição em float32 (32 B/splat). O formato compacto do Spark
    // guarda o centro em float16 — a 5 unidades da origem o passo é ~0,004 un,
    // do tamanho do próprio splat, e a textura fina vira borrão.
    const malha = new SplatMesh({
      url, raycastable: true, minRaycastOpacity: 0.3, extSplats: true,
    });
    malha.frustumCulled = false;
    this.cena.add(malha);
    await malha.initialized;
    this.splat = malha;
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
      const malha = new SplatMesh({
        url, raycastable: true, minRaycastOpacity: 0.3, extSplats: true,
      });
      malha.frustumCulled = false;
      this.cena.add(malha);
      await malha.initialized;
      this.splatsExtras.push(malha);
      const c = malha.getBoundingBox(true).clone();
      this._caixaLocalSplat.union(c);
    }
    return caixa;
  }

  /** Coloca o splat no lugar: X_cena = escala·R·x_splat + (t − origem). */
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
    for (const obj of [this.linhas, this.pontos, ...secoes]) {
      if (!obj) continue;
      obj.material.depthTest = !ligado;
      // na lista "transparente" o three desenha depois dos splats, e o
      // renderOrder alto garante que seja o último a pintar
      obj.material.transparent = !!ligado;
      obj.material.needsUpdate = true;
      obj.renderOrder = ligado ? 100 : 0;
    }
  }

  definirDesenho(linhas, pontos) {
    this.grupoDesenho.clear();
    this.linhas = this.pontos = null;
    if (linhas && linhas.length) {
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
    const esfera = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: cor, depthTest: false }));
    esfera.position.copy(posicao);
    esfera.renderOrder = 10;
    esfera.userData.id = id;
    esfera.userData.escalaTela = true;
    this.grupoMarcas.add(esfera);
    if (texto) this.rotular(posicao, texto, cor === COR_MEDIDA);
    return esfera;
  }

  /** Marcador mais próximo do cursor na tela (até `tolerancia` px). */
  marcaSobCursor(evento, tolerancia = 14) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    let melhor = null, menor = tolerancia;
    for (const m of this.grupoMarcas.children) {
      if (!m.isMesh || !m.userData.id) continue;
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

  desenharLinhaMedida(pontos, fechar = false) {
    if (pontos.length < 2) return null;
    const p = fechar ? [...pontos, pontos[0]] : pontos;
    const geo = new THREE.BufferGeometry().setFromPoints(p);
    const linha = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: COR_MEDIDA, depthTest: false, linewidth: 2 }));
    linha.renderOrder = 9;
    this.grupoMarcas.add(linha);
    return linha;
  }

  rotular(posicao, texto, medida = false) {
    const div = document.createElement("div");
    div.className = "rotulo3d" + (medida ? " medida" : "");
    div.textContent = texto;
    this.camadaRotulos.appendChild(div);
    this.rotulos.push({ div, posicao: posicao.clone() });
    return div;
  }

  limparMarcas() {
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
      if (this.linhas && this.linhas.visible) alvos.push(this.linhas);
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
    if (!this.gizmo) {
      this.gizmo = new TransformControls(this.camera, this.canvas);
      this.gizmo.setSpace("world");
      this.gizmo.addEventListener("dragging-changed", (e) => {
        this.controles.enabled = !e.value;      // não gira a câmera junto
        if (e.value && this.aoPegarGizmo) this.aoPegarGizmo();
        if (!e.value && this.aoSoltarGizmo) this.aoSoltarGizmo();
      });
      this.gizmo.addEventListener("objectChange", () => {
        if (this.gizmo.mode === "scale") {      // escala sempre igual nos 3
          const s = this.splat.scale;
          const media = (s.x + s.y + s.z) / 3;
          s.set(media, media, media);
        }
        if (this.aoMexerGizmo) this.aoMexerGizmo();
      });
      this.cena.add(this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo);
    }
    this.gizmo.setMode(modo);
    this.gizmo.attach(this.splat);
    this.gizmo.enabled = true;
    const ajudante = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    ajudante.visible = true;
    this.gizmoModo = modo;
    return true;
  }

  desativarGizmo() {
    if (!this.gizmo) return;
    this.gizmo.detach();
    this.gizmo.enabled = false;
    const ajudante = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    ajudante.visible = false;
    this.controles.enabled = true;
    this.gizmoModo = null;
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
