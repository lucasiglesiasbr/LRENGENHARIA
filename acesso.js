// Login e senha do site publicado (ver splatgeo/protecao.py). Script comum, usado
// pela central e pelo visualizador de cada obra: <script src=".../acesso.js" data-raiz="../../">.
// Site sem proteção (não existe protegido.json na raiz): tudo passa direto, em claro.
// Site protegido: pede usuário e senha, abre o cofre do usuário (chaves das obras
// dele) e decifra cada arquivo .sgx no próprio navegador. Nada vai para servidor nenhum.
(function () {
  const RAIZ = document.currentScript?.dataset.raiz || "./";
  const GUARDA = "splatgeo_acesso";
  const de64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  let estado = null;                 // { nome, obras: {pasta: chave em base64} }
  let protegido = null;
  const chavesProntas = {};

  async function ehProtegido() {
    if (protegido !== null) return protegido;
    try {
      const r = await fetch(RAIZ + "protegido.json", { cache: "no-store" });
      protegido = r.ok && (await r.json()).protegido === true;
    } catch (_) { protegido = false; }
    return protegido;
  }

  // O que fica guardado no aparelho (v 2): o id do usuário, a CHAVE tirada da senha e o último
  // cofre aberto. A cada visita o cofre é reaberto do acessos.json do site com essa chave: obra
  // publicada depois aparece sozinha, e usuário removido ou com senha trocada volta ao login.
  // (Até 25/09 guardava só o cofre aberto: obra nova não aparecia enquanto não saísse e entrasse.)
  function lembrado() {
    for (const onde of [sessionStorage, localStorage]) {
      try { const t = onde.getItem(GUARDA); if (t) return { g: JSON.parse(t), onde }; } catch (_) { /* sem memória */ }
    }
    return null;
  }

  function esquecer() {
    for (const onde of [sessionStorage, localStorage]) { try { onde.removeItem(GUARDA); } catch (_) { /* sem memória */ } }
  }

  function guardar(g, lembrar) {
    const t = JSON.stringify(g);
    try { sessionStorage.setItem(GUARDA, t); } catch (_) { /* sem memória */ }
    if (lembrar) { try { localStorage.setItem(GUARDA, t); } catch (_) { /* idem */ } }
  }

  async function lerAcessos() {
    const r = await fetch(RAIZ + "acessos.json", { cache: "no-store" });
    if (!r.ok) throw new Error("não consegui ler os acessos do site");
    return r.json();
  }

  async function decifrarCofre(chave, entrada) {
    const pacote = de64(entrada.cofre);
    const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: pacote.slice(4, 16) }, chave, pacote.slice(16));
    return JSON.parse(new TextDecoder().decode(claro));
  }

  async function abrirCofre(login, senha) {
    if (!window.crypto?.subtle) throw new Error("este navegador não abre o site protegido (precisa de https)");
    const acessos = await lerAcessos();
    const texto = new TextEncoder();
    const id = hex(await crypto.subtle.digest("SHA-256", texto.encode("splatgeo:" + login.trim().toLowerCase()))).slice(0, 20);
    const entrada = acessos.usuarios[id];
    // usuário que não existe gasta o mesmo tempo que senha errada, e a resposta é a mesma
    const sal = entrada ? de64(entrada.sal) : new Uint8Array(16);
    const base = await crypto.subtle.importKey("raw", texto.encode(senha), "PBKDF2", false, ["deriveKey"]);
    const chave = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: acessos.voltas }, base,
      { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
    if (!entrada) throw new Error("usuário ou senha não conferem");
    let cofre;
    try { cofre = await decifrarCofre(chave, entrada); } catch (_) { throw new Error("usuário ou senha não conferem"); }
    const bruta = new Uint8Array(await crypto.subtle.exportKey("raw", chave));
    return { cofre, guardado: { v: 2, id, chave: btoa(String.fromCharCode(...bruta)), cofre } };
  }

  /** Volta sem pedir a senha: reabre o cofre ATUAL do site com a chave guardada. null = pedir login. */
  async function retomar() {
    const achado = lembrado();
    if (!achado) return null;
    const { g, onde } = achado;
    if (!g || g.v !== 2 || !g.id || !g.chave) { esquecer(); return null; }   // guardado do formato antigo: login uma vez
    let acessos;
    try { acessos = await lerAcessos(); } catch (_) { return g.cofre || null; }   // sem rede: o último cofre aberto
    const entrada = acessos.usuarios?.[g.id];
    if (!entrada) { esquecer(); return null; }                            // usuário removido
    try {
      const chave = await crypto.subtle.importKey("raw", de64(g.chave), "AES-GCM", false, ["decrypt"]);
      const cofre = await decifrarCofre(chave, entrada);
      g.cofre = cofre;
      try { onde.setItem(GUARDA, JSON.stringify(g)); } catch (_) { /* sem memória */ }
      if (onde === localStorage) { try { sessionStorage.setItem(GUARDA, JSON.stringify(g)); } catch (_) { /* idem */ } }
      return cofre;
    } catch (_) { esquecer(); return null; }                              // senha trocada
  }

  function tela(mensagem) {
    return new Promise((resolver) => {
      const caixa = document.createElement("div");
      caixa.id = "sg-login";
      caixa.innerHTML = `
<style>
  @font-face { font-family: "Archivo"; font-weight: 400 900; font-display: swap; src: url("${RAIZ}fontes/archivo-latin.woff2") format("woff2"); }
  @font-face { font-family: "IBM Plex Mono"; font-weight: 400; font-display: swap; src: url("${RAIZ}fontes/plexmono-400-latin.woff2") format("woff2"); }
  #sg-login { position: fixed; inset: 0; z-index: 99999; background: #181411; color: #F2ECE3; display: flex;
    align-items: center; justify-content: center; padding: 24px; font-family: Archivo, system-ui, sans-serif; cursor: auto; }
  #sg-login * { box-sizing: border-box; cursor: auto; }
  #sg-login form { width: min(100%, 380px); animation: sgSobe .7s cubic-bezier(.16, 1, .3, 1); }
  @keyframes sgSobe { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }
  #sg-login img { display: block; width: 100%; margin-bottom: 30px; }
  #sg-login .rotulo { font-family: "IBM Plex Mono", monospace; font-size: 11.5px; letter-spacing: .26em; text-transform: uppercase;
    color: #FA6900; display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
  #sg-login .rotulo::before { content: ""; width: 28px; height: 1px; background: #FA6900; }
  #sg-login label { display: block; font-family: "IBM Plex Mono", monospace; font-size: 10.5px; letter-spacing: .2em;
    text-transform: uppercase; color: #8A8178; margin: 14px 0 6px; }
  #sg-login input[type=text], #sg-login input[type=password] { width: 100%; background: #221E1A; color: #F2ECE3;
    border: 1px solid rgba(242, 236, 227, .16); border-radius: 2px; padding: 13px 14px; font: 15px Archivo, system-ui, sans-serif;
    outline: none; transition: border-color .25s, box-shadow .25s; }
  #sg-login input:focus { border-color: #FA6900; box-shadow: 0 0 0 3px rgba(250, 105, 0, .14); }
  #sg-login .lembrar { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 13px; color: #8A8178;
    font-family: Archivo, system-ui, sans-serif; letter-spacing: 0; text-transform: none; }
  #sg-login button { width: 100%; margin-top: 20px; background: #FA6900; color: #fff; border: none; border-radius: 2px;
    padding: 16px; font: 700 13px Archivo, system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase;
    cursor: pointer; transition: background .3s, color .3s, box-shadow .3s; }
  #sg-login button:hover:not(:disabled) { background: #fff; color: #221E1A; box-shadow: 0 14px 36px rgba(250, 105, 0, .35); }
  #sg-login button:disabled { opacity: .6; cursor: progress; }
  #sg-login .erro { min-height: 20px; margin-top: 14px; font-size: 13px; color: #ffb07a; }
</style>
<form autocomplete="on">
  <img src="${RAIZ}logo_lr.svg" alt="LR Empreendimentos">
  <div class="rotulo">Acesso às obras</div>
  <label for="sg-usuario">Usuário</label>
  <input type="text" id="sg-usuario" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
  <label for="sg-senha">Senha</label>
  <input type="password" id="sg-senha" name="password" autocomplete="current-password" required>
  <label class="lembrar"><input type="checkbox" id="sg-lembrar"> continuar conectado neste aparelho</label>
  <button type="submit">Entrar</button>
  <div class="erro" role="alert">${mensagem || ""}</div>
</form>`;
      document.body.appendChild(caixa);
      const form = caixa.querySelector("form"), erro = caixa.querySelector(".erro"), botao = caixa.querySelector("button");
      caixa.querySelector("#sg-usuario").focus();
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        botao.disabled = true;
        botao.textContent = "Conferindo…";
        erro.textContent = "";
        try {
          const { cofre, guardado } = await abrirCofre(caixa.querySelector("#sg-usuario").value, caixa.querySelector("#sg-senha").value);
          guardar(guardado, caixa.querySelector("#sg-lembrar").checked);
          caixa.remove();
          resolver(cofre);
        } catch (falha) {
          erro.textContent = falha.message || String(falha);
          botao.disabled = false;
          botao.textContent = "Entrar";
        }
      });
    });
  }

  /** Registro de acessos (planilha do Lucas): manda "quem, o quê, qual obra" assinado com
   *  o segredo que veio no cofre. Nunca atrapalha a página: se falhar, fica por isso mesmo.
   *  Uma linha por evento e por obra a cada sessão (recarregar a página não repete). */
  async function registrar(evento, obra = "") {
    try {
      const r = estado?.registro;
      if (!r?.url || !window.crypto?.subtle) return;
      const marca = "splatgeo_registrado:" + evento + ":" + obra;
      if (sessionStorage.getItem(marca)) return;
      sessionStorage.setItem(marca, "1");
      const t = Date.now(), texto = new TextEncoder();
      const chave = await crypto.subtle.importKey("raw", texto.encode(r.segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const s = hex(await crypto.subtle.sign("HMAC", chave, texto.encode([t, estado.nome, obra, evento].join("|"))));
      const ua = navigator.userAgent;
      const aparelho = (/Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows"
        : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "outro") +
        " · " + (/Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "navegador");
      // "no-cors" + texto puro: o Google aceita sem consulta prévia; a resposta não interessa
      fetch(r.url, { method: "POST", mode: "no-cors", keepalive: true,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ t, u: estado.nome, o: obra, e: evento, a: aparelho, s }) }).catch(() => {});
    } catch (_) { /* registro é acessório */ }
  }

  /** Garante que há alguém dentro. `pasta` = a obra que a página precisa abrir (ou nada, na central). */
  async function entrar(pasta) {
    if (!(await ehProtegido())) return null;
    estado = estado || (await retomar());
    let mensagem = "";
    while (!estado || (pasta && !estado.obras[pasta])) {
      if (estado && pasta) mensagem = "este usuário não tem acesso a esta obra";
      estado = null;
      estado = await tela(mensagem);
    }
    return estado;          // quem registra é a PÁGINA (a central pede o cartão de cada obra por aqui)
  }

  function sair() {
    estado = null;
    esquecer();
    location.href = RAIZ + "index.html";
  }

  async function chaveDa(pasta) {
    if (!chavesProntas[pasta]) {
      chavesProntas[pasta] = await crypto.subtle.importKey("raw", de64(estado.obras[pasta]), "AES-GCM", false, ["decrypt"]);
    }
    return chavesProntas[pasta];
  }

  /** Bytes de um arquivo da obra: em claro no site aberto, decifrados no protegido.
   *  Chave velha (acesso trocado depois do "continuar conectado") = pede login de novo. */
  async function buscar(pasta, url, tentouDeNovo = false) {
    if (!(await ehProtegido())) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(url + ": " + r.status);
      return r.arrayBuffer();
    }
    await entrar(pasta);
    const r = await fetch(url + ".sgx");
    if (!r.ok) throw new Error(url + ": " + r.status);
    const pacote = new Uint8Array(await r.arrayBuffer());
    try {
      return await crypto.subtle.decrypt({ name: "AES-GCM", iv: pacote.slice(4, 16) }, await chaveDa(pasta), pacote.slice(16));
    } catch (_) {
      if (tentouDeNovo) throw new Error(url + ": não abriu com a chave deste usuário");
      esquecer();
      estado = null;
      delete chavesProntas[pasta];
      await entrar(pasta);
      return buscar(pasta, url, true);
    }
  }

  window.SGAcesso = { ehProtegido, entrar, sair, buscar, registrar, quem: () => estado?.nome || null, obras: () => Object.keys(estado?.obras || {}) };
})();
