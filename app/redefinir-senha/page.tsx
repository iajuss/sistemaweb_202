"use client";

import { FormEvent, useState } from "react";

export default function RedefinirSenhaPage() {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (senha !== confirmacao) {
      setMessage("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "Não foi possível redefinir a senha.");
      setLoading(false);
      return;
    }
    window.location.href = "/";
  };

  return <main className="auth-page password-page"><section className="auth-showcase" aria-label="Controle de Carteira"><a className="auth-brand" href="/login"><span>▣</span> Controle de carteira</a><div className="auth-showcase-copy"><p className="auth-kicker">Recuperação de acesso</p><h1>Defina uma nova senha com segurança.</h1><p>Após salvar, você poderá acessar a plataforma normalmente.</p></div></section><section className="auth-access"><div className="login-card"><div className="login-heading"><p>Nova senha</p><h2>Redefina seu acesso</h2><small>Crie uma senha com pelo menos 8 caracteres.</small></div><form className="login-form" onSubmit={submit}><label htmlFor="nova-senha">Nova senha<input id="nova-senha" type="password" autoComplete="new-password" minLength={8} required value={senha} onChange={(event) => setSenha(event.target.value)} /></label><label htmlFor="confirmar-senha">Confirmar nova senha<input id="confirmar-senha" type="password" autoComplete="new-password" minLength={8} required value={confirmacao} onChange={(event) => setConfirmacao(event.target.value)} /></label>{message && <div className="notice error" role="alert"><p>{message}</p></div>}<button className="login-submit" disabled={loading}>{loading ? "Salvando…" : "Salvar nova senha"}</button></form></div></section></main>;
}
