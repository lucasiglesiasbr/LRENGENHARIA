// Central das obras publicada (GitHub Pages): lê obras.json e monta um
// cartão por obra, igual à central do programa. Sem servidor.
// Do site da LR vêm só os efeitos: cursor próprio, barra de progresso, cartões que
// surgem ao rolar.
(async function () {
  const lista = document.getElementById("lista");
  const resumo = document.getElementById("resumo");
  const calmo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- efeitos
  const progresso = document.getElementById("progresso");
  function aoRolar() {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    progresso.style.width = (total > 0 ? Math.min(100, (100 * window.scrollY) / total) : 0) + "%";
  }
  window.addEventListener("scroll", aoRolar, { passive: true });
  window.addEventListener("resize", aoRolar);

  if (window.matchMedia("(pointer: fine)").matches && !calmo) {
    const anel = document.getElementById("cur-anel"), ponto = document.getElementById("cur-ponto");
    let ax = 0, ay = 0, px = 0, py = 0, ligado = false;
    window.addEventListener("pointermove", (e) => {
      px = e.clientX; py = e.clientY;
      if (!ligado) {                       // o cursor do sistema só some depois que o nosso apareceu
        ligado = true; ax = px; ay = py;
        document.body.classList.add("cursor-proprio");
        anel.style.opacity = ponto.style.opacity = 1;
      }
      ponto.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      anel.classList.toggle("sobre", !!e.target.closest?.("a, .cartao"));
    });
    document.addEventListener("pointerleave", () => { anel.style.opacity = ponto.style.opacity = 0; ligado = false; });
    (function quadro() {
      ax += (px - ax) * 0.18; ay += (py - ay) * 0.18;                  // o anel segue com atraso
      anel.style.transform = `translate3d(${ax}px, ${ay}px, 0)`;
      requestAnimationFrame(quadro);
    })();
  }

  const olheiro = "IntersectionObserver" in window
    ? new IntersectionObserver((itens) => {
      for (const i of itens) {
        if (!i.isIntersecting) continue;
        setTimeout(() => i.target.classList.add("visto"), Number(i.target.dataset.rvD) || 0);
        olheiro.unobserve(i.target);
      }
    }, { threshold: 0.1 })
    : null;
  const revelar = (el) => (olheiro ? olheiro.observe(el) : el.classList.add("visto"));

  // ------------------------------------------------------------------ obras
  // Site com login e senha: a lista sai do cofre de quem entrou (só as obras liberadas
  // para ele); o cartão e a foto de cada obra chegam cifrados e são abertos aqui.
  const acesso = window.SGAcesso;
  const protegido = acesso ? await acesso.ehProtegido() : false;
  let obras = [];
  try {
    if (protegido) {
      await acesso.entrar();
      acesso.registrar("abriu a lista de obras");
      const sair = document.getElementById("sair-do-site");
      sair.style.display = "inline-block";
      sair.textContent = "sair (" + acesso.quem() + ")";
      sair.onclick = (e) => { e.preventDefault(); acesso.sair(); };
      for (const pasta of acesso.obras().sort()) {
        try {
          const o = JSON.parse(new TextDecoder().decode(await acesso.buscar(pasta, `./obras/${pasta}/cartao.json`)));
          if (o.miniatura) {
            o.foto = URL.createObjectURL(new Blob([await acesso.buscar(pasta, `./obras/${pasta}/${o.miniatura}`)], { type: "image/jpeg" }));
          }
          obras.push(o);
        } catch (_) { /* obra que saiu do site: o cofre ainda a cita */ }
      }
    } else {
      const r = await fetch("./obras.json", { cache: "no-store" });
      obras = await r.json();
    }
  } catch (e) {
    resumo.textContent = "não consegui ler a lista de obras";
    return;
  }
  if (!obras.length) {
    document.getElementById("vazio").style.display = "block";
    resumo.textContent = "";
    return;
  }
  const fmt = (v) => (v ?? 0).toLocaleString("pt-BR");
  resumo.textContent = `${obras.length} obra${obras.length > 1 ? "s" : ""}`;
  obras.forEach((o, i) => {
    const c = document.createElement("div");
    c.className = "cartao";
    c.setAttribute("data-rv", "");
    c.dataset.rvD = 1300 + (i % 4) * 110;          // depois da cortina, um atrás do outro
    const foto = o.miniatura
      ? `<div class="img" style="background-image:url('${o.foto || o.pasta + "/" + o.miniatura}')"></div>` : "sem foto";
    const splat = o.splat
      ? `${fmt(o.splat.splats)} splats · ${o.splat.formato === "spz"
        ? "brilho direcional grau " + o.splat.grau_sh : "sem brilho direcional"} · ${o.splat.mb} MB`
      : "sem splat";
    c.innerHTML =
      `<div class="foto">${foto}</div>` +
      `<div class="corpo"><h2>${o.nome}</h2>` +
      `<div class="info">${o.nome_epsg || ""}${o.voo_data ? " · voo de " + o.voo_data : ""}${o.gerado_em ? " · exportada em " + o.gerado_em : ""}</div>` +
      `<div class="info">${splat}${o.topografia ? " · topografia" : ""}</div>` +
      `<a class="abrir" href="${o.pasta}/index.html"><span>Abrir</span><i><b>→</b></i></a></div>`;
    lista.appendChild(c);
    revelar(c);
  });
  aoRolar();
})();
