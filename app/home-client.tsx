"use client";

import { ClipboardEvent, FormEvent, ReactNode, useEffect, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { extrairCNPJDoTexto, validarCNPJ } from "../lib/cnpj";
import {
  atualizarEmpresa, atualizarModeloRecorrencia, atualizarTarefa, consultarCNPJ, criarModeloRecorrencia, criarTarefa,
  executarAuditoria, excluirEmpresa, listarDivergencias, listarEmpresas, listarModelosRecorrencia, listarPerfis,
  listarTarefas, salvarEmpresa, tratarDivergencia,
  type Divergencia, type Empresa, type ModeloRecorrencia, type Periodicidade, type Tarefa,
} from "../src/services/portfolio";

type View = "Visão geral" | "Onboarding" | "Auditoria" | "Análise" | "Calendário";
const nav: { label: View; icon: string }[] = [
  { label: "Visão geral", icon: "⌂" }, { label: "Onboarding", icon: "＋" }, { label: "Auditoria", icon: "◈" },
  { label: "Análise", icon: "▥" }, { label: "Calendário", icon: "□" },
];
const cores = ["#2d6478", "#5d89a5", "#92b0bf", "#c8d9db", "#d9af72"];
const formatDate = (date: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00`));
/** Evita "...obrigatórios.. Tente novamente." quando a mensagem do servidor já termina em ponto. */
const semPontoFinal = (mensagem: string) => mensagem.replace(/\.+$/, "");

type EmpresaEditDraft = {
  cnpj: string; razaoSocial: string; fantasia: string; cidade: string; estado: string; endereco: string;
  status: string; porte: string; cnaeCodigo: string; cnae: string; responsavelId: string; observacoes: string;
};
const paraEditDraft = (empresa: Empresa): EmpresaEditDraft => ({
  cnpj: empresa.cnpj, razaoSocial: empresa.razaoSocial, fantasia: empresa.fantasia, cidade: empresa.cidade, estado: empresa.estado,
  endereco: empresa.endereco, status: empresa.status, porte: empresa.porte,
  cnaeCodigo: empresa.cnaeCodigo, cnae: empresa.cnae,
  responsavelId: empresa.responsavelId ?? "", observacoes: empresa.observacoes ?? "",
});
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
        cnaeCodigo: draft.cnaeCodigo, cnaeDescricao: draft.cnae,
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
    <label className="full">Responsável interno<select value={draft.responsavelId} onChange={(e) => setDraft({ ...draft, responsavelId: e.target.value })}><option value="">Selecione…</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
    <label className="full">Observações internas<textarea value={draft.observacoes} onChange={(e) => setDraft({ ...draft, observacoes: e.target.value })} /></label>
  </div>{!cnpjValido && <div className="notice error"><p>CNPJ inválido — confira os números antes de salvar.</p></div>}{error && <div className="notice error"><p>{error}</p></div>}<button className="primary" disabled={saving || !cnpjValido}>{saving ? "Salvando…" : "Salvar alterações"}</button></form></div>;
}

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

  const content = loading ? <Loading /> : (
    view === "Visão geral" ? <Overview companies={companies} issues={issues} tasks={tasks} go={setView} /> :
    view === "Onboarding" ? <Onboarding companies={companies} setCompanies={setCompanies} perfis={perfis} userName={userName} setIssues={setIssues} /> :
    view === "Auditoria" ? <Audit issues={issues} setIssues={setIssues} companies={companies} setCompanies={setCompanies} perfis={perfis} /> :
    view === "Análise" ? <Analysis companies={companies} /> : <Calendar tasks={tasks} setTasks={setTasks} companies={companies} perfis={perfis} />
  );

  return <main className="app-shell">
    <aside className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Navegação principal">
      <div className="brand"><span className="brand-mark">▣</span><span>Controle de carteira</span></div>
      <nav>{nav.map((item) => <button key={item.label} className={view === item.label ? "active" : ""} onClick={() => { setView(item.label); setMenuOpen(false); }}><i>{item.icon}</i>{item.label}</button>)}</nav>
      <div className="sidebar-footer"><span className="avatar">{userName.slice(0, 2).toUpperCase()}</span><div><strong>{userName}</strong><small>Administradora</small></div><button aria-label="Configurações">⚙</button></div>
    </aside>
    {menuOpen && <button className="backdrop" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
    <section className="workspace">
      <header className="topbar"><button className="menu-button" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}>☰</button><div><p className="eyebrow">Gestão contábil</p><h1>{view}</h1></div><div className="logo-placeholder"><span>▣</span> Logo do cliente</div></header>
      <div className="page-content">
        {loadError && <div className="notice error"><strong>Não foi possível carregar os dados</strong><p>Tente atualizar a página.</p></div>}
        {content}
      </div>
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

function Onboarding({ companies, setCompanies, perfis, userName, setIssues }: {
  companies: Empresa[]; setCompanies: (value: Empresa[]) => void; perfis: { id: string; nome: string }[]; userName: string;
  setIssues: (issues: Divergencia[]) => void;
}) {
  const [cnpj, setCnpj] = useState(""); const [result, setResult] = useState<Empresa | null>(null); const [state, setState] = useState<"idle" | "loading" | "error" | "success">("idle"); const [message, setMessage] = useState(""); const [query, setQuery] = useState("");
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
    try {
      const atualizadas = await listarEmpresas();
      setCompanies(atualizadas);
      setMessage("Empresa salva na carteira com sucesso.");
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
    {result && <section className="detail-card"><div className="detail-heading"><div><Badge tone="success">{result.status}</Badge><h2>{result.razaoSocial}</h2><p>{result.fantasia} · CNPJ {result.cnpj}</p></div><button className="primary" onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar na carteira"}</button></div>{saveError && <div className="notice error"><p>{saveError}</p></div>}<div className="details"><div><span>Endereço</span><strong>{result.endereco}, {result.cidade}/{result.estado}</strong></div><div><span>CNAE principal</span><strong>{result.cnaeCodigo} · {result.cnae}</strong></div><div><span>Porte</span><strong>{result.porte}</strong></div><div><span>Responsável interno</span><select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>{perfis.length > 0 ? <><option value="">Selecione…</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</> : <option value="">{userName}</option>}</select></div><div className="full"><span>Quadro societário</span><strong>{result.socios.join(" · ")}</strong></div><div className="full"><label htmlFor="obs">Observações internas</label><textarea id="obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Inclua orientações para o time responsável…" /></div></div></section>}
    {message.includes("sucesso") && <div className="toast">✓ {message}</div>}
    <section className="section-head table-head"><div><h2>Cadastros na carteira</h2><p>{companies.length} empresas registradas</p></div><input aria-label="Buscar empresa" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por empresa ou CNPJ" /></section>
    <section className="panel table-wrap"><table><thead><tr><th>Empresa</th><th>CNPJ</th><th>Localidade</th><th>Situação</th><th>Responsável</th><th></th></tr></thead><tbody>{listed.slice(0, 8).map((c) => <tr key={c.id}><td><strong>{c.razaoSocial}</strong><small>{c.fantasia}</small></td><td>{c.cnpj}</td><td>{c.cidade}/{c.estado}</td><td><Badge tone={c.status === "Ativa" ? "success" : c.status === "Suspensa" ? "warning" : "danger"}>{c.status}</Badge></td><td>{c.responsavel}</td><td className="row-menu"><button className="icon-button" aria-label={`Mais opções — ${c.razaoSocial}`} onClick={(e) => toggleMenu(c.id, e.currentTarget)}>⋯</button>{menuOpenId === c.id && menuAnchor && <>
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

function ResolverDuplicidade({ divergencia, companies, onClose, onResolved }: {
  divergencia: Divergencia; companies: Empresa[]; onClose: () => void; onResolved: () => void;
}) {
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const empresaAtual = companies.find((c) => c.id === divergencia.empresaId) ?? null;
  const relacionada = divergencia.empresaRelacionada ?? null;
  const cartoes = [empresaAtual, relacionada].filter((e): e is NonNullable<typeof e> => e !== null);

  const excluir = async (id: string) => {
    setExcluindoId(id); setError("");
    try {
      await excluirEmpresa(id);
      onResolved();
    } catch (err) {
      const bruta = err instanceof Error ? err.message : "Não foi possível excluir a empresa";
      setError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setExcluindoId(null);
    }
  };

  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Resolver duplicidade"><div className="modal">
    <button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button>
    <h2>Possível empresa duplicada</h2>
    <p>Estes cadastros parecem ser a mesma empresa. Exclua o registro duplicado para manter a carteira consistente.</p>
    {error && <div className="notice error"><p>{error}</p></div>}
    {!relacionada && <div className="notice"><p>A outra empresa deste par não está mais na carteira — esta divergência será limpa na próxima revalidação.</p></div>}
    <div className="duplicidade-compare">{cartoes.map((e) => <article key={e.id} className="duplicidade-card">
      <strong>{e.razaoSocial}</strong>
      <small>CNPJ {e.cnpj}</small>
      <small>{e.cidade}/{e.estado} · {e.status}</small>
      <button type="button" className="primary danger" onClick={() => excluir(e.id)} disabled={excluindoId !== null}>{excluindoId === e.id ? "Excluindo…" : "Excluir esta empresa"}</button>
    </article>)}</div>
  </div></div>;
}

function Audit({ issues, setIssues, companies, setCompanies, perfis }: {
  issues: Divergencia[]; setIssues: (issues: Divergencia[]) => void;
  companies: Empresa[]; setCompanies: (value: Empresa[]) => void; perfis: { id: string; nome: string }[];
}) {
  const [type, setType] = useState("Todos"); const [status, setStatus] = useState("Todos");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [corrigindo, setCorrigindo] = useState<Empresa | null>(null);
  const [duplicidade, setDuplicidade] = useState<Divergencia | null>(null);
  const types = ["Todos", ...Array.from(new Set(issues.map((d) => d.tipo)))];
  const filtered = issues.filter((i) => (type === "Todos" || i.tipo === type) && (status === "Todos" || i.status === status));

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

  const handleDuplicidadeResolvida = async () => {
    setDuplicidade(null);
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
    <section className="audit-summary">{types.slice(1).map((t) => <article key={t}><span>{t === "CNPJ inválido" ? "#" : "!"}</span><strong>{issues.filter((i) => i.tipo === t).length}</strong><p>{t}</p></article>)}</section>
    <section className="filters"><label>Tipo<select value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t}>{t}</option>)}</select></label><label>Tratamento<select value={status} onChange={(e) => setStatus(e.target.value)}>{["Todos", "Pendente", "Revisado", "Ignorado"].map((s) => <option key={s}>{s}</option>)}</select></label></section>
    <section className="panel table-wrap"><table className="audit-table"><thead><tr><th>Empresa</th><th>Ocorrência</th><th>Valor atual</th><th>Sugestão</th><th>Status</th><th>Ações</th></tr></thead><tbody>{filtered.map((i) => { const empresaDaLinha = companies.find((c) => c.id === i.empresaId); return <tr key={i.id}><td><strong>{i.empresa}</strong></td><td><Badge tone="neutral">{i.tipo}</Badge></td><td>{i.atual}</td><td>{i.sugerido || "—"}</td><td><Badge tone={i.status === "Pendente" ? "warning" : i.status === "Revisado" ? "success" : "neutral"}>{i.status}</Badge></td><td className="actions">
      {i.tipo === "Duplicidade" && <button onClick={() => setDuplicidade(i)} disabled={updatingId === i.id}>Resolver duplicidade</button>}
      {TIPOS_CORRIGIVEIS_NO_CADASTRO.has(i.tipo) && <button onClick={() => empresaDaLinha && setCorrigindo(empresaDaLinha)} disabled={updatingId === i.id || !empresaDaLinha}>Corrigir cadastro</button>}
      {i.sugerido && <button onClick={() => update(i.id, "aplicar_sugestao")} disabled={updatingId === i.id}>Aplicar sugestão</button>}
      <button onClick={() => update(i.id, "ignorar")} disabled={updatingId === i.id}>Ignorar</button>
    </td></tr>; })}</tbody></table>{filtered.length === 0 && <Empty title="Nenhuma ocorrência neste filtro" text="As divergências tratadas continuam disponíveis no histórico." />}</section>
    {corrigindo && <EmpresaEditModal empresa={corrigindo} perfis={perfis} onClose={() => setCorrigindo(null)} onSaved={handleCadastroCorrigido} />}
    {duplicidade && <ResolverDuplicidade divergencia={duplicidade} companies={companies} onClose={() => setDuplicidade(null)} onResolved={handleDuplicidadeResolvida} />}
  </>;
}

function Analysis({ companies }: { companies: Empresa[] }) {
  const [state, setState] = useState("Todos"); const [size, setSize] = useState("Todos"); const [situation, setSituation] = useState("Todos"); const [search, setSearch] = useState("");
  const anoAtual = new Date().getFullYear();
  const filtered = companies.filter((c) => (state === "Todos" || c.estado === state) && (size === "Todos" || c.porte === size) && (situation === "Todos" || c.status === situation) && `${c.razaoSocial} ${c.cnae}`.toLowerCase().includes(search.toLowerCase()));
  const count = (key: keyof Empresa) => Object.entries(filtered.reduce((a, c) => ({ ...a, [String(c[key])]: (a[String(c[key])] || 0) + 1 }), {} as Record<string, number>)).map(([name, value]) => ({ name, value }));
  const stateData = count("estado").sort((a, b) => b.value - a.value).slice(0, 7); const sizeData = count("porte"); const cnaeData = count("cnae").sort((a, b) => b.value - a.value).slice(0, 5); const statusData = count("status");
  const anoAbertura = (c: Empresa) => (c.abertura ? new Date(c.abertura).getFullYear() : null);
  const ages = [{ name: "até 3 anos", value: filtered.filter((c) => { const a = anoAbertura(c); return a !== null && a >= anoAtual - 3; }).length }, { name: "4 a 8 anos", value: filtered.filter((c) => { const a = anoAbertura(c); return a !== null && a >= anoAtual - 8 && a < anoAtual - 3; }).length }, { name: "9 a 15 anos", value: filtered.filter((c) => { const a = anoAbertura(c); return a !== null && a >= anoAtual - 15 && a < anoAtual - 8; }).length }, { name: "mais de 15", value: filtered.filter((c) => { const a = anoAbertura(c); return a !== null && a < anoAtual - 15; }).length }];
  return <>
    <section className="section-head"><div><h2>Composição da carteira</h2><p>Explore o perfil dos clientes cadastrados.</p></div><Badge tone="blue">{filtered.length} empresas</Badge></section>
    <section className="filters analysis-filters"><input aria-label="Buscar por empresa ou CNAE" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar empresa ou atividade" />{[[state, setState, ["Todos", ...Array.from(new Set(companies.map((c) => c.estado)))]], [size, setSize, ["Todos", ...Array.from(new Set(companies.map((c) => c.porte)))]], [situation, setSituation, ["Todos", "Ativa", "Suspensa", "Baixada"]]].map(([value, setter, options], i) => <select key={i} value={value as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)}>{(options as string[]).map((o) => <option key={o}>{o}</option>)}</select>)}</section>
    {filtered.length === 0 ? <Empty title="Sem empresas para analisar" text="Nenhum cadastro corresponde aos filtros selecionados." /> : <section className="chart-grid"><ChartCard title="Empresas por estado"><BarVisual data={stateData} /></ChartCard><ChartCard title="Distribuição por porte"><PieVisual data={sizeData} /></ChartCard><ChartCard title="Principais CNAEs"><BarVisual data={cnaeData} /></ChartCard><ChartCard title="Situação cadastral"><PieVisual data={statusData} /></ChartCard><ChartCard title="Tempo de abertura"><BarVisual data={ages} /></ChartCard><article className="chart-card insight"><span>✦</span><h3>Leitura rápida</h3><p><strong>{filtered.filter((c) => c.status === "Ativa").length} empresas</strong> estão ativas. O perfil mais comum é <strong>{sizeData.sort((a,b) => b.value-a.value)[0]?.name}</strong>.</p><small>Dados atualizados a partir dos cadastros da carteira.</small></article></section>}
  </>;
}
function ChartCard({ title, children }: { title: string; children: ReactNode }) { return <article className="chart-card"><h3>{title}</h3><div className="chart">{children}</div></article>; }
function BarVisual({ data }: { data: { name: string; value: number }[] }) { return <ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ left: 6, right: 12 }}><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11, fill: "#617179" }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: "#f2f7f7" }} /><Bar dataKey="value" fill="#2d6478" radius={[0, 5, 5, 0]} barSize={14} /></BarChart></ResponsiveContainer>; }
function PieVisual({ data }: { data: { name: string; value: number }[] }) { return <div className="pie-layout"><ResponsiveContainer width="55%" height="100%"><PieChart><Pie data={data} dataKey="value" innerRadius={42} outerRadius={72} paddingAngle={3}>{data.map((_, i) => <Cell key={i} fill={cores[i % cores.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="legend">{data.map((d, i) => <p key={d.name}><i style={{ background: cores[i % cores.length] }} />{d.name}<strong>{d.value}</strong></p>)}</div></div>; }

const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const pad2 = (n: number) => String(n).padStart(2, "0");

function Calendar({ tasks, setTasks, companies, perfis }: { tasks: Tarefa[]; setTasks: (tasks: Tarefa[]) => void; companies: Empresa[]; perfis: { id: string; nome: string }[] }) {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mesIndex = hoje.getMonth(); // 0-11
  const mesISO = `${ano}-${pad2(mesIndex + 1)}`;
  const mesLabel = `${MESES_PT[mesIndex]} de ${ano}`;
  const diasNoMes = new Date(ano, mesIndex + 1, 0).getDate();
  const primeiroDiaSemana = new Date(ano, mesIndex, 1).getDay(); // 0=Dom
  const monthDays = Array.from({ length: diasNoMes }, (_, i) => i + 1);
  const dataHojeISO = `${ano}-${pad2(mesIndex + 1)}-${pad2(hoje.getDate())}`;

  const [mode, setMode] = useState<"month" | "list">("month");
  const [responsible, setResponsible] = useState("Todos");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [concluindoId, setConcluindoId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ titulo: "", empresaId: companies[0]?.id ?? "", responsavelId: perfis[0]?.id ?? "", vencimento: dataHojeISO });

  const [modelos, setModelos] = useState<ModeloRecorrencia[]>([]);
  const [modelosCarregados, setModelosCarregados] = useState(false);
  const [modeloOpen, setModeloOpen] = useState(false);
  const [modeloSaving, setModeloSaving] = useState(false);
  const [modeloError, setModeloError] = useState("");
  const [atualizandoModeloId, setAtualizandoModeloId] = useState<string | null>(null);
  const [modeloDraft, setModeloDraft] = useState({ titulo: "", tipo: "Fiscal", periodicidade: "mensal" as Periodicidade, diaReferencia: 10, empresaId: companies[0]?.id ?? "", responsavelId: perfis[0]?.id ?? "" });

  useEffect(() => {
    listarModelosRecorrencia()
      .then((dados) => { setModelos(dados); setModelosCarregados(true); })
      .catch(() => setModelosCarregados(true));
  }, []);

  const people = ["Todos", ...Array.from(new Set(perfis.map((p) => p.nome)))];
  const shown = tasks.filter((t) => responsible === "Todos" || t.responsavel === responsible);

  const refetchTasks = async (falhaParcial: string) => {
    try {
      const atualizadas = await listarTarefas();
      setTasks(atualizadas);
    } catch {
      // A tarefa já foi persistida no passo anterior — só a atualização da
      // lista falhou. Não reusar a mensagem de erro da ação, mesmo cuidado
      // do `save()` do Onboarding.
      setTaskError(falhaParcial);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.empresaId) {
      setTaskError("Selecione uma empresa.");
      return;
    }
    setSaving(true); setTaskError("");
    try {
      await criarTarefa({ titulo: draft.titulo, tipo: "Contábil", empresaId: draft.empresaId, responsavelId: draft.responsavelId || null, vencimento: draft.vencimento });
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível criar a tarefa";
      setTaskError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setSaving(false);
      return;
    }
    await refetchTasks("Tarefa criada, mas não foi possível atualizar a lista. Atualize a página.");
    setSaving(false);
    setOpen(false);
  };

  const concluir = async (id: string) => {
    setConcluindoId(id); setTaskError("");
    try {
      await atualizarTarefa(id, { status: "Concluída" });
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível concluir a tarefa";
      setTaskError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setConcluindoId(null);
      return;
    }
    await refetchTasks("Tarefa concluída, mas não foi possível atualizar a lista. Atualize a página.");
    setConcluindoId(null);
  };

  const refetchModelos = async (falhaParcial: string) => {
    try {
      const atualizados = await listarModelosRecorrencia();
      setModelos(atualizados);
    } catch {
      setModeloError(falhaParcial);
    }
  };

  const criarModelo = async (e: FormEvent) => {
    e.preventDefault();
    if (!modeloDraft.empresaId) {
      setModeloError("Selecione uma empresa.");
      return;
    }
    setModeloSaving(true); setModeloError("");
    try {
      await criarModeloRecorrencia({
        titulo: modeloDraft.titulo,
        tipo: modeloDraft.tipo,
        periodicidade: modeloDraft.periodicidade,
        diaReferencia: modeloDraft.diaReferencia,
        empresaId: modeloDraft.empresaId,
        responsavelId: modeloDraft.responsavelId || null,
      });
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível criar o modelo de recorrência";
      setModeloError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setModeloSaving(false);
      return;
    }
    await refetchModelos("Modelo criado, mas não foi possível atualizar a lista. Atualize a página.");
    setModeloSaving(false);
    setModeloOpen(false);
  };

  const desativarModelo = async (id: string) => {
    setAtualizandoModeloId(id); setModeloError("");
    try {
      await atualizarModeloRecorrencia(id, { ativo: false });
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível desativar o modelo";
      setModeloError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setAtualizandoModeloId(null);
      return;
    }
    await refetchModelos("Modelo desativado, mas não foi possível atualizar a lista. Atualize a página.");
    setAtualizandoModeloId(null);
  };

  const maxDiaReferencia = modeloDraft.periodicidade === "semanal" ? 7 : 31;

  return <>
    <section className="section-head"><div><h2>Calendário contábil</h2><p>{mesLabel} · obrigações e rotinas da carteira.</p></div><button className="primary" onClick={() => setOpen(true)}>+ Nova tarefa</button></section>
    {taskError && <div className="notice error"><p>{taskError}</p></div>}
    <section className="calendar-toolbar"><div className="tabs"><button className={mode === "month" ? "selected" : ""} onClick={() => setMode("month")}>Calendário</button><button className={mode === "list" ? "selected" : ""} onClick={() => setMode("list")}>Lista</button></div><label>Responsável <select value={responsible} onChange={(e) => setResponsible(e.target.value)}>{people.map((p) => <option key={p}>{p}</option>)}</select></label></section>
    {mode === "month" ? <section className="calendar"><div className="weekdays">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <span key={d}>{d}</span>)}</div><div className="day-grid">{Array.from({ length: primeiroDiaSemana }, (_, i) => <div className="day muted" key={`blank-${i}`} />)}{monthDays.map((day) => { const date = `${mesISO}-${pad2(day)}`; const items = shown.filter((t) => t.vencimento === date); const holiday = items.find((t) => t.coincideComFeriado)?.coincideComFeriado ?? null; return <div className={`day ${holiday ? "holiday" : ""}`} key={day}><span>{day}</span>{holiday && <small title={holiday.nome}>Feriado</small>}{items.map((t) => <button className={`calendar-task ${t.status === "Atrasada" ? "late" : ""}`} key={t.id} title={`${t.empresa} · ${t.responsavel}`}>{t.titulo}</button>)}</div>; })}</div></section> : <section className="panel list-tasks">{shown.map((t) => <div className="task-line" key={t.id}><time>{formatDate(t.vencimento)}</time><div><strong>{t.titulo}</strong><small>{t.empresa} · {t.responsavel} · {t.tipo}</small></div>{t.coincideComFeriado && <Badge tone="warning">Feriado: {t.coincideComFeriado.nome}</Badge>}<Badge tone={t.status === "Atrasada" ? "danger" : t.status === "Concluída" ? "success" : "blue"}>{t.status}</Badge>{t.status !== "Concluída" && <button className="icon-button" disabled={concluindoId === t.id} onClick={() => concluir(t.id)}>{concluindoId === t.id ? "Concluindo…" : "Concluir"}</button>}</div>)}{shown.length === 0 && <Empty title="Nenhuma tarefa neste mês" text="Cadastre uma tarefa avulsa ou um modelo de recorrência." />}</section>}

    <section className="section-head"><div><h2>Modelos recorrentes</h2><p>Tarefas geradas automaticamente todo mês, conforme a periodicidade.</p></div><button className="primary" onClick={() => setModeloOpen(true)}>+ Novo modelo</button></section>
    {modeloError && <div className="notice error"><p>{modeloError}</p></div>}
    <section className="panel table-wrap">
      <table>
        <thead><tr><th>Título</th><th>Tipo</th><th>Periodicidade</th><th>Empresa</th><th>Responsável</th><th>Situação</th><th></th></tr></thead>
        <tbody>
          {modelos.map((m) => <tr key={m.id}>
            <td><strong>{m.titulo}</strong></td>
            <td>{m.tipo}</td>
            <td>{m.periodicidade} (dia {m.diaReferencia})</td>
            <td>{m.empresa}</td>
            <td>{m.responsavel || "—"}</td>
            <td><Badge tone={m.ativo ? "success" : "neutral"}>{m.ativo ? "Ativo" : "Inativo"}</Badge></td>
            <td>{m.ativo && <button className="icon-button" disabled={atualizandoModeloId === m.id} onClick={() => desativarModelo(m.id)}>{atualizandoModeloId === m.id ? "Desativando…" : "Desativar"}</button>}</td>
          </tr>)}
        </tbody>
      </table>
      {modelosCarregados && modelos.length === 0 && <Empty title="Nenhum modelo de recorrência" text="Cadastre um modelo para gerar tarefas automaticamente." />}
    </section>

    {open && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Nova tarefa"><form className="modal" onSubmit={add}><button type="button" className="close" onClick={() => setOpen(false)} aria-label="Fechar">×</button><h2>Nova tarefa</h2><p>Cadastre uma obrigação avulsa da carteira.</p><label>Título<input required value={draft.titulo} onChange={(e) => setDraft({ ...draft, titulo: e.target.value })} placeholder="Ex.: Conferência de documentos" /></label><label>Empresa<select value={draft.empresaId} onChange={(e) => setDraft({ ...draft, empresaId: e.target.value })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.fantasia}</option>)}</select></label><label>Responsável<select value={draft.responsavelId} onChange={(e) => setDraft({ ...draft, responsavelId: e.target.value })}><option value="">Selecione…</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label><label>Vencimento<input type="date" value={draft.vencimento} onChange={(e) => setDraft({ ...draft, vencimento: e.target.value })} /></label><button className="primary" disabled={saving}>{saving ? "Salvando…" : "Salvar tarefa"}</button></form></div>}

    {modeloOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Novo modelo de recorrência"><form className="modal" onSubmit={criarModelo}><button type="button" className="close" onClick={() => setModeloOpen(false)} aria-label="Fechar">×</button><h2>Novo modelo de recorrência</h2><p>Gera tarefas automaticamente a cada mês, ao abrir o calendário.</p><label>Título<input required value={modeloDraft.titulo} onChange={(e) => setModeloDraft({ ...modeloDraft, titulo: e.target.value })} placeholder="Ex.: Fechamento da folha" /></label><label>Tipo<input required value={modeloDraft.tipo} onChange={(e) => setModeloDraft({ ...modeloDraft, tipo: e.target.value })} placeholder="Ex.: Fiscal" /></label><label>Periodicidade<select value={modeloDraft.periodicidade} onChange={(e) => setModeloDraft({ ...modeloDraft, periodicidade: e.target.value as Periodicidade, diaReferencia: 1 })}><option value="mensal">Mensal</option><option value="semanal">Semanal</option><option value="anual">Anual</option></select></label><label>{modeloDraft.periodicidade === "semanal" ? "Dia da semana (1=segunda…7=domingo)" : "Dia do mês"}<input type="number" min={1} max={maxDiaReferencia} required value={modeloDraft.diaReferencia} onChange={(e) => setModeloDraft({ ...modeloDraft, diaReferencia: Number(e.target.value) })} /></label><label>Empresa<select value={modeloDraft.empresaId} onChange={(e) => setModeloDraft({ ...modeloDraft, empresaId: e.target.value })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.fantasia}</option>)}</select></label><label>Responsável<select value={modeloDraft.responsavelId} onChange={(e) => setModeloDraft({ ...modeloDraft, responsavelId: e.target.value })}><option value="">Selecione…</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label><button className="primary" disabled={modeloSaving}>{modeloSaving ? "Salvando…" : "Salvar modelo"}</button></form></div>}
  </>;
}
