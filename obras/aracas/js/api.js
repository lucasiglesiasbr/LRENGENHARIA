// Conversa com o servidor local. Toda rota devolve JSON; erro vem em .erro.

export async function api(rota, dados = {}) {
  // todo pedido leva o nome da obra aberta: se o servidor reiniciou, ele
  // reabre a obra certa em vez de gravar numa "obra sem nome"
  const corpo = { ...dados };
  if (window.__obraAberta && corpo.obra === undefined) corpo.obra = window.__obraAberta;
  const resposta = await fetch(`/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const saida = await resposta.json().catch(() => ({ erro: "resposta inválida" }));
  if (!resposta.ok || saida.erro) throw new Error(saida.erro || resposta.statusText);
  return saida;
}

export async function estado() {
  const r = await fetch("/api/estado");
  return r.json();
}

export async function enviarArquivo(arquivo, aoProgredir) {
  return new Promise((resolve, rejeitar) => {
    const req = new XMLHttpRequest();
    req.open("PUT", `/api/enviar/${encodeURIComponent(arquivo.name)}`);
    req.upload.onprogress = (e) => {
      if (aoProgredir && e.lengthComputable) aoProgredir(e.loaded / e.total);
    };
    req.onload = () => {
      try {
        const saida = JSON.parse(req.responseText);
        saida.erro ? rejeitar(new Error(saida.erro)) : resolve(saida);
      } catch (e) { rejeitar(e); }
    };
    req.onerror = () => rejeitar(new Error("falha no envio"));
    req.send(arquivo);
  });
}

// base64 -> array tipado (usado para malha, linhas e pontos do DXF)
export function desempacotar(b64, Tipo = Float32Array) {
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Tipo(bytes.buffer);
}

export const fmt = {
  metro: (v) => (v === null || v === undefined || !isFinite(v) ? "—"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
  cm: (v) => (v === null || v === undefined || !isFinite(v) ? "—"
    : (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " cm"),
  num: (v, casas = 3) => (v === null || v === undefined || !isFinite(v) ? "—"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })),
  inteiro: (v) => (v ?? 0).toLocaleString("pt-BR"),
};
