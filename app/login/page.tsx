"use client";

import { FormEvent, useEffect, useState } from "react";

const AVISOS_DE_RETORNO: Record<string, string> = {
  google: "Não foi possível entrar com o Google. Tente novamente.",
  recuperacao: "O link de redefinição expirou ou já foi usado. Solicite um novo.",
  confirmacao: "O link de confirmação expirou ou já foi usado. Faça login para receber outro.",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [naoConfirmado, setNaoConfirmado] = useState(false);
  const [reenvioMessage, setReenvioMessage] = useState("");

  // Lido depois da montagem para não divergir do HTML renderizado no servidor.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const [chave, mensagem] of Object.entries(AVISOS_DE_RETORNO)) {
      if (params.get(chave) === "erro") {
        setError(mensagem);
        return;
      }
    }
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNaoConfirmado(false);
    setReenvioMessage("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha }),
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string; emailNaoConfirmado?: boolean };
      setError(data.error ?? "Não foi possível entrar.");
      setNaoConfirmado(Boolean(data.emailNaoConfirmado));
      setLoading(false);
      return;
    }

    // Navegação client-side (router.push + router.refresh) para "/" trava
    // com a sessão já autenticada no servidor mas a UI presa em /login —
    // um bug de transição RSC no vinext. Redirect "hard" contorna isso.
    window.location.href = "/";
  };

  const reenviarConfirmacao = async () => {
    setReenvioMessage("");
    const response = await fetch("/api/auth/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await response.json()) as { message?: string; error?: string };
    setReenvioMessage(data.message ?? data.error ?? "Não foi possível reenviar o link.");
  };

  const requestPasswordReset = async (event: FormEvent) => {
    event.preventDefault();
    setRecoveryLoading(true);
    setRecoveryMessage("");

    const response = await fetch("/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: recoveryEmail }),
    });
    const data = (await response.json()) as { error?: string; message?: string };
    setRecoveryMessage(data.message ?? data.error ?? "Não foi possível solicitar a redefinição.");
    setRecoveryLoading(false);
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
            <button className="forgot-password" type="button" onClick={() => { setRecoveryOpen((open) => !open); setRecoveryEmail(email); setRecoveryMessage(""); }}>Esqueci a senha</button>
            {error && (
              <div className="notice error" role="alert">
                <p>{error}</p>
                {naoConfirmado && <button className="notice-action" type="button" onClick={reenviarConfirmacao}>Reenviar link de confirmação</button>}
                {reenvioMessage && <p className="notice-feedback" role="status">{reenvioMessage}</p>}
              </div>
            )}
            <button className="login-submit" disabled={loading}>{loading ? "Entrando…" : "Entrar na plataforma"}<span aria-hidden="true">→</span></button>
          </form>
          {recoveryOpen && <form className="password-recovery" onSubmit={requestPasswordReset}><strong>Redefinir senha</strong><p>Informe seu e-mail para receber um link de redefinição.</p><label htmlFor="recovery-email">E-mail<input id="recovery-email" type="email" autoComplete="email" placeholder="voce@escritorio.com.br" required value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} /></label><button className="recovery-submit" disabled={recoveryLoading}>{recoveryLoading ? "Enviando…" : "Enviar link"}</button>{recoveryMessage && <p className="recovery-message" role="status">{recoveryMessage}</p>}</form>}
          <div className="login-divider"><span>ou</span></div>
          <a className="google-signin" href="/api/auth/google">
            <svg className="google-signin-mark" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
            </svg>
            Entrar com Google
          </a>
          <a className="signup-link" href="/signup"><span>✦</span><span><strong>Primeiro acesso?</strong><small>Cadastre seu escritório gratuitamente</small></span><b aria-hidden="true">→</b></a>
        </div>
        <p className="auth-security">◇ Seus dados são protegidos e acessados apenas por usuários autorizados.</p>
      </section>
    </main>
  );
}
