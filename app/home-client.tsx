"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  consultarCNPJ, divergencias as divergenciasMock, empresas as empresasMock, feriadosNacionais,
  listarDivergencias, listarEmpresas, listarTarefas, tarefas as tarefasMock,
  type Divergencia, type Empresa, type Tarefa,
} from "../src/services/portfolio";

type View = "Visão geral" | "Onboarding" | "Auditoria" | "Análise" | "Calendário";
const nav: { label: View; icon: string }[] = [
  { label: "Visão geral", icon: "⌂" }, { label: "Onboarding", icon: "＋" }, { label: "Auditoria", icon: "◈" },
  { label: "Análise", icon: "▥" }, { label: "Calendário", icon: "□" },
];
const cores = ["#2d6478", "#5d89a5", "#92b0bf", "#c8d9db", "#d9af72"];
const formatDate = (date: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00`));

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Card({ title, value, helper, icon }: { title: string; value: string | number; helper: string; icon: string }) {
  return <article className="metric-card"><span className="metric-icon">{icon}</span><p>{title}</p><strong>{value}</strong><small>{helper}</small></article>;
}

function Empty({ title = "Nenhum resultado encontrado", text = "Ajuste seus filtros ou tente novamente." }) {
  return <div className="empty"><span>⌕</span><strong>{title}</strong><p>{text}</p></div>;
}

export function HomeClient({ userName }: { userName: string }) {
  const [view, setView] = useState<View>("Visão geral");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [companies, setCompanies] = useState<Empresa[]>([]);
  const [issues, setIssues] = useState<Divergencia[]>([]);
  const [tasks, setTasks] = useState<Tarefa[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listarEmpresas(), listarDivergencias(), listarTarefas()]).then(([c, d, t]) => {
      setCompanies(c); setIssues(d); setTasks(t); setLoading(false);
    });
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
    view === "Onboarding" ? <Onboarding companies={companies} setCompanies={setCompanies} /> :
    view === "Auditoria" ? <Audit issues={issues} setIssues={setIssues} /> :
    view === "Análise" ? <Analysis companies={companies} /> : <Calendar tasks={tasks} setTasks={setTasks} companies={companies} />
  );

  return <main className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
    <aside className={`sidebar ${menuOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="Navegação principal">
      <div className="brand">
        <div className="brand-identity"><span className="brand-mark">▣</span><span className="brand-name">Controle de carteira</span></div>
        <button className="sidebar-toggle" type="button" title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"} aria-label={sidebarCollapsed ? "Expandir navegação" : "Recolher navegação"} onClick={() => setSidebarCollapsed((current) => !current)}><span className="sidebar-glyph" aria-hidden="true" /></button>
      </div>
      <nav>{nav.map((item) => <button key={item.label} title={sidebarCollapsed ? item.label : undefined} className={view === item.label ? "active" : ""} onClick={() => { setView(item.label); setMenuOpen(false); }}><i>{item.icon}</i><span className="nav-label">{item.label}</span></button>)}</nav>
      <div className="sidebar-footer"><button className="sidebar-settings" aria-label="Configurações" title="Configurações"><span className="settings-icon" aria-hidden="true">⚙</span><span className="nav-label">Configurações</span></button><button className="sidebar-logout" type="button" title="Sair da conta" onClick={logout}><span className="logout-icon" aria-hidden="true" /><span className="nav-label">Sair da conta</span></button></div>
    </aside>
    {menuOpen && <button className="backdrop" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
    <section className="workspace">
      <header className="topbar">
        <div className="topbar-title"><button className="menu-button" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}>☰</button><div><p className="eyebrow">Gestão contábil</p><h1>{view}</h1></div></div>
        <div className="header-actions"><span className="header-divider" aria-hidden="true" /><button className={`theme-button ${darkMode ? "active" : ""}`} type="button" aria-label="Alternar entre modo claro e escuro" aria-pressed={darkMode} title="Alternar modo claro e escuro" onClick={toggleTheme}><span aria-hidden="true">☼</span><span aria-hidden="true">☾</span></button><div className="logo-placeholder"><span>▣</span> Logo do cliente</div></div>
      </header>
      <div className="page-content">{content}</div>
    </section>
  </main>;
}

function Loading() { return <div className="loading-grid">{Array.from({ length: 8 }).map((_, i) => <div className="skeleton" key={i} />)}</div>; }

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
    <section className="two-columns"><article className="panel"><div className="panel-title"><div><h3>Próximos vencimentos</h3><p>Prioridades dos próximos dias</p></div><button onClick={() => go("Calendário")}>Ver calendário</button></div>{tasks.slice(0, 4).map((t) => <div className="task-line" key={t.id}><time>{formatDate(t.vencimento)}</time><div><strong>{t.titulo}</strong><small>{t.empresa} · {t.responsavel}</small></div><Badge tone={t.status === "Atrasada" ? "danger" : "blue"}>{t.status}</Badge></div>)}</article><article className="panel"><div className="panel-title"><div><h3>Auditoria em foco</h3><p>Ocorrências pendentes por prioridade</p></div><button onClick={() => go("Auditoria")}>Revisar</button></div>{issues.filter((i) => i.status === "Pendente").slice(0, 4).map((i) => <div className="task-line" key={i.id}><span className="issue-dot">!</span><div><strong>{i.empresa}</strong><small>{i.tipo}</small></div><Badge tone="warning">Pendente</Badge></div>)}</article></section>
  </>;
}

function Onboarding({ companies, setCompanies }: { companies: Empresa[]; setCompanies: (value: Empresa[]) => void }) {
  const [cnpj, setCnpj] = useState(""); const [result, setResult] = useState<Empresa | null>(null); const [state, setState] = useState<"idle" | "loading" | "error" | "success">("idle"); const [message, setMessage] = useState(""); const [query, setQuery] = useState("");
  const mask = (v: string) => v.replace(/\D/g, "").slice(0, 14).replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  const lookup = async (e: FormEvent) => { e.preventDefault(); setState("loading"); try { const data = await consultarCNPJ(cnpj); setResult(data); setState("success"); } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível consultar"); setState("error"); } };
  const save = () => { if (!result) return; setCompanies([{ ...result, id: Math.max(...companies.map((c) => c.id)) + 1 }, ...companies]); setMessage("Empresa salva na carteira com sucesso."); };
  const listed = companies.filter((c) => `${c.razaoSocial} ${c.cnpj}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <section className="section-head"><div><h2>Novo cadastro</h2><p>Consulte o CNPJ para começar com os dados preenchidos.</p></div></section>
    <section className="panel onboarding"><form onSubmit={lookup}><label htmlFor="cnpj">CNPJ da empresa</label><div className="search-row"><input id="cnpj" value={cnpj} onChange={(e) => setCnpj(mask(e.target.value))} placeholder="00.000.000/0000-00" inputMode="numeric" /><button className="primary" disabled={state === "loading"}>{state === "loading" ? "Consultando…" : "Consultar"}</button></div><small>Consulta simulada. A integração com a BrasilAPI fica isolada no serviço.</small></form>{state === "error" && <div className="notice error"><strong>Não encontramos esse CNPJ</strong><p>{message}. Confira os números e tente novamente.</p></div>}</section>
    {result && <section className="detail-card"><div className="detail-heading"><div><Badge tone="success">{result.status}</Badge><h2>{result.razaoSocial}</h2><p>{result.fantasia} · CNPJ {result.cnpj}</p></div><button className="primary" onClick={save}>Salvar na carteira</button></div><div className="details"><div><span>Endereço</span><strong>{result.endereco}, {result.cidade}/{result.estado}</strong></div><div><span>CNAE principal</span><strong>{result.cnaeCodigo} · {result.cnae}</strong></div><div><span>Porte</span><strong>{result.porte}</strong></div><div><span>Responsável interno</span><select defaultValue={result.responsavel}><option>Mariana Costa</option><option>Lucas Ferreira</option><option>Ana Ribeiro</option></select></div><div className="full"><span>Quadro societário</span><strong>{result.socios.join(" · ")}</strong></div><div className="full"><label htmlFor="obs">Observações internas</label><textarea id="obs" placeholder="Inclua orientações para o time responsável…" /></div></div></section>}
    {message.includes("sucesso") && <div className="toast">✓ {message}</div>}
    <section className="section-head table-head"><div><h2>Cadastros na carteira</h2><p>{companies.length} empresas registradas</p></div><input aria-label="Buscar empresa" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por empresa ou CNPJ" /></section>
    <section className="panel table-wrap"><table><thead><tr><th>Empresa</th><th>CNPJ</th><th>Localidade</th><th>Situação</th><th>Responsável</th><th></th></tr></thead><tbody>{listed.slice(0, 8).map((c) => <tr key={c.id}><td><strong>{c.razaoSocial}</strong><small>{c.fantasia}</small></td><td>{c.cnpj}</td><td>{c.cidade}/{c.estado}</td><td><Badge tone={c.status === "Ativa" ? "success" : c.status === "Suspensa" ? "warning" : "danger"}>{c.status}</Badge></td><td>{c.responsavel}</td><td><button className="icon-button" aria-label={`Editar ${c.razaoSocial}`}>⋯</button></td></tr>)}</tbody></table>{listed.length === 0 && <Empty />}</section>
  </>;
}

function Audit({ issues, setIssues }: { issues: Divergencia[]; setIssues: (issues: Divergencia[]) => void }) {
  const [type, setType] = useState("Todos"); const [status, setStatus] = useState("Todos");
  const types = ["Todos", ...Array.from(new Set(divergenciasMock.map((d) => d.tipo)))];
  const filtered = issues.filter((i) => (type === "Todos" || i.tipo === type) && (status === "Todos" || i.status === status));
  const update = (id: number, next: Divergencia["status"]) => setIssues(issues.map((i) => i.id === id ? { ...i, status: next } : i));
  return <>
    <section className="section-head"><div><h2>Auditoria de clientes</h2><p>Inconsistências encontradas nos registros da carteira.</p></div><Badge tone="warning">{issues.filter((i) => i.status === "Pendente").length} pendentes</Badge></section>
    <section className="audit-summary">{types.slice(1).map((t) => <article key={t}><span>{t === "CNPJ inválido" ? "#" : "!"}</span><strong>{issues.filter((i) => i.tipo === t).length}</strong><p>{t}</p></article>)}</section>
    <section className="filters"><label>Tipo<select value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t}>{t}</option>)}</select></label><label>Tratamento<select value={status} onChange={(e) => setStatus(e.target.value)}>{["Todos", "Pendente", "Revisado", "Ignorado"].map((s) => <option key={s}>{s}</option>)}</select></label></section>
    <section className="panel table-wrap"><table className="audit-table"><thead><tr><th>Empresa</th><th>Ocorrência</th><th>Valor atual</th><th>Sugestão</th><th>Status</th><th>Ações</th></tr></thead><tbody>{filtered.map((i) => <tr key={i.id}><td><strong>{i.empresa}</strong></td><td><Badge tone="neutral">{i.tipo}</Badge></td><td>{i.atual}</td><td>{i.sugerido || "—"}</td><td><Badge tone={i.status === "Pendente" ? "warning" : i.status === "Revisado" ? "success" : "neutral"}>{i.status}</Badge></td><td className="actions"><button onClick={() => update(i.id, "Revisado")}>Corrigir</button><button onClick={() => update(i.id, "Ignorado")}>Ignorar</button></td></tr>)}</tbody></table>{filtered.length === 0 && <Empty title="Nenhuma ocorrência neste filtro" text="As divergências tratadas continuam disponíveis no histórico." />}</section>
  </>;
}

function Analysis({ companies }: { companies: Empresa[] }) {
  const [state, setState] = useState("Todos"); const [size, setSize] = useState("Todos"); const [situation, setSituation] = useState("Todos"); const [search, setSearch] = useState("");
  const filtered = companies.filter((c) => (state === "Todos" || c.estado === state) && (size === "Todos" || c.porte === size) && (situation === "Todos" || c.status === situation) && `${c.razaoSocial} ${c.cnae}`.toLowerCase().includes(search.toLowerCase()));
  const count = (key: keyof Empresa) => Object.entries(filtered.reduce((a, c) => ({ ...a, [String(c[key])]: (a[String(c[key])] || 0) + 1 }), {} as Record<string, number>)).map(([name, value]) => ({ name, value }));
  const stateData = count("estado").sort((a, b) => b.value - a.value).slice(0, 7); const sizeData = count("porte"); const cnaeData = count("cnae").sort((a, b) => b.value - a.value).slice(0, 5); const statusData = count("status");
  const ages = [{ name: "até 3 anos", value: filtered.filter((c) => c.abertura >= 2023).length }, { name: "4 a 8 anos", value: filtered.filter((c) => c.abertura >= 2018 && c.abertura < 2023).length }, { name: "9 a 15 anos", value: filtered.filter((c) => c.abertura >= 2011 && c.abertura < 2018).length }, { name: "mais de 15", value: filtered.filter((c) => c.abertura < 2011).length }];
  return <>
    <section className="section-head"><div><h2>Composição da carteira</h2><p>Explore o perfil dos clientes cadastrados.</p></div><Badge tone="blue">{filtered.length} empresas</Badge></section>
    <section className="filters analysis-filters"><input aria-label="Buscar por empresa ou CNAE" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar empresa ou atividade" />{[[state, setState, ["Todos", ...Array.from(new Set(companies.map((c) => c.estado)))]], [size, setSize, ["Todos", ...Array.from(new Set(companies.map((c) => c.porte)))]], [situation, setSituation, ["Todos", "Ativa", "Suspensa", "Baixada"]]].map(([value, setter, options], i) => <select key={i} value={value as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)}>{(options as string[]).map((o) => <option key={o}>{o}</option>)}</select>)}</section>
    {filtered.length === 0 ? <Empty title="Sem empresas para analisar" text="Nenhum cadastro corresponde aos filtros selecionados." /> : <section className="chart-grid"><ChartCard title="Empresas por estado"><BarVisual data={stateData} /></ChartCard><ChartCard title="Distribuição por porte"><PieVisual data={sizeData} /></ChartCard><ChartCard title="Principais CNAEs"><BarVisual data={cnaeData} /></ChartCard><ChartCard title="Situação cadastral"><PieVisual data={statusData} /></ChartCard><ChartCard title="Tempo de abertura"><BarVisual data={ages} /></ChartCard><article className="chart-card insight"><span>✦</span><h3>Leitura rápida</h3><p><strong>{filtered.filter((c) => c.status === "Ativa").length} empresas</strong> estão ativas. O perfil mais comum é <strong>{sizeData.sort((a,b) => b.value-a.value)[0]?.name}</strong>.</p><small>Dados atualizados a partir dos cadastros mockados.</small></article></section>}
  </>;
}
function ChartCard({ title, children }: { title: string; children: ReactNode }) { return <article className="chart-card"><h3>{title}</h3><div className="chart">{children}</div></article>; }
function BarVisual({ data }: { data: { name: string; value: number }[] }) { return <ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ left: 6, right: 12 }}><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11, fill: "#617179" }} axisLine={false} tickLine={false} /><Tooltip cursor={false} /><Bar dataKey="value" fill="#2d6478" radius={[0, 5, 5, 0]} barSize={14} /></BarChart></ResponsiveContainer>; }
function PieVisual({ data }: { data: { name: string; value: number }[] }) { return <div className="pie-layout"><ResponsiveContainer width="55%" height="100%"><PieChart><Pie data={data} dataKey="value" innerRadius={42} outerRadius={72} paddingAngle={3}>{data.map((_, i) => <Cell key={i} fill={cores[i % cores.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="legend">{data.map((d, i) => <p key={d.name}><i style={{ background: cores[i % cores.length] }} />{d.name}<strong>{d.value}</strong></p>)}</div></div>; }

function Calendar({ tasks, setTasks, companies }: { tasks: Tarefa[]; setTasks: (tasks: Tarefa[]) => void; companies: Empresa[] }) {
  const [mode, setMode] = useState<"month" | "list">("month"); const [responsible, setResponsible] = useState("Todos"); const [open, setOpen] = useState(false); const [draft, setDraft] = useState({ titulo: "", empresa: companies[0]?.fantasia || "", responsavel: "Mariana Costa", vencimento: "2026-08-10" });
  const people = ["Todos", ...Array.from(new Set(tasks.map((t) => t.responsavel)))]; const shown = tasks.filter((t) => responsible === "Todos" || t.responsavel === responsible);
  const add = (e: FormEvent) => { e.preventDefault(); setTasks([{ id: Date.now(), ...draft, tipo: "Contábil", status: "Pendente" }, ...tasks]); setOpen(false); };
  const monthDays = Array.from({ length: 31 }, (_, i) => i + 1);
  return <>
    <section className="section-head"><div><h2>Calendário contábil</h2><p>Agosto de 2026 · obrigações e rotinas da carteira.</p></div><button className="primary" onClick={() => setOpen(true)}>+ Nova tarefa</button></section>
    <section className="calendar-toolbar"><div className="tabs"><button className={mode === "month" ? "selected" : ""} onClick={() => setMode("month")}>Calendário</button><button className={mode === "list" ? "selected" : ""} onClick={() => setMode("list")}>Lista</button></div><label>Responsável <select value={responsible} onChange={(e) => setResponsible(e.target.value)}>{people.map((p) => <option key={p}>{p}</option>)}</select></label></section>
    {mode === "month" ? <section className="calendar"><div className="weekdays">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <span key={d}>{d}</span>)}</div><div className="day-grid">{Array.from({ length: 6 }, (_, i) => <div className="day muted" key={`blank-${i}`} />)}{monthDays.map((day) => { const date = `2026-08-${String(day).padStart(2, "0")}`; const items = shown.filter((t) => t.vencimento === date); const holiday = feriadosNacionais.includes(date); return <div className={`day ${holiday ? "holiday" : ""}`} key={day}><span>{day}</span>{holiday && <small>Feriado</small>}{items.map((t) => <button className={`calendar-task ${t.status === "Atrasada" ? "late" : ""}`} key={t.id} title={`${t.empresa} · ${t.responsavel}`}>{t.titulo}</button>)}</div>; })}</div></section> : <section className="panel list-tasks">{shown.map((t) => <div className="task-line" key={t.id}><time>{formatDate(t.vencimento)}</time><div><strong>{t.titulo}</strong><small>{t.empresa} · {t.responsavel} · {t.tipo}</small></div>{feriadosNacionais.includes(t.vencimento) && <Badge tone="warning">Feriado</Badge>}<Badge tone={t.status === "Atrasada" ? "danger" : t.status === "Concluída" ? "success" : "blue"}>{t.status}</Badge></div>)}</section>}
    {open && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Nova tarefa"><form className="modal" onSubmit={add}><button type="button" className="close" onClick={() => setOpen(false)} aria-label="Fechar">×</button><h2>Nova tarefa recorrente</h2><p>Cadastre a próxima obrigação da carteira.</p><label>Título<input required value={draft.titulo} onChange={(e) => setDraft({ ...draft, titulo: e.target.value })} placeholder="Ex.: Conferência de documentos" /></label><label>Empresa<select value={draft.empresa} onChange={(e) => setDraft({ ...draft, empresa: e.target.value })}>{companies.map((c) => <option key={c.id}>{c.fantasia}</option>)}</select></label><label>Responsável<select value={draft.responsavel} onChange={(e) => setDraft({ ...draft, responsavel: e.target.value })}>{people.slice(1).map((p) => <option key={p}>{p}</option>)}</select></label><label>Vencimento<input type="date" value={draft.vencimento} onChange={(e) => setDraft({ ...draft, vencimento: e.target.value })} /></label><button className="primary">Salvar tarefa</button></form></div>}
  </>;
}
