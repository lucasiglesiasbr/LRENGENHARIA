// Central das obras publicada (GitHub Pages): lê obras.json e monta um
// cartão por obra, igual à central do programa. Sem servidor.
(async function () {
  const lista = document.getElementById("lista");
  const resumo = document.getElementById("resumo");
  let obras = [];
  try {
    const r = await fetch("./obras.json", { cache: "no-store" });
    obras = await r.json();
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
  for (const o of obras) {
    const c = document.createElement("div");
    c.className = "cartao";
    const foto = o.miniatura ? `style="background-image:url('${o.pasta}/${o.miniatura}')"` : "";
    const splat = o.splat
      ? `${fmt(o.splat.splats)} splats · ${o.splat.formato === "spz"
        ? "brilho direcional grau " + o.splat.grau_sh : "sem brilho direcional"} · ${o.splat.mb} MB`
      : "sem splat";
    c.innerHTML =
      `<div class="foto" ${foto}>${o.miniatura ? "" : "sem foto"}</div>` +
      `<div class="corpo"><h2>${o.nome}</h2>` +
      `<div class="info">${o.nome_epsg || ""}${o.gerado_em ? " · exportada em " + o.gerado_em : ""}</div>` +
      `<div class="info">${splat}${o.topografia ? " · topografia" : ""}</div>` +
      `<a class="abrir" href="${o.pasta}/index.html">Abrir</a></div>`;
    lista.appendChild(c);
  }
})();
