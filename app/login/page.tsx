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
    <main className="app-shell">
      <section className="panel onboarding" style={{ maxWidth: 360, margin: "80px auto" }}>
        <h2>Entrar</h2>
        <form onSubmit={submit}>
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="senha">Senha</label>
          <input id="senha" type="password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
          {error && (
            <div className="notice error">
              <p>{error}</p>
            </div>
          )}
          <button className="primary" disabled={loading}>
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
        <p>
          Não tem conta? <a href="/signup">Cadastre seu escritório</a>
        </p>
      </section>
    </main>
  );
}
