"use client";

import { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, lazy, ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { extrairCNPJDoTexto, validarCNPJ } from "../lib/cnpj";
import {
  atualizarEmpresa, atualizarEscritorio, atualizarMeuNome, atualizarMembroEquipe, consultarCNPJ, convidarFuncionario, enviarLogoEscritorio, excluirEmpresa,
  executarAuditoria, formatarSocio, listarDivergencias, listarEmpresas, listarEquipe, listarEscritorio, listarPerfis,
  listarTarefas, paraSocioPayload, removerLogoEscritorio, salvarEmpresa, tratarDivergencia,
  type Divergencia, type Empresa, type MembroEquipe, type Papel, type SocioPayload, type Tarefa,
} from "../src/services/portfolio";
import { AccessibleModal, useAccessibleMenu, useDismissOnViewportChange } from "./accessibility";
import { Calendar, ResponsavelPicker } from "./calendar-view";

// recharts é grande e só é usado na aba "Análise". Carregado sob demanda para
// não entrar no caminho do primeiro render da rota "/" (que abre na "Visão
// geral"). Ver app/charts.tsx.
const BarVisual = lazy(() => import("./charts").then((m) => ({ default: m.BarVisual })));
const PieVisual = lazy(() => import("./charts").then((m) => ({ default: m.PieVisual })));

type View = "Visão geral" | "Onboarding" | "Auditoria" | "Análise" | "Calendário" | "Configurações";
/** Ícones da navegação. Antes eram glifos Unicode (⌂ ＋ ◈ ▥ □), que variavam
 * de largura conforme a fonte do sistema — o "＋" é de largura plena e
 * estourava a caixa de 16px, deixando a coluna de ícones irregular. Em SVG
 * todos partem do mesmo viewBox e herdam a cor do botão por `currentColor`. */
const ICONE_SVG = {
  viewBox: "0 0 20 20", fill: "none", stroke: "currentColor",
  strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round",
} as const;

function NavIcon({ children }: { children: ReactNode }) {
  return <i className="nav-icon" aria-hidden="true"><svg {...ICONE_SVG}>{children}</svg></i>;
}

const ICONE_CONFIGURACOES = <><path d="M3 6h8.1M15.9 6H17M3 14h1.1M8.9 14H17" /><circle cx="13.5" cy="6" r="1.9" /><circle cx="6.5" cy="14" r="1.9" /></>;
// Porta mais estreita e mais baixa que a seta: a porta é densa e a seta é
// fina, então uma porta de altura total puxava o centro óptico 1,5 unidade
// para a esquerda.
const ICONE_SAIR = <><path d="M10.25 4.25H6A1.25 1.25 0 0 0 4.75 5.5v9A1.25 1.25 0 0 0 6 15.75h4.25" /><path d="M9.5 10h8" /><path d="m14.9 7.15 2.85 2.85-2.85 2.85" /></>;

const nav: { label: View; icon: ReactNode }[] = [
  // Painel 2x2: "visão geral" da operação, não uma casa.
  { label: "Visão geral", icon: <><rect x="2.75" y="2.75" width="6" height="6" rx="1.4" /><rect x="11.25" y="2.75" width="6" height="6" rx="1.4" /><rect x="2.75" y="11.25" width="6" height="6" rx="1.4" /><rect x="11.25" y="11.25" width="6" height="6" rx="1.4" /></> },
  // Prédio com selo "+": incluir uma empresa na carteira. O "+" fica num
  // selo redondo, e não solto à direita: solto, a massa de tinta do prédio
  // puxava o desenho 1,56 unidade para a esquerda do centro óptico.
  { label: "Onboarding", icon: <><path d="M4 15.4V3.65A1.25 1.25 0 0 1 5.25 2.4h4.5A1.25 1.25 0 0 1 11 3.65V7.4" /><path d="M3.25 15.4h6" /><path d="M6.25 5.9h2.5M6.25 9.4h2.5" /><circle cx="14" cy="12.4" r="3.75" /><path d="M14 10.65v3.5M12.25 12.4h3.5" /></> },
  // Prancheta com visto: conferência dos cadastros.
  { label: "Auditoria", icon: <><path d="M7 3.75H5.25A1.25 1.25 0 0 0 4 5v11.25a1.25 1.25 0 0 0 1.25 1.25h9.5a1.25 1.25 0 0 0 1.25-1.25V5a1.25 1.25 0 0 0-1.25-1.25H13" /><rect x="7" y="2.25" width="6" height="3" rx="1" /><path d="m7.25 11.25 1.75 1.75 3.75-4" /></> },
  // Barras: composição da carteira.
  { label: "Análise", icon: <><path d="M3 16.25h14" /><path d="M6.25 16.25V9.5" /><path d="M10 16.25V3.75" /><path d="M13.75 16.25V7" /></> },
  // Calendário: obrigações e prazos.
  { label: "Calendário", icon: <><rect x="3" y="4.75" width="14" height="12.5" rx="1.75" /><path d="M3 8.75h14" /><path d="M7 2.75V5.5M13 2.75V5.5" /></> },
];
const SITUACOES_CADASTRAIS = ["", "Ativa", "Suspensa", "Baixada", "Inapta", "Nula"];
const opcoesSituacaoCadastral = (situacao: string) => situacao && !SITUACOES_CADASTRAIS.includes(situacao) ? [situacao, ...SITUACOES_CADASTRAIS] : SITUACOES_CADASTRAIS;
const formatDate = (date: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00`));
/** Data/hora completas no horário de Brasília, independente do fuso do navegador — usado no histórico de divergências. */
const formatDataHoraBrasilia = (isoComFuso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(isoComFuso));
const formatadorDataBrasil = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const hojeBrasil = () => formatadorDataBrasil.format(new Date());
const somarDiasBrasil = (data: string, dias: number) => {
  const [ano, mes, dia] = data.split("-").map(Number);
  const resultado = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return `${resultado.getUTCFullYear()}-${String(resultado.getUTCMonth() + 1).padStart(2, "0")}-${String(resultado.getUTCDate()).padStart(2, "0")}`;
};
const proximoMesBrasil = (mes: string) => {
  const [ano, numeroMes] = mes.split("-").map(Number);
  const proximo = new Date(Date.UTC(ano, numeroMes, 1));
  return `${proximo.getUTCFullYear()}-${String(proximo.getUTCMonth() + 1).padStart(2, "0")}`;
};
/** Evita "...obrigatórios.. Tente novamente." quando a mensagem do servidor já termina em ponto. */
const semPontoFinal = (mensagem: string) => mensagem.replace(/\.+$/, "");
const navegarRadio = <T extends string>(event: KeyboardEvent<HTMLButtonElement>, opcoes: readonly T[], atual: T, selecionar: (valor: T) => void) => {
  if (!['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const direcao = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
  const proximo = opcoes[(opcoes.indexOf(atual) + direcao + opcoes.length) % opcoes.length];
  selecionar(proximo);
  requestAnimationFrame(() => event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-choice="${proximo}"]`)?.focus());
};

type CamposCadastraisDraft = {
  cnpj: string; razaoSocial: string; fantasia: string; cidade: string; estado: string; endereco: string;
  status: string; porte: string; cnaeCodigo: string; cnae: string; socios: SocioPayload[];
};
type EmpresaEditDraft = CamposCadastraisDraft & { responsavelIds: string[]; observacoes: string };
const paraEditDraft = (empresa: Empresa): EmpresaEditDraft => ({
  cnpj: empresa.cnpj, razaoSocial: empresa.razaoSocial, fantasia: empresa.fantasia, cidade: empresa.cidade, estado: empresa.estado,
  endereco: empresa.endereco, status: empresa.status, porte: empresa.porte,
  cnaeCodigo: empresa.cnaeCodigo, cnae: empresa.cnae, socios: empresa.socios.map(paraSocioPayload),
  responsavelIds: empresa.responsavelIds, observacoes: empresa.observacoes ?? "",
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
    <label>Situação cadastral<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{opcoesSituacaoCadastral(draft.status).map((situacao) => <option key={situacao || "nao-informada"} value={situacao}>{situacao || "Não informada"}</option>)}</select></label>
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
  return <AccessibleModal label={`Editar dados de ${empresa.razaoSocial}`} onClose={onClose}><form className="modal" onSubmit={salvar}><button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button><h2>Editar dados antes de salvar</h2><div className="field-grid">
    <CamposCadastraisFields draft={draft} setDraft={setDraft} />
  </div>{!cnpjValido && <div className="notice error" role="alert"><p>CNPJ inválido — confira os números antes de salvar.</p></div>}<button className="primary" disabled={!cnpjValido}>Aplicar alterações</button></form></AccessibleModal>;
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
        responsavelIds: draft.responsavelIds, observacoes: draft.observacoes,
      });
      onSaved(atualizada);
    } catch (err) {
      const bruta = err instanceof Error ? err.message : "Não foi possível atualizar a empresa";
      setError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setSaving(false);
    }
  };
  return <AccessibleModal label={`Editar ${empresa.razaoSocial}`} onClose={onClose}><form className="modal" onSubmit={save}><button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button><h2>Editar empresa</h2><div className="field-grid">
    <CamposCadastraisFields draft={draft} setDraft={setDraft} />
    <div className="full field-block">
      <span className="field-label">Responsáveis internos</span>
      <ResponsavelPicker perfis={perfis} selecionados={draft.responsavelIds} onChange={(ids) => setDraft({ ...draft, responsavelIds: ids })} />
    </div>
    <label className="full">Observações internas<textarea value={draft.observacoes} onChange={(e) => setDraft({ ...draft, observacoes: e.target.value })} /></label>
  </div>{!cnpjValido && <div className="notice error" role="alert"><p>CNPJ inválido — confira os números antes de salvar.</p></div>}{error && <div className="notice error" role="alert"><p>{error}</p></div>}<button className="primary" disabled={saving || !cnpjValido}>{saving ? "Salvando…" : "Salvar alterações"}</button></form></AccessibleModal>;
}

function ConfirmarExclusaoEmpresa({ empresa, saving, error, onClose, onConfirm }: {
  empresa: Empresa; saving: boolean; error: string; onClose: () => void; onConfirm: () => void;
}) {
  return <AccessibleModal label="Confirmar exclusão" onClose={onClose}><div className="modal"><button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button><h2>Excluir empresa</h2><p>Tem certeza que deseja excluir <strong>{empresa.razaoSocial}</strong> da carteira? Divergências, tarefas e modelos de recorrência associados a ela também serão removidos. Essa ação não pode ser desfeita.</p>{error && <div className="notice error" role="alert"><p>{error}</p></div>}<button type="button" className="primary danger" onClick={onConfirm} disabled={saving}>{saving ? "Excluindo…" : "Excluir definitivamente"}</button></div></AccessibleModal>;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "Ativa") return "success";
  if (status === "Suspensa") return "warning";
  if (status === "Baixada") return "neutral";
  return "danger";
}

function Card({ title, value, helper, icon }: { title: string; value: string | number; helper: string; icon: string }) {
  return <article className="metric-card"><span className="metric-icon" aria-hidden="true">{icon}</span><p>{title}</p><strong>{value}</strong><small>{helper}</small></article>;
}

function Empty({ title = "Nenhum resultado encontrado", text = "Ajuste seus filtros ou tente novamente." }) {
  return <div className="empty"><span aria-hidden="true">⌕</span><strong>{title}</strong><p>{text}</p></div>;
}

export function HomeClient({ userName, userEmail, papel }: { userName: string; userEmail: string; papel: Papel }) {
  const [nomeDoUsuario, setNomeDoUsuario] = useState(userName);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [view, setView] = useState<View>("Visão geral");
  const [menuOpen, setMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [companies, setCompanies] = useState<Empresa[]>([]);
  const [issues, setIssues] = useState<Divergencia[]>([]);
  const [tasks, setTasks] = useState<Tarefa[]>([]);
  const [weekTasks, setWeekTasks] = useState<Tarefa[]>([]);
  const [perfis, setPerfis] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const mesAtual = hojeBrasil().slice(0, 7);
    Promise.all([listarEmpresas(), listarDivergencias(), listarTarefas(mesAtual), listarPerfis()])
      .then(([c, d, t, p]) => {
        setCompanies(c); setIssues(d); setTasks(t); setWeekTasks(t); setPerfis(p); setLoading(false);
        listarTarefas(proximoMesBrasil(mesAtual)).then((proximas) => setWeekTasks([...t, ...proximas])).catch(() => undefined);
      })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  const atualizarTarefas = (atualizadas: Tarefa[]) => {
    const mesAtual = hojeBrasil().slice(0, 7);
    setTasks(atualizadas);
    setWeekTasks((anteriores) => [...atualizadas, ...anteriores.filter((t) => t.vencimento.slice(0, 7) !== mesAtual)]);
  };

  useEffect(() => {
    setDarkMode(window.localStorage.getItem("controle-carteira-theme") === "dark");
  }, []);

  useEffect(() => {
    listarEscritorio().then((escritorio) => setLogoUrl(escritorio.logoUrl)).catch(() => setLogoUrl(null));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const elementoAnterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => mobileMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    const aoTeclar = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const itens = Array.from(mobileMenuRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
      if (itens.length === 0) return;
      const primeiro = itens[0];
      const ultimo = itens.at(-1)!;
      if (event.shiftKey && document.activeElement === primeiro) {
        event.preventDefault();
        ultimo.focus();
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = overflowAnterior;
      elementoAnterior?.focus();
    };
  }, [menuOpen]);

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
    view === "Visão geral" ? <Overview companies={companies} issues={issues} tasks={tasks} weekTasks={weekTasks} go={setView} /> :
    view === "Onboarding" ? <Onboarding companies={companies} setCompanies={setCompanies} perfis={perfis} userName={nomeDoUsuario} setIssues={setIssues} /> :
    view === "Auditoria" ? <Audit issues={issues} setIssues={setIssues} companies={companies} setCompanies={setCompanies} perfis={perfis} /> :
    view === "Análise" ? <Analysis companies={companies} /> :
    view === "Calendário" ? <Calendar tasks={tasks} setTasks={atualizarTarefas} companies={companies} perfis={perfis} userName={nomeDoUsuario} papel={papel} /> :
    <Settings userName={nomeDoUsuario} userEmail={userEmail} papel={papel} logoUrl={logoUrl} onNameChange={setNomeDoUsuario} onLogoChange={setLogoUrl} />
  );

  return <main className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
    <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
    <aside ref={mobileMenuRef} className={`sidebar ${menuOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="Navegação principal">
      <div className="brand">
        <div className="brand-identity">{logoUrl && <img className="brand-logo" src={logoUrl} alt="" />}<span className="brand-name">Controle de carteira</span></div>
        <button className="sidebar-toggle" type="button" title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"} aria-label={sidebarCollapsed ? "Expandir navegação" : "Recolher navegação"} onClick={() => setSidebarCollapsed((current) => !current)}><span className="sidebar-glyph" aria-hidden="true" /></button>
      </div>
      <nav>{nav.map((item) => <button key={item.label} title={sidebarCollapsed ? item.label : undefined} className={view === item.label ? "active" : ""} onClick={() => { setView(item.label); setMenuOpen(false); }}><NavIcon>{item.icon}</NavIcon><span className="nav-label">{item.label}</span></button>)}</nav>
      <div className="sidebar-footer"><button className={`sidebar-settings ${view === "Configurações" ? "active" : ""}`} aria-label="Configurações" title="Configurações" onClick={() => { setView("Configurações"); setMenuOpen(false); }}><NavIcon>{ICONE_CONFIGURACOES}</NavIcon><span className="nav-label">Configurações</span></button><button className="sidebar-logout" type="button" title="Sair da conta" onClick={logout}><NavIcon>{ICONE_SAIR}</NavIcon><span className="nav-label">Sair da conta</span></button></div>
    </aside>
    {menuOpen && <button className="backdrop" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
    <section className="workspace">
      <header className="topbar">
        <div className="topbar-title"><button className="menu-button" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}>☰</button><div><p className="eyebrow">Gestão contábil</p><h1>{view}</h1></div></div>
        <div className="header-actions"><span className="header-divider" aria-hidden="true" /><button className={`theme-button ${darkMode ? "active" : ""}`} type="button" aria-label="Alternar entre modo claro e escuro" aria-pressed={darkMode} title="Alternar modo claro e escuro" onClick={toggleTheme}><span aria-hidden="true">☼</span><span aria-hidden="true">☾</span></button>{logoUrl && <img className="client-logo" src={logoUrl} alt="Logo do cliente" />}</div>
      </header>
      <div id="conteudo-principal" className="page-content" tabIndex={-1}>
        {loadError && <div className="notice error" role="alert"><strong>Não foi possível carregar os dados</strong><p>Tente atualizar a página.</p></div>}
        {content}
      </div>
    </section>
  </main>;
}

function Loading() { return <div className="loading-grid" role="status" aria-live="polite" aria-label="Carregando dados">{Array.from({ length: 8 }).map((_, i) => <div className="skeleton" key={i} />)}</div>; }

function Settings({ userName, userEmail, papel, logoUrl, onNameChange, onLogoChange }: { userName: string; userEmail: string; papel: Papel; logoUrl: string | null; onNameChange: (nome: string) => void; onLogoChange: (url: string | null) => void }) {
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeDraft, setNomeDraft] = useState(userName);
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [nomeMessage, setNomeMessage] = useState("");
  const [senhaAtual, setSenhaAtual] = useState("");
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
    if (!senhaAtual) {
      setMessage("Informe a senha atual.");
      return;
    }
    if (senha !== confirmacao) {
      setMessage("As senhas informadas não coincidem.");
      return;
    }
    setSavingPassword(true);
    const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senhaAtual, senha }) });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setMessage(data.error ?? "Não foi possível atualizar a senha.");
      setSavingPassword(false);
      return;
    }
    setSenhaAtual("");
    setSenha("");
    setConfirmacao("");
    setMessage("Senha atualizada com sucesso.");
    setSavingPassword(false);
  };

  const salvarNome = async (event: FormEvent) => {
    event.preventDefault();
    setSalvandoNome(true); setNomeMessage("");
    try {
      const atualizado = await atualizarMeuNome(nomeDraft);
      onNameChange(atualizado.nome);
      setNomeDraft(atualizado.nome);
      setEditandoNome(false);
    } catch (error) {
      setNomeMessage(error instanceof Error ? error.message : "Não foi possível atualizar o seu nome.");
    } finally {
      setSalvandoNome(false);
    }
  };

  const enviarLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const logo = event.target.files?.[0];
    if (!logo) return;
    setLogoMessage(""); setEnviandoLogo(true);
    try {
      const atualizado = await enviarLogoEscritorio(logo);
      onLogoChange(atualizado.logoUrl);
      setLogoMessage("Logo atualizada com sucesso.");
    } catch (error) {
      setLogoMessage(error instanceof Error ? error.message : "Não foi possível enviar a logo.");
    } finally {
      setEnviandoLogo(false);
      event.target.value = "";
    }
  };

  const removerLogo = async () => {
    setLogoMessage(""); setEnviandoLogo(true);
    try {
      await removerLogoEscritorio();
      onLogoChange(null);
      setLogoMessage("Logo removida.");
    } catch (error) {
      setLogoMessage(error instanceof Error ? error.message : "Não foi possível remover a logo.");
    } finally {
      setEnviandoLogo(false);
    }
  };

  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);
  const [conviteEmail, setConviteEmail] = useState("");
  const [conviteMessage, setConviteMessage] = useState("");
  const [convidando, setConvidando] = useState(false);
  const [atualizandoId, setAtualizandoId] = useState<string | null>(null);

  useEffect(() => {
    if (papel === "responsavel") listarEquipe().then(setEquipe).catch(() => setEquipe([]));
  }, [papel]);

  const [escritorioNome, setEscritorioNome] = useState("");
  const [editandoEscritorio, setEditandoEscritorio] = useState(false);
  const [escritorioNomeDraft, setEscritorioNomeDraft] = useState("");
  const [salvandoEscritorio, setSalvandoEscritorio] = useState(false);
  const [escritorioMessage, setEscritorioMessage] = useState("");
  const [logoMessage, setLogoMessage] = useState("");
  const [enviandoLogo, setEnviandoLogo] = useState(false);

  useEffect(() => {
    if (papel === "responsavel") listarEscritorio().then((e) => { setEscritorioNome(e.nome); setEscritorioNomeDraft(e.nome); }).catch(() => {});
  }, [papel]);

  const salvarEscritorioNome = async (event: FormEvent) => {
    event.preventDefault();
    setSalvandoEscritorio(true); setEscritorioMessage("");
    try {
      const atualizado = await atualizarEscritorio(escritorioNomeDraft);
      setEscritorioNome(atualizado.nome);
      setEditandoEscritorio(false);
    } catch (error) {
      setEscritorioMessage(error instanceof Error ? error.message : "Não foi possível atualizar o escritório.");
    } finally {
      setSalvandoEscritorio(false);
    }
  };

  const convidar = async (event: FormEvent) => {
    event.preventDefault();
    setConvidando(true); setConviteMessage("");
    try {
      await convidarFuncionario(conviteEmail);
      setConviteEmail("");
      setConviteMessage("Convite enviado com sucesso.");
      setEquipe(await listarEquipe());
    } catch (error) {
      setConviteMessage(error instanceof Error ? error.message : "Não foi possível enviar o convite.");
    } finally {
      setConvidando(false);
    }
  };

  const alternarAtivo = async (membro: MembroEquipe) => {
    setAtualizandoId(membro.id);
    try {
      await atualizarMembroEquipe(membro.id, !membro.ativo);
      setEquipe(await listarEquipe());
    } finally {
      setAtualizandoId(null);
    }
  };

  const numeroFuncionarios = equipe.filter((m) => m.papel === "funcionario").length;

  const equipeTable = <table className="equipe-table">
    <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th></th></tr></thead>
    <tbody>{equipe.map((m) => <tr key={m.id}>
      <td>{m.nome || "Convite pendente"}</td>
      <td>{m.email}</td>
      <td>{m.papel === "responsavel" ? "Responsável" : "Funcionário"}</td>
      <td>{m.ativo ? "Ativo" : "Inativo"}</td>
      <td>{m.papel === "funcionario" && <button type="button" className="secondary" disabled={atualizandoId === m.id} onClick={() => alternarAtivo(m)}>{atualizandoId === m.id ? "Aguarde…" : m.ativo ? "Desativar" : "Reativar"}</button>}</td>
    </tr>)}</tbody>
  </table>;

  return <>
    <section className="section-head settings-heading"><div><p className="eyebrow">Conta e acessibilidade</p><h2>Configurações</h2><p>Gerencie suas informações, segurança e preferências de visualização.</p></div></section>
    <section className="settings-grid">
      <article className="panel account-card"><div className="account-avatar">{userName.slice(0, 2).toUpperCase()}</div><div><p className="settings-label">Conta conectada</p>{editandoNome ? <form className="account-name-form" onSubmit={salvarNome}><label>Seu nome<input autoComplete="name" required value={nomeDraft} onChange={(event) => setNomeDraft(event.target.value)} /></label><button className="primary" disabled={salvandoNome}>{salvandoNome ? "Salvando…" : "Salvar"}</button><button type="button" className="secondary" onClick={() => { setEditandoNome(false); setNomeDraft(userName); setNomeMessage(""); }}>Cancelar</button></form> : <><h3>{userName}</h3><p>{userEmail}</p><button type="button" className="secondary" onClick={() => setEditandoNome(true)}>Editar nome</button></>}{nomeMessage && <p className="settings-message error" role="alert">{nomeMessage}</p>}</div></article>
      {papel === "responsavel" && <article className="panel escritorio-card">
        <p className="settings-label">Escritório</p>
        {editandoEscritorio ? <form className="escritorio-rename-form" onSubmit={salvarEscritorioNome}>
          <input required value={escritorioNomeDraft} onChange={(e) => setEscritorioNomeDraft(e.target.value)} />
          <button className="primary" disabled={salvandoEscritorio}>{salvandoEscritorio ? "Salvando…" : "Salvar"}</button>
          <button type="button" className="secondary" onClick={() => { setEditandoEscritorio(false); setEscritorioNomeDraft(escritorioNome); setEscritorioMessage(""); }}>Cancelar</button>
        </form> : <>
          <h3>{escritorioNome}</h3>
          <p>{numeroFuncionarios} {numeroFuncionarios === 1 ? "funcionário" : "funcionários"}</p>
          <button type="button" className="secondary" onClick={() => setEditandoEscritorio(true)}>Editar nome</button>
        </>}
        {escritorioMessage && <p className="settings-message error" role="alert">{escritorioMessage}</p>}
      </article>}
      {papel === "responsavel" && <article className="panel settings-panel logo-panel"><div className="settings-panel-head"><span aria-hidden="true">▣</span><div><h3>Logo do cliente</h3><p>Use PNG, JPG ou WebP com até 2 MB. A logo aparecerá no cabeçalho e na barra lateral após o envio.</p></div></div>{logoUrl && <img className="logo-preview" src={logoUrl} alt="Prévia da logo do cliente" />}<label className="logo-upload"><span>{enviandoLogo ? "Enviando…" : "Enviar logo"}</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={enviandoLogo} onChange={enviarLogo} /></label>{logoUrl && <button type="button" className="secondary" disabled={enviandoLogo} onClick={removerLogo}>Remover logo</button>}{logoMessage && <p className={logoMessage.includes("sucesso") || logoMessage === "Logo removida." ? "settings-message success" : "settings-message error"} role="status">{logoMessage}</p>}</article>}
      {papel === "responsavel" && <article className="panel settings-panel equipe-panel">
        <div className="settings-panel-head"><span aria-hidden="true">◍</span><div><h3>Equipe</h3><p>Convide funcionários para trabalhar junto com você neste espaço.</p></div></div>
        <form className="settings-form convite-form" onSubmit={convidar}>
          <label>E-mail do funcionário<input type="email" required value={conviteEmail} onChange={(e) => setConviteEmail(e.target.value)} placeholder="funcionario@email.com" /></label>
          <button className="primary" disabled={convidando}>{convidando ? "Enviando…" : "Convidar"}</button>
          {conviteMessage && <p className={conviteMessage.includes("sucesso") ? "settings-message success" : "settings-message error"} role={conviteMessage.includes("sucesso") ? "status" : "alert"}>{conviteMessage}</p>}
        </form>
        {equipe.length > 10 ? <details className="equipe-dropdown">
          <summary>Ver equipe ({equipe.length})</summary>
          {equipeTable}
        </details> : equipeTable}
      </article>}
      <article className="panel settings-panel"><div className="settings-panel-head"><span aria-hidden="true">◉</span><div><h3>Redefinir senha</h3><p>Confirme a senha atual antes de escolher uma nova senha com pelo menos 8 caracteres.</p></div></div><form className="settings-form" onSubmit={updatePassword}><label className="full">Senha atual<input type="password" autoComplete="current-password" required value={senhaAtual} onChange={(event) => setSenhaAtual(event.target.value)} /></label><label>Nova senha<input type="password" autoComplete="new-password" minLength={8} required value={senha} onChange={(event) => setSenha(event.target.value)} /></label><label>Confirmar nova senha<input type="password" autoComplete="new-password" minLength={8} required value={confirmacao} onChange={(event) => setConfirmacao(event.target.value)} /></label>{message && <p className={message.includes("sucesso") ? "settings-message success" : "settings-message error"} role={message.includes("sucesso") ? "status" : "alert"}>{message}</p>}<button className="primary" disabled={savingPassword}>{savingPassword ? "Atualizando…" : "Atualizar senha"}</button></form></article>
      <article className="panel settings-panel"><div className="settings-panel-head"><span aria-hidden="true">◌</span><div><h3>Modo daltonismo</h3><p>Usa a paleta Okabe–Ito e indicadores textuais para não depender apenas de vermelho e verde.</p></div></div><div className="choice-group" role="radiogroup" aria-label="Modo daltonismo"><button type="button" data-choice="default" tabIndex={vision === "default" ? 0 : -1} className={vision === "default" ? "selected" : ""} role="radio" aria-checked={vision === "default"} onKeyDown={(event) => navegarRadio(event, ["default", "colorblind"], vision, applyVision)} onClick={() => applyVision("default")}><i className="palette-default" aria-hidden="true" />Padrão</button><button type="button" data-choice="colorblind" tabIndex={vision === "colorblind" ? 0 : -1} className={vision === "colorblind" ? "selected" : ""} role="radio" aria-checked={vision === "colorblind"} onKeyDown={(event) => navegarRadio(event, ["default", "colorblind"], vision, applyVision)} onClick={() => applyVision("colorblind")}><i className="palette-colorblind" aria-hidden="true" />Daltonismo</button></div></article>
      <article className="panel settings-panel"><div className="settings-panel-head"><span aria-hidden="true">Aa</span><div><h3>Tamanho da fonte</h3><p>Ajuste a leitura do sistema neste dispositivo.</p></div></div><div className="choice-group font-choices" role="radiogroup" aria-label="Tamanho da fonte">{([ ["small", "Menor"], ["normal", "Padrão"], ["large", "Maior"] ] as const).map(([value, label]) => <button type="button" key={value} data-choice={value} tabIndex={fontSize === value ? 0 : -1} className={fontSize === value ? "selected" : ""} role="radio" aria-checked={fontSize === value} onKeyDown={(event) => navegarRadio(event, ["small", "normal", "large"], fontSize, applyFontSize)} onClick={() => applyFontSize(value)}><i className={`font-${value}`} aria-hidden="true">A</i>{label}</button>)}</div></article>
    </section>
  </>;
}

function Overview({ companies, issues, tasks, weekTasks, go }: { companies: Empresa[]; issues: Divergencia[]; tasks: Tarefa[]; weekTasks: Tarefa[]; go: (view: View) => void }) {
  const active = companies.filter((c) => c.status === "Ativa").length;
  const limiteDaSemana = somarDiasBrasil(hojeBrasil(), 6);
  const due = weekTasks.filter((t) => !["Concluída", "Cancelada"].includes(t.status) && t.vencimento <= limiteDaSemana).length;
  return <>
    <section className="hero"><div><Badge tone="blue">Carteira em acompanhamento</Badge><h2>Uma visão clara da sua operação.</h2><p>Centralize cadastros, encontre inconsistências e mantenha as entregas do escritório no prazo.</p></div><button className="primary" onClick={() => go("Onboarding")}>Cadastrar empresa <span>→</span></button></section>
    <section className="metrics"><Card title="Empresas na carteira" value={companies.length} helper={`${active} com situação ativa`} icon="▦" /><Card title="Divergências pendentes" value={issues.filter((i) => i.status === "Pendente").length} helper="Requerem uma decisão" icon="◇" /><Card title="Vencimentos da semana" value={due} helper="Inclui tarefas em atraso" icon="◷" /></section>
    <section className="section-head"><div><h2>Atalhos da operação</h2><p>Acesse rapidamente os principais fluxos.</p></div></section>
    <section className="quick-grid">
      {[ ["Onboarding", "＋", "Inclua empresas com dados pré-preenchidos por CNPJ."], ["Auditoria", "◈", "Revise divergências identificadas na base."], ["Análise", "▥", "Entenda a composição da sua carteira."], ["Calendário", "□", "Acompanhe obrigações e prazos recorrentes."] ].map(([title, icon, text]) => <button className="quick-card" key={title} onClick={() => go(title as View)}><span aria-hidden="true">{icon}</span><strong>{title}</strong><p>{text}</p><em aria-hidden="true">→</em></button>)}
    </section>
    <section className="two-columns"><article className="panel"><div className="panel-title"><div><h3>Próximos vencimentos</h3><p>Prioridades dos próximos dias</p></div><button onClick={() => go("Calendário")}>Ver calendário</button></div>{tasks.slice(0, 4).map((t) => <div className="task-line" key={t.id}><time>{formatDate(t.vencimento)}</time><div><strong>{t.titulo}</strong><small>{t.empresa || "Reunião interna"} · {t.responsaveis.join(", ")}</small></div><Badge tone={t.status === "Atrasada" ? "danger" : "blue"}>{t.status}</Badge></div>)}</article><article className="panel"><div className="panel-title"><div><h3>Auditoria em foco</h3><p>Ocorrências pendentes por prioridade</p></div><button onClick={() => go("Auditoria")}>Revisar</button></div>{issues.filter((i) => i.status === "Pendente").slice(0, 4).map((i) => <div className="task-line" key={i.id}><span className="issue-dot" aria-hidden="true">!</span><div><strong>{i.empresa}</strong><small>{i.tipo}</small></div><Badge tone="warning">Pendente</Badge></div>)}</article></section>
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
    const id = setTimeout(() => setToastVisible(false), 6000);
    return () => clearTimeout(id);
  }, [toastVisible]);
  const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState("");
  const [responsavelIds, setResponsavelIds] = useState<string[]>([]); const [observacoes, setObservacoes] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const dismissMenu = () => { setMenuOpenId(null); setMenuAnchor(null); };
  const menuAcessivel = useAccessibleMenu(Boolean(menuOpenId), dismissMenu);
  useDismissOnViewportChange(Boolean(menuOpenId), menuAcessivel.fechar);
  const toggleMenu = (id: string, target: HTMLElement) => {
    if (menuOpenId === id) { menuAcessivel.fechar(); return; }
    menuAcessivel.rememberOpener(target);
    const rect = target.getBoundingClientRect();
    setMenuAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuOpenId(id);
  };
  const closeMenu = menuAcessivel.fechar;
  const [editing, setEditing] = useState<Empresa | null>(null);
  const [editingPreview, setEditingPreview] = useState(false);
  const [deleting, setDeleting] = useState<Empresa | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false); const [deleteError, setDeleteError] = useState("");
  const lookup = async (e: FormEvent) => {
    e.preventDefault(); setState("loading");
    try {
      const data = await consultarCNPJ(cnpj); setResult(data); setState("success");
      setResponsavelIds([]); setObservacoes("");
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
      await salvarEmpresa({ ...result, responsavelIds, observacoes });
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
    setResult(null); setCnpj(""); setState("idle"); setResponsavelIds([]); setObservacoes("");
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
    <section className="panel onboarding"><form onSubmit={lookup}><label htmlFor="cnpj">CNPJ da empresa</label><div className="search-row"><input id="cnpj" value={cnpj} onChange={(e) => setCnpj(maskCNPJ(e.target.value))} onPaste={(e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); setCnpj(maskCNPJ(extrairCNPJDoTexto(e.clipboardData.getData("text")))); }} placeholder="00.000.000/0000-00" inputMode="numeric" /><button className="primary" disabled={state === "loading"}>{state === "loading" ? "Consultando…" : "Consultar"}</button></div><small>Consulta via BrasilAPI.</small></form>{state === "error" && <div className="notice error" role="alert"><strong>Não encontramos esse CNPJ</strong><p>{message}</p></div>}</section>
    {result && <section className="detail-card"><div className="detail-heading"><div><Badge tone={statusTone(result.status)}>{result.status}</Badge><h2>{result.razaoSocial}</h2><p>{result.fantasia} · CNPJ {result.cnpj}</p></div><div className="detail-actions"><button type="button" className="secondary" onClick={() => setEditingPreview(true)}>Editar dados</button><button className="primary" onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar na carteira"}</button></div></div>
    {editingPreview && result && <EmpresaPreviewEditModal empresa={result} onClose={() => setEditingPreview(false)} onSave={(dados) => { setResult({ ...result, ...dados, status: dados.status as Empresa["status"], porte: dados.porte as Empresa["porte"], socios: dados.socios.map(formatarSocio) }); setEditingPreview(false); }} />}{saveError && <div className="notice error" role="alert"><p>{saveError}</p></div>}<div className="details"><div><span>Endereço</span><strong>{result.endereco}, {result.cidade}/{result.estado}</strong></div><div><span>CNAE principal</span><strong>{result.cnaeCodigo || result.cnae ? `${result.cnaeCodigo} · ${result.cnae}` : "Não informado pela consulta"}</strong></div><div><span>Porte</span><strong>{result.porte}</strong></div><div><span>Responsáveis internos</span><ResponsavelPicker perfis={perfis} selecionados={responsavelIds} onChange={setResponsavelIds} /></div><div className="full"><details className="socios-dropdown"><summary>Quadro societário{result.socios.length > 0 ? ` (${result.socios.length})` : ""}</summary><div className="socios-list">{result.socios.length > 0 ? result.socios.map((s, i) => <p key={i} className="static-value">{s}</p>) : <p className="static-value">Nenhum sócio informado.</p>}</div></details></div><div className="full"><label htmlFor="obs">Observações internas</label><textarea id="obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Inclua orientações para o time responsável…" /></div></div></section>}
    {toastVisible && <div className="toast" role="status" aria-live="polite"><span>✓ {message}</span><button type="button" className="toast-close" aria-label="Fechar aviso" onClick={() => setToastVisible(false)}>×</button></div>}
    <section className="section-head table-head"><div><h2>Cadastros na carteira</h2><p>{companies.length} empresas registradas</p></div><input aria-label="Buscar empresa" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por empresa ou CNPJ" /></section>
    <section className="panel table-wrap"><table><thead><tr><th scope="col">Empresa</th><th scope="col">CNPJ</th><th scope="col">Localidade</th><th scope="col">Situação</th><th scope="col">Responsável</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead><tbody>{listed.map((c) => <tr key={c.id}><td><strong>{c.razaoSocial}</strong><small>{c.fantasia}</small></td><td>{c.cnpj}</td><td>{c.cidade}/{c.estado}</td><td><Badge tone={statusTone(c.status)}>{c.status}</Badge></td><td>{c.responsaveis.join(", ")}</td><td className="row-menu"><button className="icon-button" aria-label={`Mais opções — ${c.razaoSocial}`} onClick={(e) => toggleMenu(c.id, e.currentTarget)}>⋯</button>{menuOpenId === c.id && menuAnchor && <>
      <button type="button" className="menu-backdrop" aria-label="Fechar menu" onClick={closeMenu} />
      <div ref={menuAcessivel.menuRef} className="dropdown-menu" role="menu" onKeyDown={menuAcessivel.aoTeclar} style={{ top: menuAnchor.top, right: menuAnchor.right }}><button type="button" role="menuitem" onClick={() => openEdit(c)}>Editar</button><button type="button" role="menuitem" className="danger" onClick={() => { dismissMenu(); setDeleting(c); setDeleteError(""); }}>Excluir</button></div>
    </>}</td></tr>)}</tbody></table>{listed.length === 0 && <Empty />}</section>
    {editing && <EmpresaEditModal empresa={editing} perfis={perfis} onClose={() => setEditing(null)} onSaved={handleEmpresaSalva} />}
    {deleting && <ConfirmarExclusaoEmpresa empresa={deleting} saving={deleteSaving} error={deleteError} onClose={() => setDeleting(null)} onConfirm={confirmDelete} />}
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
  return [e.fantasia, e.endereco, e.cnae, e.cnaeCodigo, e.responsaveis.length > 0 ? "x" : "", e.abertura, e.socios.length > 0 ? "x" : ""].filter(Boolean).length;
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
  const [empresaParaExcluir, setEmpresaParaExcluir] = useState<Empresa | null>(null);
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
    if (excluindoEmAndamento.current) return false;
    excluindoEmAndamento.current = true;
    setExcluindoId(id); setError("");
    try {
      await excluirEmpresa(id);
      const restantes = cartoes.filter((c) => c.id !== id);
      setExcluidos((prev) => new Set(prev).add(id));
      onResolved(restantes.length <= 1);
      return true;
    } catch (err) {
      const bruta = err instanceof Error ? err.message : "Não foi possível excluir a empresa";
      setError(`${semPontoFinal(bruta)}. Tente novamente.`);
      return false;
    } finally {
      excluindoEmAndamento.current = false;
      setExcluindoId(null);
    }
  };

  return <AccessibleModal label="Resolver duplicidade" onClose={onClose}><div className="modal duplicidade-modal">
    <button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button>
    <h2>Possível empresa duplicada</h2>
    <p>Estes cadastros parecem ser a mesma empresa. Compare os dados e exclua o(s) registro(s) duplicado(s) para manter a carteira consistente.</p>
    {error && <div className="notice error" role="alert"><p>{error}</p></div>}
    {cartoes.length <= 1 && idsDoCluster.size > cartoes.length && <div className="notice"><p>As outras empresas deste grupo não estão mais na carteira — esta divergência será limpa na próxima revalidação.</p></div>}
    <div className="duplicidade-compare">{cartoes.map((e) => { const divs = divergenciasPendentes(e.id, issues); return <article key={e.id} className="duplicidade-card">
      {cartoes.length > 1 && <span className={`badge success duplicidade-badge${divs === melhorDivergencias && completudeCadastro(e) === melhorCompletude ? "" : " duplicidade-badge-oculto"}`}>Cadastro mais confiável</span>}
      <strong>{e.razaoSocial}</strong>
      <small>{e.fantasia} · CNPJ {e.cnpj}</small>
      <div className="segmento-card-grid">
        <div><span>Situação</span><strong>{e.status}</strong></div>
        <div><span>Porte</span><strong>{e.porte}</strong></div>
        <div><span>Localidade</span><strong>{e.cidade}/{e.estado}</strong></div>
        <div><span>Responsável</span><strong>{e.responsaveis.length > 0 ? e.responsaveis.join(", ") : "—"}</strong></div>
        <div className="full"><span>CNAE</span><strong>{e.cnaeCodigo ? `${e.cnaeCodigo} · ${e.cnae}` : e.cnae || "Não informado"}</strong></div>
        <div className="full"><span>Endereço</span><strong>{e.endereco || "Não informado"}</strong></div>
      </div>
      <details className="socios-dropdown">
        <summary>Quadro societário{e.socios.length > 0 ? ` (${e.socios.length})` : ""}</summary>
        <div className="socios-list">{e.socios.length > 0 ? e.socios.map((s, i) => <p key={i} className="static-value">{s}</p>) : <p className="static-value">Nenhum sócio informado.</p>}</div>
      </details>
      <button type="button" className="primary danger" onClick={() => { setError(""); setEmpresaParaExcluir(e); }} disabled={excluindoId !== null}>{excluindoId === e.id ? "Excluindo…" : "Excluir esta empresa"}</button>
    </article>; })}</div>
    {empresaParaExcluir && <ConfirmarExclusaoEmpresa empresa={empresaParaExcluir} saving={excluindoId === empresaParaExcluir.id} error={error} onClose={() => setEmpresaParaExcluir(null)} onConfirm={async () => { if (await excluir(empresaParaExcluir.id)) setEmpresaParaExcluir(null); }} />}
  </div></AccessibleModal>;
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
    {actionError && <div className="notice error" role="alert"><p>{actionError}</p></div>}
    <section className="audit-summary">{types.slice(1).map((t) => <article key={t}><span>{t === "CNPJ inválido" ? "#" : "!"}</span><strong>{contarTipo(t)}</strong><p>{t}</p></article>)}</section>
    <section className="filters"><label>Tipo<select value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t}>{t}</option>)}</select></label><label>Tratamento<select value={status} onChange={(e) => setStatus(e.target.value)}>{["Todos", "Pendente", "Revisado", "Ignorado"].map((s) => <option key={s}>{s}</option>)}</select></label></section>
    <section className="panel table-wrap audit-table-wrap"><table className="audit-table"><thead><tr><th scope="col">Empresa</th><th scope="col">Ocorrência</th><th scope="col">Valor atual</th><th scope="col">Sugestão</th><th scope="col">Status</th><th scope="col">Ações</th></tr></thead><tbody>{filtered.map((i) => { const empresaDaLinha = companies.find((c) => c.id === i.empresaId); const tamanhoGrupo = tamanhoPorRepresentante.get(i.id); return <tr key={i.id}><td><strong>{i.empresa}</strong></td><td><Badge tone="neutral">{i.tipo}</Badge></td><td>{tamanhoGrupo && tamanhoGrupo > 2 ? `${tamanhoGrupo} cadastros com nome parecido entre si` : i.atual}{i.status === "Revisado" && i.sugerido && <><br /><small className="static-value">corrigido para: {i.sugerido}</small></>}</td><td>{i.sugerido || "—"}</td><td><Badge tone={i.status === "Pendente" ? "warning" : i.status === "Revisado" ? "success" : "neutral"}>{i.status}</Badge><br /><small className="static-value">{formatDataHoraBrasilia(i.resolvidoEm ?? i.detectadoEm)}</small></td><td className="actions audit-actions">
      {i.status !== "Revisado" ? <>
        {i.tipo === "Duplicidade" && <button className="table-action action-resolve" onClick={() => setDuplicidade(i)} disabled={updatingId === i.id}>Resolver duplicidade</button>}
        {TIPOS_CORRIGIVEIS_NO_CADASTRO.has(i.tipo) && <button className="table-action action-edit" onClick={() => empresaDaLinha && setCorrigindo(empresaDaLinha)} disabled={updatingId === i.id || !empresaDaLinha}>Corrigir cadastro</button>}
        {i.sugerido && <button className="table-action action-apply" onClick={() => update(i.id, "aplicar_sugestao")} disabled={updatingId === i.id}>Aplicar sugestão</button>}
        {i.status === "Pendente" && <button className="table-action action-ignore" onClick={() => update(i.id, "ignorar")} disabled={updatingId === i.id}>Ignorar</button>}
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
  const stateData = count("estado").sort((a, b) => b.value - a.value); const sizeData = count("porte"); const cnaeData = count("cnae").sort((a, b) => b.value - a.value); const statusData = count("status");
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
    <section className="filters analysis-filters"><input aria-label="Buscar por empresa ou CNAE" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar empresa ou atividade" />{[[state, setState, ["Todos", ...Array.from(new Set(companies.map((c) => c.estado)))]], [size, setSize, ["Todos", ...Array.from(new Set(companies.map((c) => c.porte)))]], [situation, setSituation, ["Todos", ...Array.from(new Set(companies.map((c) => c.status)))] ]].map(([value, setter, options], i) => <select key={i} value={value as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)}>{(options as string[]).map((o) => <option key={o}>{o}</option>)}</select>)}</section>
    {filtered.length === 0 ? <Empty title="Sem empresas para analisar" text="Nenhum cadastro corresponde aos filtros selecionados." /> : <Suspense fallback={<div className="chart-grid-loading">Carregando gráficos…</div>}><section className="chart-grid">
      <ChartCard title="Empresas por estado" hint="Clique para detalhar"><BarVisual data={stateData} scrollable onSelect={(nome) => abrirSegmento("estado", nome)} /></ChartCard>
      <ChartCard title="Distribuição por porte" hint="Clique para detalhar"><PieVisual data={sizeData} onSelect={(nome) => abrirSegmento("porte", nome)} /></ChartCard>
      <ChartCard title="Principais CNAEs" hint="Clique para ver empresas"><CnaeRanking data={cnaeData} onSelect={(nome) => abrirSegmento("cnae", nome)} /></ChartCard>
      <ChartCard title="Situação cadastral" hint="Clique para detalhar"><PieVisual data={statusData} onSelect={(nome) => abrirSegmento("status", nome)} /></ChartCard>
      <ChartCard title="Tempo de abertura" hint="Clique para detalhar"><BarVisual data={ages} onSelect={(nome) => abrirSegmento("idade", nome)} /></ChartCard>
      <article className="chart-card insight"><span>✦</span><h3>Leitura rápida</h3><p><strong>{filtered.filter((c) => c.status === "Ativa").length} empresas</strong> estão ativas. O perfil mais comum é <strong>{sizeData.sort((a,b) => b.value-a.value)[0]?.name}</strong>.</p><small>Dados atualizados a partir dos cadastros da carteira.</small></article>
    </section></Suspense>}
    {segmento && <SegmentoModal titulo={segmento.titulo} empresas={segmento.empresas} onClose={() => setSegmento(null)} />}
  </>;
}
function ChartCard({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) { return <article className="chart-card"><h3>{title}{hint && <small className="chart-hint">{hint}</small>}</h3><div className="chart">{children}</div></article>; }
function CnaeRanking({ data, onSelect }: { data: { name: string; value: number }[]; onSelect: (name: string) => void }) {
  const maiorValor = Math.max(...data.map((item) => item.value), 1);
  return <div className="cnae-ranking-scroll"><div className="cnae-ranking" role="list" aria-label="Ranking de CNAEs">
    {data.map((item, index) => <li key={item.name}><button type="button" className="cnae-ranking-item" onClick={() => onSelect(item.name)} aria-label={`Ver empresas do CNAE ${item.name}`}>
      <span className="cnae-ranking-position">{String(index + 1).padStart(2, "0")}</span><span className="cnae-ranking-content"><strong>{item.name}</strong><span className="cnae-ranking-track" aria-hidden="true"><i style={{ width: `${Math.max((item.value / maiorValor) * 100, 5)}%` }} /></span></span><span className="cnae-ranking-value"><strong>{item.value}</strong><small>{item.value === 1 ? "empresa" : "empresas"}</small></span>
    </button></li>)}
  </div></div>;
}

function SegmentoModal({ titulo, empresas, onClose }: { titulo: string; empresas: Empresa[]; onClose: () => void }) {
  return <AccessibleModal label={`Empresas — ${titulo}`} onClose={onClose}><div className="modal segmento-modal"><button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button><h2>{titulo}</h2><p>{empresas.length} {empresas.length === 1 ? "empresa encontrada" : "empresas encontradas"}</p>
    {empresas.length === 0 ? <Empty title="Nenhuma empresa aqui" text="Não há cadastros correspondentes a este grupo." /> : <div className="segmento-list">{empresas.map((e) => <article key={e.id} className="segmento-card">
      <div className="segmento-card-head"><strong>{e.razaoSocial}</strong><Badge tone={statusTone(e.status)}>{e.status}</Badge></div>
      <p className="segmento-card-sub">{e.fantasia} · CNPJ {e.cnpj}</p>
      <div className="segmento-card-grid">
        <div><span>Localidade</span><strong>{e.cidade}/{e.estado}</strong></div>
        <div><span>Porte</span><strong>{e.porte}</strong></div>
        <div><span>CNAE</span><strong>{e.cnaeCodigo ? `${e.cnaeCodigo} · ${e.cnae}` : e.cnae || "Não informado"}</strong></div>
        <div><span>Responsável</span><strong>{e.responsaveis.length > 0 ? e.responsaveis.join(", ") : "—"}</strong></div>
        <div className="full"><span>Endereço</span><strong>{e.endereco || "Não informado"}</strong></div>
      </div>
    </article>)}</div>}
  </div></AccessibleModal>;
}
