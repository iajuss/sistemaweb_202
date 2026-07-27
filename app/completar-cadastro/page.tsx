"use client";

import { FormEvent, useEffect, useState } from "react";

export default function CompletarCadastroPage() {
  const [papel, setPapel] = useState<"responsavel" | "funcionario" | null>(null);
  const [escritorioNome, setEscritorioNome] = useState("");
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/perfis/eu")
      .then((r) => r.json())
      .then((data: { papel: "responsavel" | "funcionario" }) => setPapel(data.papel))
      .catch(() => setPapel("responsavel"));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (papel === "funcionario" && senha !== confirmacao) {
      setError("As senhas informadas não coincidem.");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/auth/completar-cadastro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(papel === "funcionario" ? { nome, senha } : { escritorioNome, nome }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Não foi possível salvar seus dados.");
      setLoading(false);
      return;
    }

    window.location.href = "/";
  };

  return (
    <main className="auth-page auth-page-signup">
      <section className="auth-showcase signup-showcase" aria-label="Controle de Carteira">
        <a className="auth-brand" href="/"><span>▣</span> Controle de carteira</a>
        <div className="auth-showcase-copy"><p className="auth-kicker">Falta pouco</p><h1>{papel === "funcionario" ? "Só mais um passo e você já está no espaço da equipe." : "Só mais dois dados e sua carteira está pronta."}</h1><p>{papel === "funcionario" ? "Defina seu nome e uma senha de acesso." : "Precisamos saber como chamar você e qual é o nome do seu escritório."}</p></div>
      </section>
      <section className="auth-access">
        <div className="login-card signup-card">
          <div className="login-heading signup-heading"><h2>Complete seu cadastro</h2></div>
          <form className="login-form signup-form" onSubmit={submit}>
            {papel !== "funcionario" && <label htmlFor="escritorioNome">Nome do escritório<input id="escritorioNome" autoComplete="organization" placeholder="Ex.: Escritório Contábil Silva" required value={escritorioNome} onChange={(e) => setEscritorioNome(e.target.value)} /></label>}
            <label htmlFor="nome">Seu nome<input id="nome" autoComplete="name" placeholder="Como podemos chamar você?" required value={nome} onChange={(e) => setNome(e.target.value)} /></label>
            {papel === "funcionario" && <>
              <label htmlFor="senha">Senha<input id="senha" type="password" autoComplete="new-password" minLength={8} required value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
              <label htmlFor="confirmacao">Confirmar senha<input id="confirmacao" type="password" autoComplete="new-password" minLength={8} required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} /></label>
            </>}
            {error && <div className="notice error" role="alert"><p>{error}</p></div>}
            <button className="login-submit" disabled={loading || papel === null}>{loading ? "Salvando…" : "Entrar na plataforma"}<span aria-hidden="true">→</span></button>
          </form>
        </div>
      </section>
    </main>
  );
}
