"use client";

import { ClipboardEvent, FormEvent, lazy, ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { extrairCNPJDoTexto, validarCNPJ } from "../lib/cnpj";
import {
  atualizarEmpresa, consultarCNPJ, excluirEmpresa,
  executarAuditoria, formatarSocio, listarDivergencias, listarEmpresas, listarPerfis,
  listarTarefas, paraSocioPayload, salvarEmpresa, tratarDivergencia,
  type Divergencia, type Empresa, type SocioPayload, type Tarefa,
} from "../src/services/portfolio";
import { Calendar } from "./calendar-view";

// recharts é grande e só é usado na aba "Análise". Carregado sob demanda para
// não entrar no caminho do primeiro render da rota "/" (que abre na "Visão
// geral"). Ver app/charts.tsx.
const BarVisual = lazy(() => import("./charts").then((m) => ({ default: m.BarVisual })));
const PieVisual = lazy(() => import("./charts").then((m) => ({ default: m.PieVisual })));

type View = "Visão geral" | "Onboarding" | "Auditoria" | "Análise" | "Calendário" | "Configurações";
const nav: { label: View; icon: string }[] = [
  { label: "Visão geral", icon: "⌂" }, { label: "Onboarding", icon: "＋" }, { label: "Auditoria", icon: "◈" },
  { label: "Análise", icon: "▥" }, { label: "Calendário", icon: "□" },
];
const formatDate = (date: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00`));
/** Data/hora completas no horário de Brasília, independente do fuso do navegador — usado no histórico de divergências. */
const formatDataHoraBrasilia = (isoComFuso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(isoComFuso));
/** Evita "...obrigatórios.. Tente novamente." quando a mensagem do servidor já termina em ponto. */
const semPontoFinal = (mensagem: string) => mensagem.replace(/\.+$/, "");

type CamposCadastraisDraft = {
  cnpj: string; razaoSocial: string; fantasia: string; cidade: string; estado: string; endereco: string;
  status: string; porte: string; cnaeCodigo: string; cnae: string; socios: SocioPayload[];
};
type EmpresaEditDraft = CamposCadastraisDraft & { responsavelId: string; observacoes: string };
const paraEditDraft = (empresa: Empresa): EmpresaEditDraft => ({
  cnpj: empresa.cnpj, razaoSocial: empresa.razaoSocial, fantasia: empresa.fantasia, cidade: empresa.cidade, estado: empresa.estado,
  endereco: empresa.endereco, status: empresa.status, porte: empresa.porte,
  cnaeCodigo: empresa.cnaeCodigo, cnae: empresa.cnae, socios: empresa.socios.map(paraSocioPayload),
  responsavelId: empresa.responsavelId ?? "", observacoes: empresa.observacoes ?? "",
});

/** Lista editável de sócios (nome + cargo), dentro de um dropdown
 * (`<details>`) para não ocupar espaço quando fechada. */
function SociosField({ socios, setSocios }: { socios: SocioPayload[]; setSocios: (socios: SocioPayload[]) => void }) {
  const atualizar = (indice: number, campo: "nome" | "papel", valor: string) => {
    setSocios(socios.map((s, i) => (i === indice ? { ...s, [campo]: valor } : s)));
  };
  const remover = (indice: number) => setSocios(socios.filter((_, i) => i !== indice));
  return <details className="socios-dropdown">
    <summary>Quadro societário{socios.length > 0 ? ` (${socios.length})` : ""}</summary>
    <div className="socios-list">
      {socios.length === 0 && <p className="static-value">Nenhum sócio informado.</p>}
      {socios.map((socio, i) => <div className="socio-row" key={i}>
        <input placeholder="Nome" aria-label="Nome do sócio" value={socio.nome} onChange={(e) => atualizar(i, "nome", e.target.value)} />
        <input placeholder="Cargo/qualificação" aria-label="Cargo do sócio" value={socio.papel} onChange={(e) => atualizar(i, "papel", e.target.value)} />
        <button type="button" className="icon-button" aria-label={`Remover ${socio.nome || "sócio"}`} onClick={() => remover(i)}>×</button>
      </div>)}
      <button type="button" className="secondary" onClick={() => setSocios([...socios, { nome: "", papel: "" }])}>+ Adicionar sócio</button>
    </div>
  </details>;
}

/** Campos cadastrais compartilhados entre o modal de edição (empresa já
 * persistida) e o modal de correção pré-cadastro (ainda não salva). */
function CamposCadastraisFields<T extends CamposCadastraisDraft>({ draft, setDraft }: {
  draft: T; setDraft: (draft: T) => void;
}) {
  return <>
    <label className="full">CNPJ<input value={draft.cnpj} onChange={(e) => setDraft({ ...draft, cnpj: maskCNPJ(e.target.value) })} onPaste={(e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); setDraft({ ...draft, cnpj: maskCNPJ(extrairCNPJDoTexto(e.clipboardData.getData("text"))) }); }} inputMode="numeric" /></label>
    <label className="full">Razão social<input required value={draft.razaoSocial} onChange={(e) => setDraft({ ...draft, razaoSocial: e.target.value })} /></label>
    <label className="full">Nome fantasia<input value={draft.fantasia} onChange={(e) => setDraft({ ...draft, fantasia: e.target.value })} /></label>
    <label>Cidade<input value={draft.cidade} onChange={(e) => setDraft({ ...draft, cidade: e.target.value })} /></label>
    <label>Estado<input maxLength={2} value={draft.estado} onChange={(e) => setDraft({ ...draft, estado: e.target.value.toUpperCase() })} /></label>
    <label className="full">Endereço<input value={draft.endereco} onChange={(e) => setDraft({ ...draft, endereco: e.target.value })} /></label>
    <label>Situação cadastral<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="Ativa">Ativa</option><option value="Suspensa">Suspensa</option><option value="Baixada">Baixada</option></select></label>
    <label>Porte<input value={draft.porte} onChange={(e) => setDraft({ ...draft, porte: e.target.value })} /></label>
    <label>Código CNAE<input value={draft.cnaeCodigo} onChange={(e) => setDraft({ ...draft, cnaeCodigo: e.target.value })} /></label>
    <label className="full">Descrição do CNAE<input value={draft.cnae} onChange={(e) => setDraft({ ...draft, cnae: e.target.value })} /></label>
    <div className="full"><SociosField socios={draft.socios} setSocios={(socios) => setDraft({ ...draft, socios })} /></div>
  </>;
}

/** Modal de correção pré-cadastro: edita os dados vindos da consulta (BrasilAPI/
 * ReceitaWS) antes de salvar na carteira. Não faz nenhuma chamada à API — só
 * devolve o rascunho corrigido para o chamador mesclar no `result` local, já
 * que a empresa ainda não existe no banco. */
function EmpresaPreviewEditModal({ empresa, onClose, onSave }: {
  empresa: Empresa; onClose: () => void; onSave: (dados: CamposCadastraisDraft) => void;
}) {
  const [draft, setDraft] = useState<CamposCadastraisDraft>(() => ({
    cnpj: empresa.cnpj, razaoSocial: empresa.razaoSocial, fantasia: empresa.fantasia, cidade: empresa.cidade, estado: empresa.estado,
    endereco: empresa.endereco, status: empresa.status, porte: empresa.porte, cnaeCodigo: empresa.cnaeCodigo, cnae: empresa.cnae,
    socios: empresa.socios.map(paraSocioPayload),
  }));
  const cnpjValido = validarCNPJ(draft.cnpj);
  const salvar = (e: FormEvent) => {
    e.preventDefault();
    if (!cnpjValido) return;
    onSave({ ...draft, cnpj: draft.cnpj.replace(/\D/g, "") });
  };
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={`Editar dados de ${empresa.razaoSocial}`}><form className="modal" onSubmit={salvar}><button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button><h2>Editar dados antes de salvar</h2><div className="field-grid">
    <CamposCadastraisFields draft={draft} setDraft={setDraft} />
  </div>{!cnpjValido && <div className="notice error"><p>CNPJ inválido — confira os números antes de salvar.</p></div>}<button className="primary" disabled={!cnpjValido}>Aplicar alterações</button></form></div>;
}
const maskCNPJ = (v: string) => v.replace(/\D/g, "").slice(0, 14).replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");

/** Roda uma revalidação interna (sem BrasilAPI) e recarrega as divergências.
 * Chamada após qualquer mutação de empresa (criar/editar/excluir) para que a
 * auditoria nunca fique com dados desatualizados — falha aqui é silenciosa
 * porque a mutação em si já foi persistida com sucesso; a próxima visita à
 * aba Auditoria (ou um "Revalidar carteira" manual) tenta de novo. */
async function revalidarAuditoriaSilenciosa(setIssues: (issues: Divergencia[]) => void) {
  try {
    await executarAuditoria(false);
    const atualizadas = await listarDivergencias();
    setIssues(atualizadas);
  } catch {
    // Silencioso — ver comentário acima.
  }
}

function EmpresaEditModal({ empresa, perfis, onClose, onSaved }: {
  empresa: Empresa; perfis: { id: string; nome: string }[]; onClose: () => void; onSaved: (empresa: Empresa) => void;
}) {
  const [draft, setDraft] = useState<EmpresaEditDraft>(() => paraEditDraft(empresa));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cnpjValido = validarCNPJ(draft.cnpj);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!cnpjValido) return;
    setSaving(true); setError("");
    try {
      const atualizada = await atualizarEmpresa(empresa.id, {
        cnpj: draft.cnpj.replace(/\D/g, ""), razaoSocial: draft.razaoSocial, fantasia: draft.fantasia, cidade: draft.cidade, estado: draft.estado,
        endereco: draft.endereco, situacaoCadastral: draft.status, porte: draft.porte,
        cnaeCodigo: draft.cnaeCodigo, cnaeDescricao: draft.cnae, socios: draft.socios,
        responsavelId: draft.responsavelId || null, observacoes: draft.observacoes,
      });
      onSaved(atualizada);
    } catch (err) {
      const bruta = err instanceof Error ? err.message : "Não foi possível atualizar a empresa";
      setError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setSaving(false);
    }
  };
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={`Editar ${empresa.razaoSocial}`}><form className="modal" onSubmit={save}><button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button><h2>Editar empresa</h2><div className="field-grid">
    <CamposCadastraisFields draft={draft} setDraft={setDraft} />
    <label className="full">Responsável interno<select value={draft.responsavelId} onChange={(e) => setDraft({ ...draft, responsavelId: e.target.value })}><option value="">Sem responsável</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
    <label className="full">Observações internas<textarea value={draft.observacoes} onChange={(e) => setDraft({ ...draft, observacoes: e.target.value })} /></label>
  </div>{!cnpjValido && <div className="notice error"><p>CNPJ inválido — confira os números antes de salvar.</p></div>}{error && <div className="notice error"><p>{error}</p></div>}<button className="primary" disabled={saving || !cnpjValido}>{saving ? "Salvando…" : "Salvar alterações"}</button></form></div>;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function statusTone(status: string): "success" | "warning" | "danger" {
  return status === "Ativa" ? "success" : status === "Suspensa" ? "warning" : "danger";
}

function Card({ title, value, helper, icon }: { title: string; value: string | number; helper: string; icon: string }) {
  return <article className="metric-card"><span className="metric-icon">{icon}</span><p>{title}</p><strong>{value}</strong><small>{helper}</small></article>;
}

function Empty({ title = "Nenhum resultado encontrado", text = "Ajuste seus filtros ou tente novamente." }) {
  return <div className="empty"><span>⌕</span><strong>{title}</strong><p>{text}</p></div>;
}

export function HomeClient({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [view, setView] = useState<View>("Visão geral");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [companies, setCompanies] = useState<Empresa[]>([]);
  const [issues, setIssues] = useState<Divergencia[]>([]);
  const [tasks, setTasks] = useState<Tarefa[]>([]);
  const [perfis, setPerfis] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    Promise.all([listarEmpresas(), listarDivergencias(), listarTarefas(), listarPerfis()])
      .then(([c, d, t, p]) => { setCompanies(c); setIssues(d); setTasks(t); setPerfis(p); setLoading(false); })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  useEffect(() => {
    setDarkMode(window.localStorage.getItem("controle-carteira-theme") === "dark");
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const toggleTheme = () => {
    const nextTheme = !darkMode;
    setDarkMode(nextTheme);
    window.localStorage.setItem("controle-carteira-theme", nextTheme ? "dark" : "light");
    document.documentElement.dataset.theme = nextTheme ? "dark" : "light";
  };

  const content = loading ? <Loading /> : (
    view === "Visão geral" ? <Overview companies={companies} issues={issues} tasks={tasks} go={setView} /> :
    view === "Onboarding" ? <Onboarding companies={companies} setCompanies={setCompanies} perfis={perfis} userName={userName} setIssues={setIssues} /> :
    view === "Auditoria" ? <Audit issues={issues} setIssues={setIssues} companies={companies} setCompanies={setCompanies} perfis={perfis} /> :
    view === "Análise" ? <Analysis companies={companies} /> :
    view === "Calendário" ? <Calendar tasks={tasks} setTasks={setTasks} companies={companies} perfis={perfis} /> :
    <Settings userName={userName} userEmail={userEmail} />
  );

  return <main className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
    <aside className={`sidebar ${menuOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="Navegação principal">
      <div className="brand">
        <div className="brand-identity"><span className="brand-mark">▣</span><span className="brand-name">Controle de carteira</span></div>
        <button className="sidebar-toggle" type="button" title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"} aria-label={sidebarCollapsed ? "Expandir navegação" : "Recolher navegação"} onClick={() => setSidebarCollapsed((current) => !current)}><span className="sidebar-glyph" aria-hidden="true" /></button>
      </div>
      <nav>{nav.map((item) => <button key={item.label} title={sidebarCollapsed ? item.label : undefined} className={view === item.label ? "active" : ""} onClick={() => { setView(item.label); setMenuOpen(false); }}><i>{item.icon}</i><span className="nav-label">{item.label}</span></button>)}</nav>
      <div className="sidebar-footer"><button className={`sidebar-settings ${view === "Configurações" ? "active" : ""}`} aria-label="Configurações" title="Configurações" onClick={() => { setView("Configurações"); setMenuOpen(false); }}><span className="settings-icon" aria-hidden="true">⚙</span><span className="nav-label">Configurações</span></button><button className="sidebar-logout" type="button" title="Sair da conta" onClick={logout}><span className="logout-icon" aria-hidden="true" /><span className="nav-label">Sair da conta</span></button></div>
    </aside>
    {menuOpen && <button className="backdrop" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
    <section className="workspace">
      <header className="topbar">
        <div className="topbar-title"><button className="menu-button" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}>☰</button><div><p className="eyebrow">Gestão contábil</p><h1>{view}</h1></div></div>
        <div className="header-actions"><span className="header-divider" aria-hidden="true" /><button className={`theme-button ${darkMode ? "active" : ""}`} type="button" aria-label="Alternar entre modo claro e escuro" aria-pressed={darkMode} title="Alternar modo claro e escuro" onClick={toggleTheme}><span aria-hidden="true">☼</span><span aria-hidden="true">☾</span></button><div className="logo-placeholder"><span>▣</span> Logo do cliente</div></div>
      </header>
      <div className="page-content">
        {loadError && <div className="notice error"><strong>Não foi possível carregar os dados</strong><p>Tente atualizar a página.</p></div>}
        {content}
      </div>
    </section>
  </main>;
}

function Loading() { return <div className="loading-grid">{Array.from({ length: 8 }).map((_, i) => <div className="skeleton" key={i} />)}</div>; }

function Settings({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [message, setMessage] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [vision, setVision] = useState<"default" | "colorblind">("default");
  const [fontSize, setFontSize] = useState<"small" | "normal" | "large">("normal");

  useEffect(() => {
    setVision(window.localStorage.getItem("controle-carteira-vision") === "colorblind" ? "colorblind" : "default");
    const savedSize = window.localStorage.getItem("controle-carteira-font-size");
    if (savedSize === "small" || savedSize === "large") setFontSize(savedSize);
  }, []);

  const applyVision = (value: "default" | "colorblind") => {
    setVision(value);
    window.localStorage.setItem("controle-carteira-vision", value);
    document.documentElement.dataset.vision = value;
  };

  const applyFontSize = (value: "small" | "normal" | "large") => {
    setFontSize(value);
    window.localStorage.setItem("controle-carteira-font-size", value);
    document.documentElement.dataset.fontSize = value;
  };

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (senha !== confirmacao) {
      setMessage("As senhas informadas não coincidem.");
      return;
    }
    setSavingPassword(true);
    const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senha }) });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setMessage(data.error ?? "Não foi possível atualizar a senha.");
      setSavingPassword(false);
      return;
    }
    setSenha("");
    setConfirmacao("");
    setMessage("Senha atualizada com sucesso.");
    setSavingPassword(false);
  };

  return <>
    <section className="section-head settings-heading"><div><p className="eyebrow">Conta e acessibilidade</p><h2>Configurações</h2><p>Gerencie suas informações, segurança e preferências de visualização.</p></div></section>
    <section className="settings-grid">
      <article className="panel account-card"><div className="account-avatar">{userName.slice(0, 2).toUpperCase()}</div><div><p className="settings-label">Conta conectada</p><h3>{userName}</h3><p>{userEmail}</p></div></article>
      <article className="panel settings-panel"><div className="settings-panel-head"><span>◉</span><div><h3>Redefinir senha</h3><p>Escolha uma nova senha com pelo menos 8 caracteres.</p></div></div><form className="settings-form" onSubmit={updatePassword}><label>Nova senha<input type="password" autoComplete="new-password" minLength={8} required value={senha} onChange={(event) => setSenha(event.target.value)} /></label><label>Confirmar nova senha<input type="password" autoComplete="new-password" minLength={8} required value={confirmacao} onChange={(event) => setConfirmacao(event.target.value)} /></label>{message && <p className={message.includes("sucesso") ? "settings-message success" : "settings-message error"}>{message}</p>}<button className="primary" disabled={savingPassword}>{savingPassword ? "Atualizando…" : "Atualizar senha"}</button></form></article>
      <article className="panel settings-panel"><div className="settings-panel-head"><span>◌</span><div><h3>Modo daltonismo</h3><p>Usa a paleta Okabe–Ito e indicadores textuais para não depender apenas de vermelho e verde.</p></div></div><div className="choice-group" role="radiogroup" aria-label="Modo daltonismo"><button type="button" className={vision === "default" ? "selected" : ""} role="radio" aria-checked={vision === "default"} onClick={() => applyVision("default")}><i className="palette-default" />Padrão</button><button type="button" className={vision === "colorblind" ? "selected" : ""} role="radio" aria-checked={vision === "colorblind"} onClick={() => applyVision("colorblind")}><i className="palette-colorblind" />Daltonismo</button></div></article>
      <article className="panel settings-panel"><div className="settings-panel-head"><span>Aa</span><div><h3>Tamanho da fonte</h3><p>Ajuste a leitura do sistema neste dispositivo.</p></div></div><div className="choice-group font-choices" role="radiogroup" aria-label="Tamanho da fonte">{([ ["small", "Menor"], ["normal", "Padrão"], ["large", "Maior"] ] as const).map(([value, label]) => <button type="button" key={value} className={fontSize === value ? "selected" : ""} role="radio" aria-checked={fontSize === value} onClick={() => applyFontSize(value)}><i className={`font-${value}`}>A</i>{label}</button>)}</div></article>
    </section>
  </>;
}

function Overview({ companies, issues, tasks, go }: { companies: Empresa[]; issues: Divergencia[]; tasks: Tarefa[]; go: (view: View) => void }) {
  const active = companies.filter((c) => c.status === "Ativa").length;
  const due = tasks.filter((t) => t.status !== "Concluída" && t.vencimento <= "2026-07-31").length;
  return <>
    <section className="hero"><div><Badge tone="blue">Carteira em acompanhamento</Badge><h2>Uma visão clara da sua operação.</h2><p>Centralize cadastros, encontre inconsistências e mantenha as entregas do escritório no prazo.</p></div><button className="primary" onClick={() => go("Onboarding")}>Cadastrar empresa <span>→</span></button></section>
    <section className="metrics"><Card title="Empresas na carteira" value={companies.length} helper={`${active} com situação ativa`} icon="▦" /><Card title="Divergências pendentes" value={issues.filter((i) => i.status === "Pendente").length} helper="Requerem uma decisão" icon="◇" /><Card title="Vencimentos da semana" value={due} helper="Inclui tarefas em atraso" icon="◷" /></section>
    <section className="section-head"><div><h2>Atalhos da operação</h2><p>Acesse rapidamente os principais fluxos.</p></div></section>
    <section className="quick-grid">
      {[ ["Onboarding", "＋", "Inclua empresas com dados pré-preenchidos por CNPJ."], ["Auditoria", "◈", "Revise divergências identificadas na base."], ["Análise", "▥", "Entenda a composição da sua carteira."], ["Calendário", "□", "Acompanhe obrigações e prazos recorrentes."] ].map(([title, icon, text]) => <button className="quick-card" key={title} onClick={() => go(title as View)}><span>{icon}</span><strong>{title}</strong><p>{text}</p><em>→</em></button>)}
    </section>
    <section className="two-columns"><article className="panel"><div className="panel-title"><div><h3>Próximos vencimentos</h3><p>Prioridades dos próximos dias</p></div><button onClick={() => go("Calendário")}>Ver calendário</button></div>{tasks.slice(0, 4).map((t) => <div className="task-line" key={t.id}><time>{formatDate(t.vencimento)}</time><div><strong>{t.titulo}</strong><small>{t.empresa || "Reunião interna"} · {t.responsavel}</small></div><Badge tone={t.status === "Atrasada" ? "danger" : "blue"}>{t.status}</Badge></div>)}</article><article className="panel"><div className="panel-title"><div><h3>Auditoria em foco</h3><p>Ocorrências pendentes por prioridade</p></div><button onClick={() => go("Auditoria")}>Revisar</button></div>{issues.filter((i) => i.status === "Pendente").slice(0, 4).map((i) => <div className="task-line" key={i.id}><span className="issue-dot">!</span><div><strong>{i.empresa}</strong><small>{i.tipo}</small></div><Badge tone="warning">Pendente</Badge></div>)}</article></section>
  </>;
}

function Onboarding({ companies, setCompanies, perfis, userName, setIssues }: {
  companies: Empresa[]; setCompanies: (value: Empresa[]) => void; perfis: { id: string; nome: string }[]; userName: string;
  setIssues: (issues: Divergencia[]) => void;
}) {
  const [cnpj, setCnpj] = useState(""); const [result, setResult] = useState<Empresa | null>(null); const [state, setState] = useState<"idle" | "loading" | "error" | "success">("idle"); const [message, setMessage] = useState(""); const [query, setQuery] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  useEffect(() => {
    if (!toastVisible) return;
    const id = setTimeout(() => setToastVisible(false), 3000);
    return () => clearTimeout(id);
  }, [toastVisible]);
  const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState("");
  const [responsavelId, setResponsavelId] = useState(""); const [observacoes, setObservacoes] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const toggleMenu = (id: string, target: HTMLElement) => {
    if (menuOpenId === id) { setMenuOpenId(null); setMenuAnchor(null); return; }
    const rect = target.getBoundingClientRect();
    setMenuAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuOpenId(id);
  };
  const closeMenu = () => { setMenuOpenId(null); setMenuAnchor(null); };
  const [editing, setEditing] = useState<Empresa | null>(null);
  const [editingPreview, setEditingPreview] = useState(false);
  const [deleting, setDeleting] = useState<Empresa | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false); const [deleteError, setDeleteError] = useState("");
  const lookup = async (e: FormEvent) => {
    e.preventDefault(); setState("loading");
    try {
      const data = await consultarCNPJ(cnpj); setResult(data); setState("success");
      setResponsavelId(""); setObservacoes("");
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível consultar";
      setMessage(`${semPontoFinal(bruta)}. Confira os números e tente novamente.`);
      setState("error");
    }
  };
  const save = async () => {
    if (!result) return;
    setSaving(true); setSaveError("");
    try {
      await salvarEmpresa({ ...result, responsavelId: responsavelId || null, observacoes });
    } catch (error) {
      // Nada foi persistido — a mensagem "não foi possível salvar" é exata aqui.
      const bruta = error instanceof Error ? error.message : "Não foi possível salvar a empresa";
      setSaveError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setSaving(false);
      return;
    }
    // Empresa já persistida: fecha o cartão de consulta e limpa o campo de
    // CNPJ imediatamente, para não sugerir "salvar de novo" e liberar o
    // campo para o próximo cadastro.
    setResult(null); setCnpj(""); setState("idle"); setResponsavelId(""); setObservacoes("");
    try {
      const atualizadas = await listarEmpresas();
      setCompanies(atualizadas);
      setMessage("Empresa salva na carteira com sucesso.");
      setToastVisible(true);
    } catch {
      // A empresa JÁ foi persistida no passo anterior — só a atualização da
      // lista falhou. Não reusar a mensagem de "não foi possível salvar"
      // aqui, ou o usuário pode clicar salvar de novo e duplicar o registro.
      setSaveError("Empresa salva, mas não foi possível atualizar a lista. Atualize a página.");
    }
    await revalidarAuditoriaSilenciosa(setIssues);
    setSaving(false);
  };
  const openEdit = (empresa: Empresa) => { closeMenu(); setEditing(empresa); };
  const handleEmpresaSalva = async (atualizada: Empresa) => {
    setCompanies(companies.map((c) => (c.id === atualizada.id ? atualizada : c)));
    setEditing(null);
    await revalidarAuditoriaSilenciosa(setIssues);
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteSaving(true); setDeleteError("");
    try {
      await excluirEmpresa(deleting.id);
      setCompanies(companies.filter((c) => c.id !== deleting.id));
      setDeleting(null);
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível excluir a empresa";
      setDeleteError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setDeleteSaving(false);
      return;
    }
    await revalidarAuditoriaSilenciosa(setIssues);
    setDeleteSaving(false);
  };
  const queryDigits = query.replace(/\D/g, "");
  const listed = companies.filter((c) => `${c.razaoSocial} ${c.fantasia} ${c.cnpj}`.toLowerCase().includes(query.toLowerCase()) || (queryDigits.length > 0 && c.cnpj.replace(/\D/g, "").includes(queryDigits)));
  return <>
    <section className="section-head"><div><h2>Novo cadastro</h2><p>Consulte o CNPJ para começar com os dados preenchidos.</p></div></section>
    <section className="panel onboarding"><form onSubmit={lookup}><label htmlFor="cnpj">CNPJ da empresa</label><div className="search-row"><input id="cnpj" value={cnpj} onChange={(e) => setCnpj(maskCNPJ(e.target.value))} onPaste={(e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); setCnpj(maskCNPJ(extrairCNPJDoTexto(e.clipboardData.getData("text")))); }} placeholder="00.000.000/0000-00" inputMode="numeric" /><button className="primary" disabled={state === "loading"}>{state === "loading" ? "Consultando…" : "Consultar"}</button></div><small>Consulta via BrasilAPI.</small></form>{state === "error" && <div className="notice error"><strong>Não encontramos esse CNPJ</strong><p>{message}</p></div>}</section>
    {result && <section className="detail-card"><div className="detail-heading"><div><Badge tone={statusTone(result.status)}>{result.status}</Badge><h2>{result.razaoSocial}</h2><p>{result.fantasia} · CNPJ {result.cnpj}</p></div><div className="detail-actions"><button type="button" className="secondary" onClick={() => setEditingPreview(true)}>Editar dados</button><button className="primary" onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar na carteira"}</button></div></div>
    {editingPreview && result && <EmpresaPreviewEditModal empresa={result} onClose={() => setEditingPreview(false)} onSave={(dados) => { setResult({ ...result, ...dados, status: dados.status as Empresa["status"], porte: dados.porte as Empresa["porte"], socios: dados.socios.map(formatarSocio) }); setEditingPreview(false); }} />}{saveError && <div className="notice error"><p>{saveError}</p></div>}<div className="details"><div><span>Endereço</span><strong>{result.endereco}, {result.cidade}/{result.estado}</strong></div><div><span>CNAE principal</span><strong>{result.cnaeCodigo || result.cnae ? `${result.cnaeCodigo} · ${result.cnae}` : "Não informado pela consulta"}</strong></div><div><span>Porte</span><strong>{result.porte}</strong></div><div><span>Responsável interno</span><select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>{perfis.length > 0 ? <><option value="">Sem responsável</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</> : <option value="">{userName}</option>}</select></div><div className="full"><details className="socios-dropdown"><summary>Quadro societário{result.socios.length > 0 ? ` (${result.socios.length})` : ""}</summary><div className="socios-list">{result.socios.length > 0 ? result.socios.map((s, i) => <p key={i} className="static-value">{s}</p>) : <p className="static-value">Nenhum sócio informado.</p>}</div></details></div><div className="full"><label htmlFor="obs">Observações internas</label><textarea id="obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Inclua orientações para o time responsável…" /></div></div></section>}
    {toastVisible && <div className="toast"><span>✓ {message}</span><button type="button" className="toast-close" aria-label="Fechar aviso" onClick={() => setToastVisible(false)}>×</button></div>}
    <section className="section-head table-head"><div><h2>Cadastros na carteira</h2><p>{companies.length} empresas registradas</p></div><input aria-label="Buscar empresa" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por empresa ou CNPJ" /></section>
    <section className="panel table-wrap"><table><thead><tr><th>Empresa</th><th>CNPJ</th><th>Localidade</th><th>Situação</th><th>Responsável</th><th></th></tr></thead><tbody>{listed.map((c) => <tr key={c.id}><td><strong>{c.razaoSocial}</strong><small>{c.fantasia}</small></td><td>{c.cnpj}</td><td>{c.cidade}/{c.estado}</td><td><Badge tone={statusTone(c.status)}>{c.status}</Badge></td><td>{c.responsavel}</td><td className="row-menu"><button className="icon-button" aria-label={`Mais opções — ${c.razaoSocial}`} onClick={(e) => toggleMenu(c.id, e.currentTarget)}>⋯</button>{menuOpenId === c.id && menuAnchor && <>
      <button type="button" className="menu-backdrop" aria-label="Fechar menu" onClick={closeMenu} />
      <div className="dropdown-menu" role="menu" style={{ top: menuAnchor.top, right: menuAnchor.right }}><button type="button" role="menuitem" onClick={() => openEdit(c)}>Editar</button><button type="button" role="menuitem" className="danger" onClick={() => { closeMenu(); setDeleting(c); setDeleteError(""); }}>Excluir</button></div>
    </>}</td></tr>)}</tbody></table>{listed.length === 0 && <Empty />}</section>
    {editing && <EmpresaEditModal empresa={editing} perfis={perfis} onClose={() => setEditing(null)} onSaved={handleEmpresaSalva} />}
    {deleting && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Confirmar exclusão"><div className="modal"><button type="button" className="close" onClick={() => setDeleting(null)} aria-label="Fechar">×</button><h2>Excluir empresa</h2><p>Tem certeza que deseja excluir <strong>{deleting.razaoSocial}</strong> da carteira? Divergências, tarefas e modelos de recorrência associados a ela também serão removidos. Essa ação não pode ser desfeita.</p>{deleteError && <div className="notice error"><p>{deleteError}</p></div>}<button type="button" className="primary danger" onClick={confirmDelete} disabled={deleteSaving}>{deleteSaving ? "Excluindo…" : "Excluir definitivamente"}</button></div></div>}
  </>;
}

// Tipos cuja correção real é editar o cadastro da empresa (CNPJ, endereço,
// CNAE, porte, situação) — "Razão social"/"Endereço" já têm "Aplicar
// sugestão" como correção real, e "Duplicidade" tem seu próprio modal.
const TIPOS_CORRIGIVEIS_NO_CADASTRO = new Set(["CNPJ inválido", "Situação irregular", "Dados ausentes"]);

// Um grupo de N empresas com o mesmo nome gera C(N,2) divergências de
// Duplicidade (uma por par), o que enche a tabela de Auditoria de linhas
// repetitivas dizendo a mesma coisa (mesmo nome, mesmo texto) — parece que
// "a mesma duplicidade" está se repetendo, quando na verdade são pares
// genuinamente diferentes dentro do mesmo grupo. Para a tabela, agrupamos
// (mesma busca em grafo do `ResolverDuplicidade`) e mostramos só 1 linha por
// grupo — resolver aquela linha já abre o modal com o grupo inteiro.
function clustersDuplicidadePendente(issues: Divergencia[]): { representanteId: string; empresas: number }[] {
  const pendentes = issues.filter((i) => i.tipo === "Duplicidade" && i.status === "Pendente" && i.empresaRelacionada);
  const visitados = new Set<string>();
  const grupos: { representanteId: string; empresas: number }[] = [];

  for (const base of pendentes) {
    if (visitados.has(base.id)) continue;

    const idsEmpresas = new Set<string>([base.empresaId, base.empresaRelacionada!.id]);
    let cresceu = true;
    while (cresceu) {
      cresceu = false;
      for (const d of pendentes) {
        if (!d.empresaRelacionada) continue;
        const a = d.empresaId, b = d.empresaRelacionada.id;
        if (idsEmpresas.has(a) && !idsEmpresas.has(b)) { idsEmpresas.add(b); cresceu = true; }
        if (idsEmpresas.has(b) && !idsEmpresas.has(a)) { idsEmpresas.add(a); cresceu = true; }
      }
    }

    const linhasDoGrupo = pendentes.filter((d) => d.empresaRelacionada && idsEmpresas.has(d.empresaId) && idsEmpresas.has(d.empresaRelacionada.id));
    linhasDoGrupo.forEach((d) => visitados.add(d.id));
    const representante = linhasDoGrupo.reduce((maisRecente, atual) => (new Date(atual.detectadoEm) > new Date(maisRecente.detectadoEm) ? atual : maisRecente), linhasDoGrupo[0]);
    grupos.push({ representanteId: representante.id, empresas: idsEmpresas.size });
  }

  return grupos;
}

// Quantos campos relevantes estão preenchidos — critério de desempate quando
// duas empresas do cluster têm o mesmo número de divergências (ver
// `divergenciasPendentes` abaixo, que é o critério principal).
function completudeCadastro(e: Empresa): number {
  return [e.fantasia, e.endereco, e.cnae, e.cnaeCodigo, e.responsavel, e.abertura, e.socios.length > 0 ? "x" : ""].filter(Boolean).length;
}

// Quantas divergências pendentes essa empresa tem contra o cache da última
// consulta à API (Razão social, Endereço, CNAE/dados ausentes, Situação
// irregular, CNPJ inválido) — critério principal para apontar qual cadastro
// do par/cluster é o mais confiável: um cadastro com todos os campos
// preenchidos mas endereço desatualizado tem menos valor que um levemente
// incompleto porém batendo com a fonte oficial. "Duplicidade" não conta —
// é o próprio motivo deste modal existir, não um problema de qualidade do
// cadastro em si.
function divergenciasPendentes(empresaId: string, issues: Divergencia[]): number {
  return issues.filter((i) => i.empresaId === empresaId && i.status === "Pendente" && i.tipo !== "Duplicidade").length;
}

function ResolverDuplicidade({ divergencia, issues, companies, onClose, onResolved }: {
  divergencia: Divergencia; issues: Divergencia[]; companies: Empresa[]; onClose: () => void; onResolved: (fechar: boolean) => void;
}) {
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  // Guarda síncrona contra dois cliques em rajada (ex.: um segundo clique
  // antes do React re-renderizar e desabilitar os botões via `excluindoId`)
  // acabarem chamando `excluir` duas vezes para empresas diferentes ao mesmo
  // tempo — `useState` sozinho não bloqueia isso a tempo porque a atualização
  // só é visível no próximo render.
  const excluindoEmAndamento = useRef(false);

  // Uma empresa pode ser duplicidade de mais de uma outra ao mesmo tempo —
  // cada par vira uma divergência própria (ver comentário em
  // app/api/auditoria/executar/route.ts sobre idempotência de Duplicidade).
  // Por isso reunimos aqui TODO o cluster, seguindo a cadeia de pares
  // transitivamente (A-B e B-C juntam A, B e C mesmo sem um par A-C direto)
  // — parar na busca direta fazia o cluster mostrado variar dependendo de
  // qual empresa/par especificamente foi clicado, quando deveria ser sempre
  // o mesmo grupo completo.
  const baseId = divergencia.empresaId;
  const idsDoCluster = new Set<string>([baseId]);
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const i of issues) {
      if (i.tipo !== "Duplicidade" || i.status !== "Pendente" || !i.empresaRelacionada) continue;
      const a = i.empresaId, b = i.empresaRelacionada.id;
      if (idsDoCluster.has(a) && !idsDoCluster.has(b)) { idsDoCluster.add(b); cresceu = true; }
      if (idsDoCluster.has(b) && !idsDoCluster.has(a)) { idsDoCluster.add(a); cresceu = true; }
    }
  }

  const cartoes = Array.from(idsDoCluster)
    .map((id) => companies.find((c) => c.id === id) ?? null)
    .filter((e): e is Empresa => e !== null && !excluidos.has(e.id))
    .sort((a, b) => divergenciasPendentes(a.id, issues) - divergenciasPendentes(b.id, issues) || completudeCadastro(b) - completudeCadastro(a));

  const melhorDivergencias = Math.min(Infinity, ...cartoes.map((e) => divergenciasPendentes(e.id, issues)));
  const melhorCompletude = Math.max(0, ...cartoes.filter((e) => divergenciasPendentes(e.id, issues) === melhorDivergencias).map(completudeCadastro));

  const excluir = async (id: string) => {
    if (excluindoEmAndamento.current) return;
    excluindoEmAndamento.current = true;
    setExcluindoId(id); setError("");
    try {
      await excluirEmpresa(id);
      const restantes = cartoes.filter((c) => c.id !== id);
      setExcluidos((prev) => new Set(prev).add(id));
      onResolved(restantes.length <= 1);
    } catch (err) {
      const bruta = err instanceof Error ? err.message : "Não foi possível excluir a empresa";
      setError(`${semPontoFinal(bruta)}. Tente novamente.`);
    } finally {
      excluindoEmAndamento.current = false;
      setExcluindoId(null);
    }
  };

  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Resolver duplicidade"><div className="modal duplicidade-modal">
    <button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button>
    <h2>Possível empresa duplicada</h2>
    <p>Estes cadastros parecem ser a mesma empresa. Compare os dados e exclua o(s) registro(s) duplicado(s) para manter a carteira consistente.</p>
    {error && <div className="notice error"><p>{error}</p></div>}
    {cartoes.length <= 1 && idsDoCluster.size > cartoes.length && <div className="notice"><p>As outras empresas deste grupo não estão mais na carteira — esta divergência será limpa na próxima revalidação.</p></div>}
    <div className="duplicidade-compare">{cartoes.map((e) => { const divs = divergenciasPendentes(e.id, issues); return <article key={e.id} className="duplicidade-card">
      {cartoes.length > 1 && <span className={`badge success duplicidade-badge${divs === melhorDivergencias && completudeCadastro(e) === melhorCompletude ? "" : " duplicidade-badge-oculto"}`}>Cadastro mais confiável</span>}
      <strong>{e.razaoSocial}</strong>
      <small>{e.fantasia} · CNPJ {e.cnpj}</small>
      <div className="segmento-card-grid">
        <div><span>Situação</span><strong>{e.status}</strong></div>
        <div><span>Porte</span><strong>{e.porte}</strong></div>
        <div><span>Localidade</span><strong>{e.cidade}/{e.estado}</strong></div>
        <div><span>Responsável</span><strong>{e.responsavel || "—"}</strong></div>
        <div className="full"><span>CNAE</span><strong>{e.cnaeCodigo ? `${e.cnaeCodigo} · ${e.cnae}` : e.cnae || "Não informado"}</strong></div>
        <div className="full"><span>Endereço</span><strong>{e.endereco || "Não informado"}</strong></div>
      </div>
      <details className="socios-dropdown">
        <summary>Quadro societário{e.socios.length > 0 ? ` (${e.socios.length})` : ""}</summary>
        <div className="socios-list">{e.socios.length > 0 ? e.socios.map((s, i) => <p key={i} className="static-value">{s}</p>) : <p className="static-value">Nenhum sócio informado.</p>}</div>
      </details>
      <button type="button" className="primary danger" onClick={() => excluir(e.id)} disabled={excluindoId !== null}>{excluindoId === e.id ? "Excluindo…" : "Excluir esta empresa"}</button>
    </article>; })}</div>
  </div></div>;
}

function Audit({ issues, setIssues, companies, setCompanies, perfis }: {
  issues: Divergencia[]; setIssues: (issues: Divergencia[]) => void;
  companies: Empresa[]; setCompanies: (value: Empresa[]) => void; perfis: { id: string; nome: string }[];
}) {
  const [type, setType] = useState("Todos"); const [status, setStatus] = useState("Pendente");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [corrigindo, setCorrigindo] = useState<Empresa | null>(null);
  const [duplicidade, setDuplicidade] = useState<Divergencia | null>(null);
  const types = ["Todos", ...Array.from(new Set(issues.map((d) => d.tipo)))];
  const clusters = clustersDuplicidadePendente(issues);
  const tamanhoPorRepresentante = new Map(clusters.map((c) => [c.representanteId, c.empresas]));
  const representantesDuplicidade = new Set(clusters.map((c) => c.representanteId));
  // Das divergências de Duplicidade Pendentes, só a linha "representante" de
  // cada grupo aparece na tabela — as outras (mesmo grupo, outro par) ficam
  // ocultas aqui, mas continuam existindo e resolvíveis via essa mesma linha
  // (o modal abre o grupo inteiro, não só o par específico da linha).
  const idsOcultosDuplicidade = new Set(
    issues
      .filter((i) => i.tipo === "Duplicidade" && i.status === "Pendente" && i.empresaRelacionada)
      .map((i) => i.id)
      .filter((id) => !representantesDuplicidade.has(id)),
  );
  const filtered = issues
    .filter((i) => (type === "Todos" || i.tipo === type) && (status === "Todos" || i.status === status) && !idsOcultosDuplicidade.has(i.id))
    // Mais recentes primeiro — usa `resolvidoEm` quando existe (histórico de
    // tratadas), senão `detectadoEm` (ainda pendentes).
    .sort((a, b) => new Date(b.resolvidoEm ?? b.detectadoEm).getTime() - new Date(a.resolvidoEm ?? a.detectadoEm).getTime());

  // Contagem dos cards de resumo: para "Duplicidade", conta grupos (não
  // pares) entre os Pendentes, pra não inflar o número com C(N,2) pares do
  // mesmo grupo — mesmo raciocínio da tabela.
  const contarTipo = (t: string) => {
    if (t !== "Duplicidade") return issues.filter((i) => i.tipo === t && (status === "Todos" || i.status === status)).length;
    let total = 0;
    if (status === "Todos" || status === "Pendente") total += clusters.length;
    if (status !== "Pendente") total += issues.filter((i) => i.tipo === "Duplicidade" && i.status !== "Pendente" && (status === "Todos" || i.status === status)).length;
    return total;
  };

  const refetch = async (falhaParcial: string) => {
    try {
      const atualizadas = await listarDivergencias();
      setIssues(atualizadas);
    } catch {
      // A ação em si já foi persistida no passo anterior — só a atualização
      // da lista falhou. Não reusar a mensagem de erro da ação, ou o usuário
      // pode repetir a ação já concluída (mesmo cuidado do `save()` do
      // Onboarding).
      setActionError(falhaParcial);
    }
  };

  const update = async (id: string, acao: "ignorar" | "aplicar_sugestao") => {
    setUpdatingId(id); setActionError("");
    try {
      await tratarDivergencia(id, acao);
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível atualizar a divergência";
      setActionError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setUpdatingId(null);
      return;
    }
    if (acao === "aplicar_sugestao") {
      // "aplicar_sugestao" escreve o valor sugerido direto na empresa — sem
      // recarregar `companies` aqui, a tela (tabela do Onboarding, outros
      // cards) continuaria mostrando o dado antigo mesmo com a correção já
      // persistida no banco.
      try {
        setCompanies(await listarEmpresas());
      } catch {
        setActionError("Sugestão aplicada, mas não foi possível atualizar a lista de empresas. Atualize a página.");
      }
    }
    await refetch("Divergência atualizada, mas não foi possível atualizar a lista. Atualize a página.");
    setUpdatingId(null);
  };

  const revalidar = async () => {
    setRevalidating(true); setActionError("");
    try {
      await executarAuditoria(true);
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível revalidar a carteira";
      setActionError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setRevalidating(false);
      return;
    }
    await refetch("Carteira revalidada, mas não foi possível atualizar a lista. Atualize a página.");
    setRevalidating(false);
  };

  const handleCadastroCorrigido = async (atualizada: Empresa) => {
    setCompanies(companies.map((c) => (c.id === atualizada.id ? atualizada : c)));
    setCorrigindo(null);
    await revalidarAuditoriaSilenciosa(setIssues);
  };

  const handleDuplicidadeResolvida = async (fechar: boolean) => {
    if (fechar) setDuplicidade(null);
    try {
      const atualizadas = await listarEmpresas();
      setCompanies(atualizadas);
    } catch {
      // A empresa já foi excluída com sucesso — só a atualização da lista falhou.
    }
    await revalidarAuditoriaSilenciosa(setIssues);
  };

  return <>
    <section className="section-head">
      <div><h2>Auditoria de clientes</h2><p>Inconsistências encontradas nos registros da carteira.</p></div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button className="primary" onClick={revalidar} disabled={revalidating}>{revalidating ? "Revalidando…" : "Revalidar carteira"}</button>
        <Badge tone="warning">{issues.filter((i) => i.status === "Pendente").length} pendentes</Badge>
      </div>
    </section>
    {actionError && <div className="notice error"><p>{actionError}</p></div>}
    <section className="audit-summary">{types.slice(1).map((t) => <article key={t}><span>{t === "CNPJ inválido" ? "#" : "!"}</span><strong>{contarTipo(t)}</strong><p>{t}</p></article>)}</section>
    <section className="filters"><label>Tipo<select value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t}>{t}</option>)}</select></label><label>Tratamento<select value={status} onChange={(e) => setStatus(e.target.value)}>{["Todos", "Pendente", "Revisado", "Ignorado"].map((s) => <option key={s}>{s}</option>)}</select></label></section>
    <section className="panel table-wrap"><table className="audit-table"><thead><tr><th>Empresa</th><th>Ocorrência</th><th>Valor atual</th><th>Sugestão</th><th>Status</th><th>Ações</th></tr></thead><tbody>{filtered.map((i) => { const empresaDaLinha = companies.find((c) => c.id === i.empresaId); const tamanhoGrupo = tamanhoPorRepresentante.get(i.id); return <tr key={i.id}><td><strong>{i.empresa}</strong></td><td><Badge tone="neutral">{i.tipo}</Badge></td><td>{tamanhoGrupo && tamanhoGrupo > 2 ? `${tamanhoGrupo} cadastros com nome parecido entre si` : i.atual}{i.status === "Revisado" && i.sugerido && <><br /><small className="static-value">corrigido para: {i.sugerido}</small></>}</td><td>{i.sugerido || "—"}</td><td><Badge tone={i.status === "Pendente" ? "warning" : i.status === "Revisado" ? "success" : "neutral"}>{i.status}</Badge><br /><small className="static-value">{formatDataHoraBrasilia(i.resolvidoEm ?? i.detectadoEm)}</small></td><td className="actions">
      {i.status !== "Revisado" ? <>
        {i.tipo === "Duplicidade" && <button onClick={() => setDuplicidade(i)} disabled={updatingId === i.id}>Resolver duplicidade</button>}
        {TIPOS_CORRIGIVEIS_NO_CADASTRO.has(i.tipo) && <button onClick={() => empresaDaLinha && setCorrigindo(empresaDaLinha)} disabled={updatingId === i.id || !empresaDaLinha}>Corrigir cadastro</button>}
        {i.sugerido && <button onClick={() => update(i.id, "aplicar_sugestao")} disabled={updatingId === i.id}>Aplicar sugestão</button>}
        {i.status === "Pendente" && <button onClick={() => update(i.id, "ignorar")} disabled={updatingId === i.id}>Ignorar</button>}
      </> : "—"}
    </td></tr>; })}</tbody></table>{filtered.length === 0 && <Empty title="Nenhuma ocorrência neste filtro" text="As divergências tratadas continuam disponíveis no histórico." />}</section>
    {corrigindo && <EmpresaEditModal empresa={corrigindo} perfis={perfis} onClose={() => setCorrigindo(null)} onSaved={handleCadastroCorrigido} />}
    {duplicidade && <ResolverDuplicidade divergencia={duplicidade} issues={issues} companies={companies} onClose={() => setDuplicidade(null)} onResolved={handleDuplicidadeResolvida} />}
  </>;
}

type SegmentoTipo = "estado" | "porte" | "cnae" | "status" | "idade";

function Analysis({ companies }: { companies: Empresa[] }) {
  const [state, setState] = useState("Todos"); const [size, setSize] = useState("Todos"); const [situation, setSituation] = useState("Todos"); const [search, setSearch] = useState("");
  const [segmento, setSegmento] = useState<{ titulo: string; empresas: Empresa[] } | null>(null);
  const anoAtual = new Date().getFullYear();
  const filtered = companies.filter((c) => (state === "Todos" || c.estado === state) && (size === "Todos" || c.porte === size) && (situation === "Todos" || c.status === situation) && `${c.razaoSocial} ${c.cnae}`.toLowerCase().includes(search.toLowerCase()));
  const count = (key: keyof Empresa) => Object.entries(filtered.reduce((a, c) => ({ ...a, [String(c[key])]: (a[String(c[key])] || 0) + 1 }), {} as Record<string, number>)).map(([name, value]) => ({ name, value }));
  const stateData = count("estado").sort((a, b) => b.value - a.value).slice(0, 7); const sizeData = count("porte"); const cnaeData = count("cnae").sort((a, b) => b.value - a.value).slice(0, 5); const statusData = count("status");
  const anoAbertura = (c: Empresa) => (c.abertura ? new Date(c.abertura).getFullYear() : null);
  const ages = [{ name: "até 3 anos", value: filtered.filter((c) => { const a = anoAbertura(c); return a !== null && a >= anoAtual - 3; }).length }, { name: "4 a 8 anos", value: filtered.filter((c) => { const a = anoAbertura(c); return a !== null && a >= anoAtual - 8 && a < anoAtual - 3; }).length }, { name: "9 a 15 anos", value: filtered.filter((c) => { const a = anoAbertura(c); return a !== null && a >= anoAtual - 15 && a < anoAtual - 8; }).length }, { name: "mais de 15", value: filtered.filter((c) => { const a = anoAbertura(c); return a !== null && a < anoAtual - 15; }).length }];

  const abrirSegmento = (tipo: SegmentoTipo, nome: string) => {
    let empresas: Empresa[];
    if (tipo === "idade") {
      empresas = filtered.filter((c) => {
        const a = anoAbertura(c);
        if (a === null) return false;
        if (nome === "até 3 anos") return a >= anoAtual - 3;
        if (nome === "4 a 8 anos") return a >= anoAtual - 8 && a < anoAtual - 3;
        if (nome === "9 a 15 anos") return a >= anoAtual - 15 && a < anoAtual - 8;
        return a < anoAtual - 15;
      });
    } else {
      empresas = filtered.filter((c) => String(c[tipo]) === nome);
    }
    setSegmento({ titulo: nome, empresas });
  };

  return <>
    <section className="section-head"><div><h2>Composição da carteira</h2><p>Explore o perfil dos clientes cadastrados.</p></div><Badge tone="blue">{filtered.length} empresas</Badge></section>
    <section className="filters analysis-filters"><input aria-label="Buscar por empresa ou CNAE" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar empresa ou atividade" />{[[state, setState, ["Todos", ...Array.from(new Set(companies.map((c) => c.estado)))]], [size, setSize, ["Todos", ...Array.from(new Set(companies.map((c) => c.porte)))]], [situation, setSituation, ["Todos", "Ativa", "Suspensa", "Baixada"]]].map(([value, setter, options], i) => <select key={i} value={value as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)}>{(options as string[]).map((o) => <option key={o}>{o}</option>)}</select>)}</section>
    {filtered.length === 0 ? <Empty title="Sem empresas para analisar" text="Nenhum cadastro corresponde aos filtros selecionados." /> : <Suspense fallback={<div className="chart-grid-loading">Carregando gráficos…</div>}><section className="chart-grid">
      <ChartCard title="Empresas por estado" hint="Clique para detalhar"><BarVisual data={stateData} onSelect={(nome) => abrirSegmento("estado", nome)} /></ChartCard>
      <ChartCard title="Distribuição por porte" hint="Clique para detalhar"><PieVisual data={sizeData} onSelect={(nome) => abrirSegmento("porte", nome)} /></ChartCard>
      <ChartCard title="Principais CNAEs" hint="Passe o mouse e clique para ver"><PieVisual data={cnaeData} legend={false} onSelect={(nome) => abrirSegmento("cnae", nome)} /></ChartCard>
      <ChartCard title="Situação cadastral" hint="Clique para detalhar"><PieVisual data={statusData} onSelect={(nome) => abrirSegmento("status", nome)} /></ChartCard>
      <ChartCard title="Tempo de abertura" hint="Clique para detalhar"><BarVisual data={ages} onSelect={(nome) => abrirSegmento("idade", nome)} /></ChartCard>
      <article className="chart-card insight"><span>✦</span><h3>Leitura rápida</h3><p><strong>{filtered.filter((c) => c.status === "Ativa").length} empresas</strong> estão ativas. O perfil mais comum é <strong>{sizeData.sort((a,b) => b.value-a.value)[0]?.name}</strong>.</p><small>Dados atualizados a partir dos cadastros da carteira.</small></article>
    </section></Suspense>}
    {segmento && <SegmentoModal titulo={segmento.titulo} empresas={segmento.empresas} onClose={() => setSegmento(null)} />}
  </>;
}
function ChartCard({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) { return <article className="chart-card"><h3>{title}{hint && <small className="chart-hint">{hint}</small>}</h3><div className="chart">{children}</div></article>; }

function SegmentoModal({ titulo, empresas, onClose }: { titulo: string; empresas: Empresa[]; onClose: () => void }) {
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={`Empresas — ${titulo}`}><div className="modal segmento-modal"><button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button><h2>{titulo}</h2><p>{empresas.length} {empresas.length === 1 ? "empresa encontrada" : "empresas encontradas"}</p>
    {empresas.length === 0 ? <Empty title="Nenhuma empresa aqui" text="Não há cadastros correspondentes a este grupo." /> : <div className="segmento-list">{empresas.map((e) => <article key={e.id} className="segmento-card">
      <div className="segmento-card-head"><strong>{e.razaoSocial}</strong><Badge tone={statusTone(e.status)}>{e.status}</Badge></div>
      <p className="segmento-card-sub">{e.fantasia} · CNPJ {e.cnpj}</p>
      <div className="segmento-card-grid">
        <div><span>Localidade</span><strong>{e.cidade}/{e.estado}</strong></div>
        <div><span>Porte</span><strong>{e.porte}</strong></div>
        <div><span>CNAE</span><strong>{e.cnaeCodigo ? `${e.cnaeCodigo} · ${e.cnae}` : e.cnae || "Não informado"}</strong></div>
        <div><span>Responsável</span><strong>{e.responsavel || "—"}</strong></div>
        <div className="full"><span>Endereço</span><strong>{e.endereco || "Não informado"}</strong></div>
      </div>
    </article>)}</div>}
  </div></div>;
}
