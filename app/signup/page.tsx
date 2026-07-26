"use client";

import { FormEvent, useState } from "react";

export default function SignupPage() {
  const [escritorioNome, setEscritorioNome] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [reenvioMessage, setReenvioMessage] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ escritorioNome, nome, email, senha }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Não foi possível criar a conta.");
      setLoading(false);
      return;
    }

    setEnviado(true);
    setLoading(false);
  };

  const reenviar = async () => {
    setReenvioMessage("");
    const response = await fetch("/api/auth/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await response.json()) as { message?: string; error?: string };
    setReenvioMessage(data.message ?? data.error ?? "Não foi possível reenviar o link.");
  };

  return (
    <main className="auth-page auth-page-signup">
      <section className="auth-showcase signup-showcase" aria-label="Controle de Carteira">
        <a className="auth-brand" href="/login"><span>▣</span> Controle de carteira</a>
        <div className="auth-showcase-copy"><p className="auth-kicker">Comece sua organização</p><h1>Uma carteira bem gerida começa aqui.</h1><p>Crie o acesso do seu escritório e tenha uma visão única de clientes, tarefas e obrigações.</p></div>
      </section>
      <section className="auth-access">
        <div className="login-card signup-card">
          {enviado ? (
            <>
              <div className="login-heading signup-heading"><h2>Confirme seu e-mail</h2><small>Enviamos um link de confirmação para <strong>{email}</strong>. Clique nele para ativar sua conta.</small></div>
              <button className="login-submit" type="button" onClick={reenviar}>Reenviar link<span aria-hidden="true">→</span></button>
              {reenvioMessage && <p className="notice-feedback" role="status">{reenvioMessage}</p>}
              <a className="signup-link" href="/login"><span>→</span><span><strong>Já confirmou?</strong><small>Entre com seu e-mail e senha</small></span><b aria-hidden="true">→</b></a>
            </>
          ) : (
            <>
              <div className="login-heading signup-heading"><h2>Cadastre seu escritório</h2></div>
              <form className="login-form signup-form" onSubmit={submit}>
                <label htmlFor="escritorioNome">Nome do escritório<input id="escritorioNome" autoComplete="organization" placeholder="Ex.: Escritório Contábil Silva" required value={escritorioNome} onChange={(e) => setEscritorioNome(e.target.value)} /></label>
                <label htmlFor="nome">Seu nome<input id="nome" autoComplete="name" placeholder="Como podemos chamar você?" required value={nome} onChange={(e) => setNome(e.target.value)} /></label>
                <label htmlFor="email">E-mail<input id="email" type="email" autoComplete="email" placeholder="voce@escritorio.com.br" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
                <label htmlFor="senha">Senha<input id="senha" type="password" autoComplete="new-password" placeholder="Mínimo de 8 caracteres" required minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
                {error && <div className="notice error" role="alert"><p>{error}</p></div>}
                <button className="login-submit" disabled={loading}>{loading ? "Criando conta…" : "Criar minha conta"}<span aria-hidden="true">→</span></button>
              </form>
              <a className="signup-link" href="/login"><span>→</span><span><strong>Já possui uma conta?</strong><small>Entre com seu e-mail e senha</small></span><b aria-hidden="true">→</b></a>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
