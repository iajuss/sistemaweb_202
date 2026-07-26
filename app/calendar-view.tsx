"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
  atualizarModeloRecorrencia, atualizarTarefa, criarModeloRecorrencia, criarTarefa,
  listarModelosRecorrencia, listarTarefas,
  type Empresa, type ModeloRecorrencia, type Periodicidade, type Tarefa,
} from "../src/services/portfolio";
import { editarTarefa, excluirTarefa } from "../src/services/tarefas-extra";

const formatDate = (date: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00`));
const formatDataLonga = (date: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00`));
/** Evita "...obrigatórios.. Tente novamente." quando a mensagem do servidor já termina em ponto. */
const semPontoFinal = (mensagem: string) => mensagem.replace(/\.+$/, "");

const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const pad2 = (n: number) => String(n).padStart(2, "0");

// Nomes dos dias da semana na convenção do backend (1=segunda … 7=domingo),
// usada por `calcularVencimentosDoModelo` em lib/tarefas.ts.
const DIAS_SEMANA: [number, string][] = [
  [1, "segunda-feira"], [2, "terça-feira"], [3, "quarta-feira"],
  [4, "quinta-feira"], [5, "sexta-feira"], [6, "sábado"], [7, "domingo"],
];

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Empty({ title = "Nenhum resultado encontrado", text = "Ajuste seus filtros ou tente novamente." }) {
  return <div className="empty"><span>⌕</span><strong>{title}</strong><p>{text}</p></div>;
}

function descreverRecorrencia(m: ModeloRecorrencia): string {
  if (m.periodicidade === "semanal") {
    const dia = DIAS_SEMANA.find(([n]) => n === m.diaReferencia)?.[1] ?? `dia ${m.diaReferencia}`;
    return `Semanal · ${dia}`;
  }
  if (m.periodicidade === "anual") return `Anual · dia ${m.diaReferencia}`;
  return `Mensal · dia ${m.diaReferencia}`;
}

const nomeEmpresaTarefa = (t: Tarefa) => (t.empresa && t.empresa.trim() !== "" ? t.empresa : "Reunião interna");
const naturezaTarefa = (t: Tarefa): "Interna" | "Externa" => (t.empresaId ? "Externa" : t.tipo === "Interna" ? "Interna" : "Externa");

/** Modal de edição de uma tarefa: título, natureza (Interna/Externa),
 * empresa cliente (quando externa), responsável e vencimento. */
function TarefaEditModal({ tarefa, companies, perfis, onClose, onSaved }: {
  tarefa: Tarefa; companies: Empresa[]; perfis: { id: string; nome: string }[];
  onClose: () => void; onSaved: (tarefa: Tarefa) => void;
}) {
  const [titulo, setTitulo] = useState(tarefa.titulo);
  const [natureza, setNatureza] = useState<"Interna" | "Externa">(naturezaTarefa(tarefa));
  const [empresaId, setEmpresaId] = useState(tarefa.empresaId ?? (companies[0]?.id ?? ""));
  const [responsavelId, setResponsavelId] = useState(tarefa.responsavelId ?? "");
  const [vencimento, setVencimento] = useState(tarefa.vencimento);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const semEmpresa = natureza === "Externa" && companies.length === 0;

  const escolherExterna = () => setNatureza("Externa");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (natureza === "Externa" && !empresaId) { setError("Selecione a empresa cliente da tarefa externa."); return; }
    setSaving(true); setError("");
    try {
      const atualizada = await editarTarefa(tarefa.id, {
        titulo,
        tipo: natureza,
        empresaId: natureza === "Externa" ? empresaId : null,
        responsavelId: responsavelId || null,
        vencimento,
      });
      onSaved(atualizada);
    } catch (err) {
      const bruta = err instanceof Error ? err.message : "Não foi possível atualizar a tarefa";
      setError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setSaving(false);
    }
  };

  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={`Editar ${tarefa.titulo}`}><form className="modal" onSubmit={save}>
    <button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button>
    <h2>Editar tarefa</h2>
    <label>Título<input required value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Conferência de documentos" /></label>
    <div className="field-block">
      <span className="field-label">Natureza da tarefa</span>
      <div className="segmented" role="group" aria-label="Natureza da tarefa">
        <button type="button" className={natureza === "Interna" ? "selected" : ""} onClick={() => setNatureza("Interna")}>Interna</button>
        <button type="button" className={natureza === "Externa" ? "selected" : ""} onClick={escolherExterna}>Externa</button>
      </div>
      <small className="field-hint">{natureza === "Interna" ? "Reunião ou atividade da própria equipe." : "Compromisso com uma empresa cliente."}</small>
    </div>
    {natureza === "Externa" && companies.length > 0 && <label>Empresa<select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>{companies.map((c) => <option key={c.id} value={c.id}>{c.fantasia}</option>)}</select></label>}
    <label>Responsável<select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}><option value="">Selecione…</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
    <label>Vencimento<input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></label>
    {semEmpresa && <p className="inline-error">Nenhuma empresa cadastrada — cadastre uma no Onboarding para vincular tarefas externas.</p>}
    {error && <div className="notice error"><p>{error}</p></div>}
    <button className="primary" disabled={saving || semEmpresa}>{saving ? "Salvando…" : "Salvar alterações"}</button>
  </form></div>;
}

export function Calendar({ tasks, setTasks, companies, perfis }: { tasks: Tarefa[]; setTasks: (tasks: Tarefa[]) => void; companies: Empresa[]; perfis: { id: string; nome: string }[] }) {
  const hoje = new Date();
  const anoHoje = hoje.getFullYear();
  const mesHojeIndex = hoje.getMonth(); // 0-11
  const mesAtualISO = `${anoHoje}-${pad2(mesHojeIndex + 1)}`;
  const dataHojeISO = `${anoHoje}-${pad2(mesHojeIndex + 1)}-${pad2(hoje.getDate())}`;

  // Mês/ano em visualização (feature de navegação). Começa no mês atual.
  const [viewAno, setViewAno] = useState(anoHoje);
  const [viewMes, setViewMes] = useState(mesHojeIndex);
  const mesISO = `${viewAno}-${pad2(viewMes + 1)}`;
  const isMesAtual = mesISO === mesAtualISO;
  const mesLabel = `${MESES_PT[viewMes]} de ${viewAno}`;
  const diasNoMes = new Date(viewAno, viewMes + 1, 0).getDate();
  const primeiroDiaSemana = new Date(viewAno, viewMes, 1).getDay(); // 0=Dom
  const monthDays = Array.from({ length: diasNoMes }, (_, i) => i + 1);

  const [mode, setMode] = useState<"month" | "list">("month");
  const [responsible, setResponsible] = useState("Todos");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [concluindoId, setConcluindoId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ titulo: "", natureza: "Interna" as "Interna" | "Externa", empresaId: companies[0]?.id ?? "", responsavelId: perfis[0]?.id ?? "", vencimento: dataHojeISO });

  // Tarefas do mês em visualização. No mês atual, espelha as `tasks` do
  // componente pai (usadas também pela Visão geral); em outros meses, são
  // buscadas sob demanda.
  const [monthTasks, setMonthTasks] = useState<Tarefa[]>(tasks);
  const [monthLoading, setMonthLoading] = useState(false);

  // Interações com uma tarefa individual
  const [detalhe, setDetalhe] = useState<{ tarefa: Tarefa; top: number; left: number } | null>(null);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const [editingTask, setEditingTask] = useState<Tarefa | null>(null);
  const [deletingTask, setDeletingTask] = useState<Tarefa | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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

  // No mês atual, espelha as tarefas do pai.
  useEffect(() => {
    if (isMesAtual) setMonthTasks(tasks);
  }, [tasks, isMesAtual]);

  // Ao navegar para outro mês, busca as tarefas daquele mês.
  useEffect(() => {
    if (isMesAtual) return;
    let cancel = false;
    setMonthLoading(true);
    setTaskError("");
    listarTarefas(mesISO)
      .then((t) => { if (!cancel) setMonthTasks(t); })
      .catch(() => { if (!cancel) setTaskError("Não foi possível carregar as tarefas deste mês. Atualize a página."); })
      .finally(() => { if (!cancel) setMonthLoading(false); });
    return () => { cancel = true; };
  }, [mesISO, isMesAtual]);

  const people = ["Todos", ...Array.from(new Set(perfis.map((p) => p.nome)))];
  const shown = monthTasks.filter((t) => responsible === "Todos" || t.responsavel === responsible);

  const recarregarMes = async (falhaParcial: string) => {
    try {
      const atualizadas = await listarTarefas(mesISO);
      setMonthTasks(atualizadas);
      if (isMesAtual) setTasks(atualizadas);
    } catch {
      setTaskError(falhaParcial);
    }
  };

  const abrirNovaTarefa = () => {
    setTaskError("");
    setDraft({
      titulo: "",
      natureza: "Interna",
      empresaId: companies[0]?.id ?? "",
      responsavelId: perfis[0]?.id ?? "",
      vencimento: isMesAtual ? dataHojeISO : `${mesISO}-01`,
    });
    setOpen(true);
  };

  const escolherExternaNoDraft = () => {
    setDraft((d) => ({ ...d, natureza: "Externa", empresaId: d.empresaId || companies[0]?.id || "" }));
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (draft.natureza === "Externa" && !draft.empresaId) {
      setTaskError("Selecione a empresa cliente da tarefa externa.");
      return;
    }
    setSaving(true); setTaskError("");
    try {
      await criarTarefa({
        titulo: draft.titulo,
        tipo: draft.natureza,
        empresaId: draft.natureza === "Externa" ? draft.empresaId : "",
        responsavelId: draft.responsavelId || null,
        vencimento: draft.vencimento,
      });
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível criar a tarefa";
      setTaskError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setSaving(false);
      return;
    }
    await recarregarMes("Tarefa criada, mas não foi possível atualizar a lista. Atualize a página.");
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
    setDetalhe(null);
    await recarregarMes("Tarefa concluída, mas não foi possível atualizar a lista. Atualize a página.");
    setConcluindoId(null);
  };

  const handleTarefaEditada = async () => {
    setEditingTask(null);
    await recarregarMes("Tarefa atualizada, mas não foi possível atualizar a lista. Atualize a página.");
  };

  const confirmDeleteTask = async () => {
    if (!deletingTask) return;
    setDeleteSaving(true); setDeleteError("");
    try {
      await excluirTarefa(deletingTask.id);
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível excluir a tarefa";
      setDeleteError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setDeleteSaving(false);
      return;
    }
    setDeletingTask(null);
    setDetalhe(null);
    await recarregarMes("Tarefa excluída, mas não foi possível atualizar a lista. Atualize a página.");
    setDeleteSaving(false);
  };

  const abrirDetalhe = (t: Tarefa, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 300);
    setDetalhe({ tarefa: t, top: rect.bottom + 6, left: Math.max(12, left) });
  };

  const toggleTaskMenu = (id: string, target: HTMLElement) => {
    if (menuTaskId === id) { setMenuTaskId(null); setMenuAnchor(null); return; }
    const rect = target.getBoundingClientRect();
    setMenuAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuTaskId(id);
  };
  const closeTaskMenu = () => { setMenuTaskId(null); setMenuAnchor(null); };

  const irMes = (delta: number) => {
    let m = viewMes + delta;
    let a = viewAno;
    if (m < 0) { m = 11; a -= 1; }
    if (m > 11) { m = 0; a += 1; }
    setDetalhe(null); closeTaskMenu();
    setViewMes(m); setViewAno(a);
  };
  const irAno = (delta: number) => { setDetalhe(null); closeTaskMenu(); setViewAno((a) => a + delta); };
  const irHoje = () => { setDetalhe(null); closeTaskMenu(); setViewMes(mesHojeIndex); setViewAno(anoHoje); };

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
  const semEmpresaExterna = draft.natureza === "Externa" && companies.length === 0;

  return <>
    <section className="section-head"><div><h2>Calendário contábil</h2><p>{mesLabel} · obrigações e rotinas da carteira.</p></div><button className="primary" onClick={abrirNovaTarefa}>+ Nova tarefa</button></section>
    {taskError && <div className="notice error"><p>{taskError}</p></div>}

    <section className="calendar-nav">
      <div className="calendar-nav-group">
        <button type="button" className="nav-arrow" aria-label="Ano anterior" title="Ano anterior" onClick={() => irAno(-1)}>«</button>
        <button type="button" className="nav-arrow" aria-label="Mês anterior" title="Mês anterior" onClick={() => irMes(-1)}>‹</button>
      </div>
      <div className="calendar-nav-label"><strong>{MESES_PT[viewMes]}</strong><span>{viewAno}</span></div>
      <div className="calendar-nav-group">
        <button type="button" className="nav-arrow" aria-label="Próximo mês" title="Próximo mês" onClick={() => irMes(1)}>›</button>
        <button type="button" className="nav-arrow" aria-label="Próximo ano" title="Próximo ano" onClick={() => irAno(1)}>»</button>
        {!isMesAtual && <button type="button" className="nav-today" onClick={irHoje}>Hoje</button>}
      </div>
    </section>

    <section className="calendar-toolbar"><div className="tabs"><button className={mode === "month" ? "selected" : ""} onClick={() => setMode("month")}>Calendário</button><button className={mode === "list" ? "selected" : ""} onClick={() => setMode("list")}>Lista</button></div><label>Responsável <select value={responsible} onChange={(e) => setResponsible(e.target.value)}>{people.map((p) => <option key={p}>{p}</option>)}</select></label></section>

    {monthLoading ? <section className="panel"><div className="empty"><span>◷</span><strong>Carregando {mesLabel.toLowerCase()}…</strong><p>Buscando as tarefas deste mês.</p></div></section> : mode === "month" ? <section className="calendar"><div className="weekdays">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <span key={d}>{d}</span>)}</div><div className="day-grid">{Array.from({ length: primeiroDiaSemana }, (_, i) => <div className="day muted" key={`blank-${i}`} />)}{monthDays.map((day) => { const date = `${mesISO}-${pad2(day)}`; const items = shown.filter((t) => t.vencimento === date); const holiday = items.find((t) => t.coincideComFeriado)?.coincideComFeriado ?? null; const ehHoje = isMesAtual && date === dataHojeISO; return <div className={`day ${holiday ? "holiday" : ""} ${ehHoje ? "is-today" : ""}`} key={day}><span>{day}</span>{holiday && <small title={holiday.nome}>Feriado</small>}{items.map((t) => <button className={`calendar-task ${t.status === "Atrasada" ? "late" : ""} ${t.status === "Concluída" ? "done" : ""}`} key={t.id} title="Ver detalhes" onClick={(e) => abrirDetalhe(t, e.currentTarget)}>{t.titulo}</button>)}</div>; })}</div></section> : <section className="panel list-tasks">{shown.map((t) => <div className="task-line" key={t.id}><time>{formatDate(t.vencimento)}</time><div><strong>{t.titulo}</strong><small>{nomeEmpresaTarefa(t)} · {t.responsavel || "Sem responsável"}</small></div>{t.coincideComFeriado && <Badge tone="warning">Feriado: {t.coincideComFeriado.nome}</Badge>}<Badge tone={t.status === "Atrasada" ? "danger" : t.status === "Concluída" ? "success" : "blue"}>{t.status}</Badge><div className="row-menu"><button className="icon-button" aria-label={`Mais opções — ${t.titulo}`} onClick={(e) => toggleTaskMenu(t.id, e.currentTarget)}>⋯</button>{menuTaskId === t.id && menuAnchor && <>
      <button type="button" className="menu-backdrop" aria-label="Fechar menu" onClick={closeTaskMenu} />
      <div className="dropdown-menu" role="menu" style={{ top: menuAnchor.top, right: menuAnchor.right }}>{t.status !== "Concluída" && <button type="button" role="menuitem" disabled={concluindoId === t.id} onClick={() => { closeTaskMenu(); concluir(t.id); }}>{concluindoId === t.id ? "Concluindo…" : "Concluir"}</button>}<button type="button" role="menuitem" onClick={() => { closeTaskMenu(); setEditingTask(t); }}>Editar</button><button type="button" role="menuitem" className="danger" onClick={() => { closeTaskMenu(); setDeletingTask(t); setDeleteError(""); }}>Excluir</button></div>
    </>}</div></div>)}{shown.length === 0 && <Empty title="Nenhuma tarefa neste mês" text="Cadastre uma tarefa avulsa ou um modelo de recorrência." />}</section>}

    {detalhe && <>
      <button type="button" className="menu-backdrop" aria-label="Fechar detalhes" onClick={() => setDetalhe(null)} />
      <div className="task-popover" role="dialog" aria-label={`Detalhes — ${detalhe.tarefa.titulo}`} style={{ top: detalhe.top, left: detalhe.left }}>
        <div className="task-popover-head"><strong>{detalhe.tarefa.titulo}</strong><button type="button" className="close" onClick={() => setDetalhe(null)} aria-label="Fechar">×</button></div>
        <dl className="task-popover-body">
          <div><dt>Natureza</dt><dd>{naturezaTarefa(detalhe.tarefa)}</dd></div>
          <div><dt>{naturezaTarefa(detalhe.tarefa) === "Interna" ? "Equipe" : "Empresa"}</dt><dd>{nomeEmpresaTarefa(detalhe.tarefa)}</dd></div>
          <div><dt>Responsável</dt><dd>{detalhe.tarefa.responsavel || "Sem responsável"}</dd></div>
          <div><dt>Vencimento</dt><dd>{formatDataLonga(detalhe.tarefa.vencimento)}</dd></div>
          <div><dt>Situação</dt><dd><Badge tone={detalhe.tarefa.status === "Atrasada" ? "danger" : detalhe.tarefa.status === "Concluída" ? "success" : "blue"}>{detalhe.tarefa.status}</Badge></dd></div>
        </dl>
        {detalhe.tarefa.coincideComFeriado && <p className="task-popover-holiday">⚑ Coincide com feriado: {detalhe.tarefa.coincideComFeriado.nome}</p>}
        <div className="task-popover-actions">
          {detalhe.tarefa.status !== "Concluída" && <button type="button" disabled={concluindoId === detalhe.tarefa.id} onClick={() => concluir(detalhe.tarefa.id)}>{concluindoId === detalhe.tarefa.id ? "Concluindo…" : "Concluir"}</button>}
          <button type="button" onClick={() => { const t = detalhe.tarefa; setDetalhe(null); setEditingTask(t); }}>Editar</button>
          <button type="button" className="danger" onClick={() => { const t = detalhe.tarefa; setDetalhe(null); setDeletingTask(t); setDeleteError(""); }}>Excluir</button>
        </div>
      </div>
    </>}

    <section className="section-head"><div><h2>Modelos recorrentes</h2><p>Tarefas geradas automaticamente todo mês, conforme a periodicidade.</p></div><button className="primary" onClick={() => setModeloOpen(true)}>+ Novo modelo</button></section>
    {modeloError && <div className="notice error"><p>{modeloError}</p></div>}
    <section className="panel table-wrap">
      <table>
        <thead><tr><th>Título</th><th>Tipo</th><th>Periodicidade</th><th>Empresa</th><th>Responsável</th><th>Situação</th><th></th></tr></thead>
        <tbody>
          {modelos.map((m) => <tr key={m.id}>
            <td><strong>{m.titulo}</strong></td>
            <td>{m.tipo}</td>
            <td>{descreverRecorrencia(m)}</td>
            <td>{m.empresa}</td>
            <td>{m.responsavel || "—"}</td>
            <td><Badge tone={m.ativo ? "success" : "neutral"}>{m.ativo ? "Ativo" : "Inativo"}</Badge></td>
            <td>{m.ativo && <button className="icon-button" disabled={atualizandoModeloId === m.id} onClick={() => desativarModelo(m.id)}>{atualizandoModeloId === m.id ? "Desativando…" : "Desativar"}</button>}</td>
          </tr>)}
        </tbody>
      </table>
      {modelosCarregados && modelos.length === 0 && <Empty title="Nenhum modelo de recorrência" text="Cadastre um modelo para gerar tarefas automaticamente." />}
    </section>

    {open && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Nova tarefa"><form className="modal" onSubmit={add}>
      <button type="button" className="close" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
      <h2>Nova tarefa</h2>
      <p>Cadastre uma obrigação avulsa da carteira.</p>
      <label>Título<input required value={draft.titulo} onChange={(e) => setDraft({ ...draft, titulo: e.target.value })} placeholder="Ex.: Conferência de documentos" /></label>
      <div className="field-block">
        <span className="field-label">Natureza da tarefa</span>
        <div className="segmented" role="group" aria-label="Natureza da tarefa">
          <button type="button" className={draft.natureza === "Interna" ? "selected" : ""} onClick={() => setDraft({ ...draft, natureza: "Interna" })}>Interna</button>
          <button type="button" className={draft.natureza === "Externa" ? "selected" : ""} onClick={escolherExternaNoDraft}>Externa</button>
        </div>
        <small className="field-hint">{draft.natureza === "Interna" ? "Reunião ou atividade da própria equipe." : "Compromisso com uma empresa cliente."}</small>
      </div>
      {draft.natureza === "Externa" && companies.length > 0 && <label>Empresa<select value={draft.empresaId} onChange={(e) => setDraft({ ...draft, empresaId: e.target.value })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.fantasia}</option>)}</select></label>}
      <label>Responsável<select value={draft.responsavelId} onChange={(e) => setDraft({ ...draft, responsavelId: e.target.value })}><option value="">Selecione…</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
      <label>Vencimento<input type="date" value={draft.vencimento} onChange={(e) => setDraft({ ...draft, vencimento: e.target.value })} /></label>
      {semEmpresaExterna && <p className="inline-error">Nenhuma empresa cadastrada — cadastre uma no Onboarding para criar tarefas externas.</p>}
      <button className="primary" disabled={saving || semEmpresaExterna}>{saving ? "Salvando…" : "Salvar tarefa"}</button>
    </form></div>}

    {modeloOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Novo modelo de recorrência"><form className="modal" onSubmit={criarModelo}>
      <button type="button" className="close" onClick={() => setModeloOpen(false)} aria-label="Fechar">×</button>
      <h2>Novo modelo de recorrência</h2>
      <p>Gera tarefas automaticamente a cada mês, ao abrir o calendário.</p>
      <label>Título<input required value={modeloDraft.titulo} onChange={(e) => setModeloDraft({ ...modeloDraft, titulo: e.target.value })} placeholder="Ex.: Fechamento da folha" /></label>
      <label>Tipo<input required value={modeloDraft.tipo} onChange={(e) => setModeloDraft({ ...modeloDraft, tipo: e.target.value })} placeholder="Ex.: Fiscal" /></label>
      <label>Periodicidade<select value={modeloDraft.periodicidade} onChange={(e) => setModeloDraft({ ...modeloDraft, periodicidade: e.target.value as Periodicidade, diaReferencia: 1 })}><option value="mensal">Mensal</option><option value="semanal">Semanal</option><option value="anual">Anual</option></select></label>
      {modeloDraft.periodicidade === "semanal"
        ? <label>Dia da semana<select value={modeloDraft.diaReferencia} onChange={(e) => setModeloDraft({ ...modeloDraft, diaReferencia: Number(e.target.value) })}>{DIAS_SEMANA.map(([n, label]) => <option key={n} value={n}>{label}</option>)}</select></label>
        : <label>Dia do mês<input type="number" min={1} max={maxDiaReferencia} required value={modeloDraft.diaReferencia} onChange={(e) => setModeloDraft({ ...modeloDraft, diaReferencia: Number(e.target.value) })} /></label>}
      <label>Empresa<select value={modeloDraft.empresaId} onChange={(e) => setModeloDraft({ ...modeloDraft, empresaId: e.target.value })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.fantasia}</option>)}</select></label>
      <label>Responsável<select value={modeloDraft.responsavelId} onChange={(e) => setModeloDraft({ ...modeloDraft, responsavelId: e.target.value })}><option value="">Selecione…</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
      <button className="primary" disabled={modeloSaving}>{modeloSaving ? "Salvando…" : "Salvar modelo"}</button>
    </form></div>}

    {editingTask && <TarefaEditModal tarefa={editingTask} companies={companies} perfis={perfis} onClose={() => setEditingTask(null)} onSaved={handleTarefaEditada} />}

    {deletingTask && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Confirmar exclusão"><div className="modal"><button type="button" className="close" onClick={() => setDeletingTask(null)} aria-label="Fechar">×</button><h2>Excluir tarefa</h2><p>Tem certeza que deseja excluir <strong>{deletingTask.titulo}</strong>? Essa ação não pode ser desfeita.</p>{deleteError && <div className="notice error"><p>{deleteError}</p></div>}<button type="button" className="primary danger" onClick={confirmDeleteTask} disabled={deleteSaving}>{deleteSaving ? "Excluindo…" : "Excluir definitivamente"}</button></div></div>}
  </>;
}
