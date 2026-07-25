"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [escritorioNome, setEscritorioNome] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

    router.push("/login");
  };

  return (
    <main className="app-shell">
      <section className="panel onboarding" style={{ maxWidth: 400, margin: "80px auto" }}>
        <h2>Cadastrar escritório</h2>
        <form onSubmit={submit}>
          <label htmlFor="escritorioNome">Nome do escritório</label>
          <input
            id="escritorioNome"
            required
            value={escritorioNome}
            onChange={(e) => setEscritorioNome(e.target.value)}
          />
          <label htmlFor="nome">Seu nome</label>
          <input id="nome" required value={nome} onChange={(e) => setNome(e.target.value)} />
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="senha">Senha (mínimo 8 caracteres)</label>
          <input
            id="senha"
            type="password"
            required
            minLength={8}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          {error && (
            <div className="notice error">
              <p>{error}</p>
            </div>
          )}
          <button className="primary" disabled={loading}>
            {loading ? "Criando…" : "Criar conta"}
          </button>
        </form>
        <p>
          Já tem conta? <a href="/login">Entrar</a>
        </p>
      </section>
    </main>
  );
}
