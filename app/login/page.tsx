"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Não foi possível entrar.");
      setLoading(false);
      return;
    }

    // Navegação client-side (router.push + router.refresh) para "/" trava
    // com a sessão já autenticada no servidor mas a UI presa em /login —
    // um bug de transição RSC no vinext. Redirect "hard" contorna isso.
    window.location.href = "/";
  };

  return (
    <main className="auth-page">
      <section className="auth-showcase" aria-label="Controle de Carteira">
        <a className="auth-brand" href="/login"><span>▣</span> Controle de carteira</a>
        <div className="auth-showcase-copy">
          <p className="auth-kicker">Gestão contábil organizada</p>
          <h1>Uma rotina mais clara para a sua carteira.</h1>
          <p>Centralize clientes, acompanhe obrigações e mantenha o time alinhado em um só lugar.</p>
        </div>
        <div className="auth-benefits" aria-label="Benefícios do sistema">
          <div><span>✓</span><p><strong>Carteira em ordem</strong><small>Acompanhe seus clientes de ponta a ponta.</small></p></div>
          <div><span>◷</span><p><strong>Prazos visíveis</strong><small>Priorize o que precisa da sua atenção.</small></p></div>
          <div><span>✦</span><p><strong>Decisões seguras</strong><small>Transforme informações em ações.</small></p></div>
        </div>
      </section>
      <section className="auth-access">
        <div className="login-card">
          <div className="login-heading"><p>Bem-vindo de volta</p><h2>Acesse sua conta</h2><small>Use seu e-mail e senha para continuar.</small></div>
          <form className="login-form" onSubmit={submit}>
            <label htmlFor="email">E-mail<input id="email" type="email" autoComplete="email" placeholder="voce@escritorio.com.br" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label htmlFor="senha">Senha<input id="senha" type="password" autoComplete="current-password" placeholder="Digite sua senha" required value={senha} onChange={(e) => setSenha(e.target.value)} /></label>
            {error && <div className="notice error" role="alert"><p>{error}</p></div>}
            <button className="login-submit" disabled={loading}>{loading ? "Entrando…" : "Entrar na plataforma"}<span aria-hidden="true">→</span></button>
          </form>
          <div className="login-divider"><span>ou</span></div>
          <a className="signup-link" href="/signup"><span>✦</span><span><strong>Primeiro acesso?</strong><small>Cadastre seu escritório gratuitamente</small></span><b aria-hidden="true">→</b></a>
        </div>
        <p className="auth-security">◇ Seus dados são protegidos e acessados apenas por usuários autorizados.</p>
      </section>
    </main>
  );
}
