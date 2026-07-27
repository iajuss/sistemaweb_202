"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
  atualizarModeloRecorrencia, atualizarTarefa, criarModeloRecorrencia, criarTarefa, excluirModeloRecorrencia,
  listarModelosRecorrencia, listarTarefas,
  type Empresa, type ModeloRecorrencia, type Periodicidade, type Tarefa, type UnidadeRepeticao,
} from "../src/services/portfolio";
import { AccessibleModal, useAccessibleMenu, useDismissOnViewportChange } from "./accessibility";
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
// Rótulos curtos para os chips de seleção múltipla de dias da semana.
const DIAS_SEMANA_CURTO: [number, string][] = [
  [1, "Seg"], [2, "Ter"], [3, "Qua"], [4, "Qui"], [5, "Sex"], [6, "Sáb"], [7, "Dom"],
];

// Rótulo (singular, plural) de cada unidade de repetição, para "1 mês" vs "2 meses".
const UNIDADE_LABEL: Record<UnidadeRepeticao, [string, string]> = {
  dias: ["dia", "dias"],
  meses: ["mês", "meses"],
  anos: ["ano", "anos"],
};
const rotuloUnidade = (quantidade: number, unidade: UnidadeRepeticao) => UNIDADE_LABEL[unidade][quantidade === 1 ? 0 : 1];
const UNIDADE_TEXTO: Record<UnidadeRepeticao, string> = { dias: "Dias", meses: "Meses", anos: "Anos" };

// Ordem de grandeza das periodicidades e das unidades, menor pra maior —
// a unidade de "repetir por" só pode ser de valor igual ou maior que a
// própria periodicidade (não faz sentido um modelo "anual" repetir só "por
// 3 dias"). Não existe unidade "semanas": para "semanal" a menor unidade
// cabível é "meses". Espelha `lib/modelos-recorrencia.ts` no backend.
const ORDEM_UNIDADE: Record<UnidadeRepeticao, number> = { dias: 1, meses: 2, anos: 3 };
const UNIDADE_MINIMA: Record<Periodicidade, UnidadeRepeticao> = {
  diario: "dias", semanal: "meses", mensal: "meses", anual: "anos",
};
const UNIDADES_REPETICAO: UnidadeRepeticao[] = ["dias", "meses", "anos"];
function unidadesValidas(periodicidade: Periodicidade): UnidadeRepeticao[] {
  const minimo = ORDEM_UNIDADE[UNIDADE_MINIMA[periodicidade]];
  return UNIDADES_REPETICAO.filter((u) => ORDEM_UNIDADE[u] >= minimo);
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Empty({ title = "Nenhum resultado encontrado", text = "Ajuste seus filtros ou tente novamente." }) {
  return <div className="empty"><span aria-hidden="true">⌕</span><strong>{title}</strong><p>{text}</p></div>;
}

function descreverRecorrencia(m: ModeloRecorrencia): string {
  let base: string;
  if (m.periodicidade === "diario") {
    base = "Diário";
  } else if (m.periodicidade === "semanal") {
    const dias = m.diasSemana && m.diasSemana.length > 0
      ? m.diasSemana.map((n) => DIAS_SEMANA_CURTO.find(([num]) => num === n)?.[1] ?? `dia ${n}`).join(", ")
      : (DIAS_SEMANA.find(([n]) => n === m.diaReferencia)?.[1] ?? `dia ${m.diaReferencia}`);
    base = `Semanal · ${dias}`;
  } else if (m.periodicidade === "anual") {
    const mes = m.mesReferencia ? MESES_PT[m.mesReferencia - 1].toLowerCase() : null;
    base = mes ? `Anual · ${m.diaReferencia} de ${mes}` : `Anual · dia ${m.diaReferencia}`;
  } else {
    base = `Mensal · dia ${m.diaReferencia}`;
  }

  if (m.repeticoesQuantidade && m.repeticoesUnidade) {
    base += ` · por ${m.repeticoesQuantidade} ${rotuloUnidade(m.repeticoesQuantidade, m.repeticoesUnidade)}`;
  }
  return base;
}

const nomeEmpresaTarefa = (t: Tarefa) => (t.empresa && t.empresa.trim() !== "" ? t.empresa : "Reunião interna");
// Deriva só de `empresaId` (não de `tipo`): tarefas geradas a partir de um
// modelo de recorrência interno herdam o `tipo` livre do modelo (ex.:
// "Fiscal"), não o literal "Interna" usado só por tarefas avulsas — checar
// `tipo === "Interna"` classificaria essas tarefas geradas erroneamente como
// "Externa".
const naturezaTarefa = (t: Tarefa): "Interna" | "Externa" => (t.empresaId ? "Externa" : "Interna");

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

  return <AccessibleModal label={`Editar ${tarefa.titulo}`} onClose={onClose}><form className="modal" onSubmit={save}>
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
    <label>Responsável<select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}><option value="">Sem responsável</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
    <label>Vencimento<input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></label>
    {semEmpresa && <p className="inline-error">Nenhuma empresa cadastrada — cadastre uma no Onboarding para vincular tarefas externas.</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p></div>}
    <button className="primary" disabled={saving || semEmpresa}>{saving ? "Salvando…" : "Salvar alterações"}</button>
  </form></AccessibleModal>;
}

/** Modal de edição de um modelo de recorrência: título, natureza
 * (Interna/Externa), tipo, periodicidade, repetição, empresa cliente
 * (quando externo) e responsável. */
function ModeloEditModal({ modelo, companies, perfis, onClose, onSaved }: {
  modelo: ModeloRecorrencia; companies: Empresa[]; perfis: { id: string; nome: string }[];
  onClose: () => void; onSaved: (modelo: ModeloRecorrencia) => void;
}) {
  const [titulo, setTitulo] = useState(modelo.titulo);
  const [natureza, setNatureza] = useState<"Interna" | "Externa">(modelo.empresaId ? "Externa" : "Interna");
  const [tipo, setTipo] = useState(modelo.tipo);
  const [periodicidade, setPeriodicidade] = useState<Periodicidade>(modelo.periodicidade);
  const [diaReferencia, setDiaReferencia] = useState(modelo.diaReferencia);
  const [diasSemana, setDiasSemana] = useState<number[]>(modelo.diasSemana ?? []);
  const [mesReferencia, setMesReferencia] = useState(modelo.mesReferencia ?? new Date().getMonth() + 1);
  const [repeticoesQuantidade, setRepeticoesQuantidade] = useState<number | null>(modelo.repeticoesQuantidade);
  const [repeticoesUnidade, setRepeticoesUnidade] = useState<UnidadeRepeticao | null>(modelo.repeticoesUnidade);
  const [empresaId, setEmpresaId] = useState(modelo.empresaId ?? (companies[0]?.id ?? ""));
  const [responsavelId, setResponsavelId] = useState(modelo.responsavelId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const semEmpresa = natureza === "Externa" && companies.length === 0;

  const alterarPeriodicidade = (p: Periodicidade) => {
    setPeriodicidade(p);
    setDiaReferencia(1);
    setDiasSemana([]);
    if (repeticoesQuantidade !== null) setRepeticoesUnidade(unidadesValidas(p)[0]);
  };

  const alternarDiaSemana = (dia: number) => {
    setDiasSemana((atual) => (atual.includes(dia) ? atual.filter((d) => d !== dia) : [...atual, dia].sort((a, b) => a - b)));
  };

  const iniciarRepeticaoLimitada = () => {
    setRepeticoesQuantidade(1);
    setRepeticoesUnidade(unidadesValidas(periodicidade)[0]);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (natureza === "Externa" && !empresaId) { setError("Selecione a empresa cliente do modelo externo."); return; }
    if (periodicidade === "semanal" && diasSemana.length === 0) { setError("Selecione pelo menos um dia da semana."); return; }
    setSaving(true); setError("");
    try {
      const atualizado = await atualizarModeloRecorrencia(modelo.id, {
        titulo, tipo, periodicidade, diaReferencia, repeticoesQuantidade, repeticoesUnidade,
        diasSemana: periodicidade === "semanal" ? diasSemana : undefined,
        mesReferencia: periodicidade === "anual" ? mesReferencia : undefined,
        empresaId: natureza === "Externa" ? empresaId : null,
        responsavelId: responsavelId || null,
      });
      onSaved(atualizado);
    } catch (err) {
      const bruta = err instanceof Error ? err.message : "Não foi possível atualizar o modelo de recorrência";
      setError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setSaving(false);
    }
  };

  return <AccessibleModal label={`Editar ${modelo.titulo}`} onClose={onClose}><form className="modal" onSubmit={save}>
    <button type="button" className="close" onClick={onClose} aria-label="Fechar">×</button>
    <h2>Editar modelo de recorrência</h2>
    <label>Título<input required value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Fechamento da folha" /></label>
    <div className="field-block">
      <span className="field-label">Natureza do modelo</span>
      <div className="segmented" role="group" aria-label="Natureza do modelo">
        <button type="button" className={natureza === "Interna" ? "selected" : ""} onClick={() => setNatureza("Interna")}>Interna</button>
        <button type="button" className={natureza === "Externa" ? "selected" : ""} onClick={() => setNatureza("Externa")}>Externa</button>
      </div>
      <small className="field-hint">{natureza === "Interna" ? "Rotina ou reunião recorrente da própria equipe." : "Obrigação recorrente de uma empresa cliente."}</small>
    </div>
    <label>Tipo<input required value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Ex.: Fiscal" /></label>
    <label>Periodicidade<select value={periodicidade} onChange={(e) => alterarPeriodicidade(e.target.value as Periodicidade)}><option value="diario">Diário</option><option value="semanal">Semanal</option><option value="mensal">Mensal</option><option value="anual">Anual</option></select></label>
    {periodicidade === "semanal" && <div className="field-block">
      <span className="field-label">Dias da semana</span>
      <div className="choice-group" role="group" aria-label="Dias da semana">
        {DIAS_SEMANA_CURTO.map(([n, label]) => <button key={n} type="button" className={diasSemana.includes(n) ? "selected" : ""} onClick={() => alternarDiaSemana(n)}>{label}</button>)}
      </div>
    </div>}
    {periodicidade === "anual" && <div className="field-grid">
      <label>Mês<select value={mesReferencia} onChange={(e) => setMesReferencia(Number(e.target.value))}>{MESES_PT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
      <label>Dia do mês<input type="number" min={1} max={31} required value={diaReferencia} onChange={(e) => setDiaReferencia(Number(e.target.value))} /></label>
    </div>}
    {periodicidade === "mensal" && <label>Dia do mês<input type="number" min={1} max={31} required value={diaReferencia} onChange={(e) => setDiaReferencia(Number(e.target.value))} /></label>}
    <div className="field-block">
      <span className="field-label">Repetição</span>
      <div className="segmented" role="group" aria-label="Repetição">
        <button type="button" className={repeticoesQuantidade === null ? "selected" : ""} onClick={() => { setRepeticoesQuantidade(null); setRepeticoesUnidade(null); }}>Sem data final</button>
        <button type="button" className={repeticoesQuantidade !== null ? "selected" : ""} onClick={iniciarRepeticaoLimitada}>Repetir por um período</button>
      </div>
      <small className="field-hint">{repeticoesQuantidade === null ? "Gera tarefas indefinidamente." : "Para de gerar novas tarefas após o período informado."}</small>
      {repeticoesQuantidade !== null && <div className="field-grid">
        <label>Quantidade<input type="number" min={1} required value={repeticoesQuantidade} onChange={(e) => setRepeticoesQuantidade(Number(e.target.value))} /></label>
        <label>Unidade<select value={repeticoesUnidade ?? unidadesValidas(periodicidade)[0]} onChange={(e) => setRepeticoesUnidade(e.target.value as UnidadeRepeticao)}>{unidadesValidas(periodicidade).map((u) => <option key={u} value={u}>{UNIDADE_TEXTO[u]}</option>)}</select></label>
      </div>}
    </div>
    {natureza === "Externa" && companies.length > 0 && <label>Empresa<select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>{companies.map((c) => <option key={c.id} value={c.id}>{c.fantasia}</option>)}</select></label>}
    <label>Responsável<select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}><option value="">Sem responsável</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
    {semEmpresa && <p className="inline-error">Nenhuma empresa cadastrada — cadastre uma no Onboarding para vincular modelos externos.</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p></div>}
    <button className="primary" disabled={saving || semEmpresa}>{saving ? "Salvando…" : "Salvar alterações"}</button>
  </form></AccessibleModal>;
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

  // Interações com uma tarefa individual. O popover de detalhes é centralizado
  // na tela (ver render abaixo), então basta guardar a tarefa — não precisa
  // mais de coordenadas de clique.
  const [detalhe, setDetalhe] = useState<Tarefa | null>(null);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const dismissTaskMenu = () => { setMenuTaskId(null); setMenuAnchor(null); };
  const menuAcessivel = useAccessibleMenu(Boolean(menuTaskId), dismissTaskMenu);
  useDismissOnViewportChange(Boolean(menuTaskId), menuAcessivel.fechar);
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
  const [modeloDraft, setModeloDraft] = useState({
    titulo: "", tipo: "Fiscal", periodicidade: "mensal" as Periodicidade, diaReferencia: 10,
    diasSemana: [] as number[], mesReferencia: new Date().getMonth() + 1,
    repeticoesQuantidade: null as number | null, repeticoesUnidade: null as UnidadeRepeticao | null,
    natureza: "Externa" as "Interna" | "Externa", empresaId: companies[0]?.id ?? "", responsavelId: perfis[0]?.id ?? "",
  });
  const [editingModelo, setEditingModelo] = useState<ModeloRecorrencia | null>(null);
  const [deletingModelo, setDeletingModelo] = useState<ModeloRecorrencia | null>(null);
  const [deleteModeloSaving, setDeleteModeloSaving] = useState(false);
  const [deleteModeloError, setDeleteModeloError] = useState("");

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
      if (deletingTask.modeloId) {
        // Tarefa gerada por um modelo de recorrência: excluir de verdade
        // (DELETE) não gruda — `gerarTarefasDoMes` recriaria essa mesma
        // ocorrência (modelo_id, vencimento) na próxima vez que o mês fosse
        // carregado. "Cancelada" marca essa ocorrência como uma exceção,
        // sem afetar as próximas datas do modelo.
        await editarTarefa(deletingTask.id, { status: "Cancelada" });
      } else {
        await excluirTarefa(deletingTask.id);
      }
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

  const toggleTaskMenu = (id: string, target: HTMLElement) => {
    if (menuTaskId === id) { menuAcessivel.fechar(); return; }
    menuAcessivel.rememberOpener(target);
    const rect = target.getBoundingClientRect();
    setMenuAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setMenuTaskId(id);
  };
  const closeTaskMenu = menuAcessivel.fechar;

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
  const escolherPeriodo = (mes: number, ano: number) => { setDetalhe(null); closeTaskMenu(); setViewMes(mes); setViewAno(ano); };
  const anosDisponiveis = Array.from({ length: 11 }, (_, index) => viewAno - 5 + index);

  const refetchModelos = async (falhaParcial: string) => {
    try {
      const atualizados = await listarModelosRecorrencia();
      setModelos(atualizados);
    } catch {
      setModeloError(falhaParcial);
    }
  };

  const escolherExternaNoModeloDraft = () => {
    setModeloDraft((d) => ({ ...d, natureza: "Externa", empresaId: d.empresaId || companies[0]?.id || "" }));
  };

  const alterarPeriodicidadeDraft = (p: Periodicidade) => {
    setModeloDraft((d) => ({
      ...d,
      periodicidade: p,
      diaReferencia: 1,
      diasSemana: [],
      repeticoesUnidade: d.repeticoesQuantidade !== null ? unidadesValidas(p)[0] : d.repeticoesUnidade,
    }));
  };

  const alternarDiaSemanaDraft = (dia: number) => {
    setModeloDraft((d) => ({
      ...d,
      diasSemana: d.diasSemana.includes(dia) ? d.diasSemana.filter((n) => n !== dia) : [...d.diasSemana, dia].sort((a, b) => a - b),
    }));
  };

  const iniciarRepeticaoLimitadaDraft = () => {
    setModeloDraft((d) => ({ ...d, repeticoesQuantidade: 1, repeticoesUnidade: unidadesValidas(d.periodicidade)[0] }));
  };

  const criarModelo = async (e: FormEvent) => {
    e.preventDefault();
    if (modeloDraft.natureza === "Externa" && !modeloDraft.empresaId) {
      setModeloError("Selecione a empresa cliente do modelo externo.");
      return;
    }
    if (modeloDraft.periodicidade === "semanal" && modeloDraft.diasSemana.length === 0) {
      setModeloError("Selecione pelo menos um dia da semana.");
      return;
    }
    setModeloSaving(true); setModeloError("");
    try {
      await criarModeloRecorrencia({
        titulo: modeloDraft.titulo,
        tipo: modeloDraft.tipo,
        periodicidade: modeloDraft.periodicidade,
        diaReferencia: modeloDraft.diaReferencia,
        diasSemana: modeloDraft.periodicidade === "semanal" ? modeloDraft.diasSemana : undefined,
        mesReferencia: modeloDraft.periodicidade === "anual" ? modeloDraft.mesReferencia : undefined,
        repeticoesQuantidade: modeloDraft.repeticoesQuantidade,
        repeticoesUnidade: modeloDraft.repeticoesUnidade,
        empresaId: modeloDraft.natureza === "Externa" ? modeloDraft.empresaId : null,
        responsavelId: modeloDraft.responsavelId || null,
      });
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível criar o modelo de recorrência";
      setModeloError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setModeloSaving(false);
      return;
    }
    // Um modelo novo (se ativo) pode ter uma ocorrência já no mês em
    // exibição — sem recarregar as tarefas do mês, ela só apareceria na
    // próxima troca de mês/reload, não imediatamente.
    await refetchModelos("Modelo criado, mas não foi possível atualizar a lista. Atualize a página.");
    await recarregarMes("Modelo criado, mas não foi possível atualizar o calendário. Atualize a página.");
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
    // `refetchModelos` e a limpeza do loading precisam terminar juntos, na
    // mesma atualização: `refetchModelos` é quem vira `m.ativo` pra false (o
    // que troca o botão de "Desativar" para "Reativar"). Se o loading
    // limpasse antes, a linha piscaria de volta pro texto original por um
    // instante, antes de virar pro botão certo — uma transição em duas
    // etapas, confusa. `recarregarMes` não afeta esta linha (só o
    // calendário), então roda depois, sem impacto visual aqui.
    await refetchModelos("Modelo desativado, mas não foi possível atualizar a lista. Atualize a página.");
    setAtualizandoModeloId(null);
    await recarregarMes("Modelo desativado, mas não foi possível atualizar o calendário. Atualize a página.");
  };

  const reativarModelo = async (id: string) => {
    setAtualizandoModeloId(id); setModeloError("");
    try {
      await atualizarModeloRecorrencia(id, { ativo: true });
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível reativar o modelo";
      setModeloError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setAtualizandoModeloId(null);
      return;
    }
    await refetchModelos("Modelo reativado, mas não foi possível atualizar a lista. Atualize a página.");
    setAtualizandoModeloId(null);
    await recarregarMes("Modelo reativado, mas não foi possível atualizar o calendário. Atualize a página.");
  };

  const handleModeloEditado = async (atualizado: ModeloRecorrencia) => {
    setModelos(modelos.map((m) => (m.id === atualizado.id ? atualizado : m)));
    setEditingModelo(null);
    await recarregarMes("Modelo atualizado, mas não foi possível atualizar o calendário. Atualize a página.");
  };

  const confirmDeleteModelo = async () => {
    if (!deletingModelo) return;
    setDeleteModeloSaving(true); setDeleteModeloError("");
    try {
      await excluirModeloRecorrencia(deletingModelo.id);
    } catch (error) {
      const bruta = error instanceof Error ? error.message : "Não foi possível excluir o modelo de recorrência";
      setDeleteModeloError(`${semPontoFinal(bruta)}. Tente novamente.`);
      setDeleteModeloSaving(false);
      return;
    }
    setDeletingModelo(null);
    await refetchModelos("Modelo excluído, mas não foi possível atualizar a lista. Atualize a página.");
    await recarregarMes("Modelo excluído, mas não foi possível atualizar o calendário. Atualize a página.");
    setDeleteModeloSaving(false);
  };

  const semEmpresaExterna = draft.natureza === "Externa" && companies.length === 0;
  const semEmpresaExternaModelo = modeloDraft.natureza === "Externa" && companies.length === 0;

  const abrirNovoModelo = () => {
    setModeloError("");
    setModeloDraft({
      titulo: "", tipo: "Fiscal", periodicidade: "mensal", diaReferencia: 10,
      diasSemana: [], mesReferencia: new Date().getMonth() + 1,
      repeticoesQuantidade: null, repeticoesUnidade: null,
      natureza: "Externa", empresaId: companies[0]?.id ?? "", responsavelId: perfis[0]?.id ?? "",
    });
    setModeloOpen(true);
  };

  return <>
    <section className="section-head"><div><h2>Calendário contábil</h2><p>{mesLabel} · obrigações e rotinas da carteira.</p></div><button className="primary" onClick={abrirNovaTarefa}>+ Nova tarefa</button></section>
    {taskError && <div className="notice error" role="alert"><p>{taskError}</p></div>}

    <section className="calendar-nav">
      <div className="calendar-nav-group">
        <button type="button" className="nav-arrow" aria-label="Ano anterior" title="Ano anterior" onClick={() => irAno(-1)}>«</button>
        <button type="button" className="nav-arrow" aria-label="Mês anterior" title="Mês anterior" onClick={() => irMes(-1)}>‹</button>
      </div>
      <div className="calendar-period-picker"><select aria-label="Mês exibido" value={viewMes} onChange={(event) => escolherPeriodo(Number(event.target.value), viewAno)}>{MESES_PT.map((mes, index) => <option key={mes} value={index}>{mes}</option>)}</select><select aria-label="Ano exibido" value={viewAno} onChange={(event) => escolherPeriodo(viewMes, Number(event.target.value))}>{anosDisponiveis.map((ano) => <option key={ano} value={ano}>{ano}</option>)}</select></div>
      <div className="calendar-nav-group">
        <button type="button" className="nav-arrow" aria-label="Próximo mês" title="Próximo mês" onClick={() => irMes(1)}>›</button>
        <button type="button" className="nav-arrow" aria-label="Próximo ano" title="Próximo ano" onClick={() => irAno(1)}>»</button>
        {!isMesAtual && <button type="button" className="nav-today" onClick={irHoje}>Hoje</button>}
      </div>
    </section>

    <section className="calendar-toolbar"><div className="tabs"><button className={mode === "month" ? "selected" : ""} onClick={() => setMode("month")}>Calendário</button><button className={mode === "list" ? "selected" : ""} onClick={() => setMode("list")}>Lista</button></div><label>Responsável <select value={responsible} onChange={(e) => setResponsible(e.target.value)}>{people.map((p) => <option key={p}>{p}</option>)}</select></label></section>

    {monthLoading ? <section className="panel" role="status" aria-live="polite"><div className="empty"><span aria-hidden="true">◷</span><strong>Carregando {mesLabel.toLowerCase()}…</strong><p>Buscando as tarefas deste mês.</p></div></section> : mode === "month" ? <section className="calendar"><div className="weekdays">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <span key={d}>{d}</span>)}</div><div className="day-grid">{Array.from({ length: primeiroDiaSemana }, (_, i) => <div className="day muted" key={`blank-${i}`} />)}{monthDays.map((day) => { const date = `${mesISO}-${pad2(day)}`; const items = shown.filter((t) => t.vencimento === date); const holiday = items.find((t) => t.coincideComFeriado)?.coincideComFeriado ?? null; const ehHoje = isMesAtual && date === dataHojeISO; return <div className={`day ${holiday ? "holiday" : ""} ${ehHoje ? "is-today" : ""}`} key={day}><span>{day}</span>{holiday && <small title={holiday.nome}>Feriado</small>}{items.map((t) => <button className={`calendar-task ${t.status === "Atrasada" ? "late" : ""} ${t.status === "Concluída" ? "done" : ""}`} key={t.id} title="Ver detalhes" onClick={() => setDetalhe(t)}>{t.titulo}</button>)}</div>; })}</div></section> : <section className="panel list-tasks">{shown.map((t) => <div className="task-line" key={t.id}><time>{formatDate(t.vencimento)}</time><div><strong>{t.titulo}</strong><small>{nomeEmpresaTarefa(t)} · {t.responsavel || "Sem responsável"}</small></div>{t.coincideComFeriado && <Badge tone="warning">Feriado: {t.coincideComFeriado.nome}</Badge>}<Badge tone={t.status === "Atrasada" ? "danger" : t.status === "Concluída" ? "success" : "blue"}>{t.status}</Badge><div className="row-menu"><button className="icon-button" aria-label={`Mais opções — ${t.titulo}`} onClick={(e) => toggleTaskMenu(t.id, e.currentTarget)}>⋯</button>{menuTaskId === t.id && menuAnchor && <>
      <button type="button" className="menu-backdrop" aria-label="Fechar menu" onClick={closeTaskMenu} />
      <div ref={menuAcessivel.menuRef} className="dropdown-menu" role="menu" onKeyDown={menuAcessivel.aoTeclar} style={{ top: menuAnchor.top, right: menuAnchor.right }}>{t.status !== "Concluída" && <button type="button" role="menuitem" disabled={concluindoId === t.id} onClick={() => { dismissTaskMenu(); concluir(t.id); }}>{concluindoId === t.id ? "Concluindo…" : "Concluir"}</button>}<button type="button" role="menuitem" onClick={() => { dismissTaskMenu(); setEditingTask(t); }}>Editar</button><button type="button" role="menuitem" className="danger" onClick={() => { dismissTaskMenu(); setDeletingTask(t); setDeleteError(""); }}>Excluir</button></div>
    </>}</div></div>)}{shown.length === 0 && <Empty title="Nenhuma tarefa neste mês" text="Cadastre uma tarefa avulsa ou um modelo de recorrência." />}</section>}

    {detalhe && <AccessibleModal label={`Detalhes — ${detalhe.titulo}`} onClose={() => setDetalhe(null)}>
      <div className="task-popover">
        <div className="task-popover-head"><strong>{detalhe.titulo}</strong><button type="button" className="close" onClick={() => setDetalhe(null)} aria-label="Fechar">×</button></div>
        <dl className="task-popover-body">
          <div><dt>Natureza</dt><dd>{naturezaTarefa(detalhe)}</dd></div>
          <div><dt>{naturezaTarefa(detalhe) === "Interna" ? "Equipe" : "Empresa"}</dt><dd>{nomeEmpresaTarefa(detalhe)}</dd></div>
          <div><dt>Responsável</dt><dd>{detalhe.responsavel || "Sem responsável"}</dd></div>
          <div><dt>Vencimento</dt><dd>{formatDataLonga(detalhe.vencimento)}</dd></div>
          <div><dt>Situação</dt><dd><Badge tone={detalhe.status === "Atrasada" ? "danger" : detalhe.status === "Concluída" ? "success" : "blue"}>{detalhe.status}</Badge></dd></div>
        </dl>
        {detalhe.coincideComFeriado && <p className="task-popover-holiday">⚑ Coincide com feriado: {detalhe.coincideComFeriado.nome}</p>}
        <div className="task-popover-actions">
          {detalhe.status !== "Concluída" && <button type="button" disabled={concluindoId === detalhe.id} onClick={() => concluir(detalhe.id)}>{concluindoId === detalhe.id ? "Concluindo…" : "Concluir"}</button>}
          <button type="button" onClick={() => { const t = detalhe; setDetalhe(null); setEditingTask(t); }}>Editar</button>
          <button type="button" className="danger" onClick={() => { const t = detalhe; setDetalhe(null); setDeletingTask(t); setDeleteError(""); }}>Excluir</button>
        </div>
      </div>
    </AccessibleModal>}

    <section className="section-head"><div><h2>Modelos recorrentes</h2><p>Tarefas geradas automaticamente todo mês, conforme a periodicidade.</p></div><button className="primary" onClick={abrirNovoModelo}>+ Novo modelo</button></section>
    {modeloError && <div className="notice error" role="alert"><p>{modeloError}</p></div>}
    <section className="panel table-wrap">
      <table>
        <thead><tr><th scope="col">Título</th><th scope="col">Tipo</th><th scope="col">Periodicidade</th><th scope="col">Empresa</th><th scope="col">Responsável</th><th scope="col">Situação</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>
          {modelos.map((m) => <tr key={m.id}>
            <td><strong>{m.titulo}</strong></td>
            <td>{m.tipo}</td>
            <td>{descreverRecorrencia(m)}</td>
            <td>{m.empresa || "Reunião interna"}</td>
            <td>{m.responsavel || "—"}</td>
            <td><Badge tone={m.ativo ? "success" : "neutral"}>{m.ativo ? "Ativo" : "Inativo"}</Badge></td>
            <td className="actions">
              <button className="icon-button" onClick={() => setEditingModelo(m)}>Editar</button>
              {m.ativo
                ? <button className="icon-button" disabled={atualizandoModeloId === m.id} onClick={() => desativarModelo(m.id)}>{atualizandoModeloId === m.id ? "Desativando…" : "Desativar"}</button>
                : <button className="icon-button" disabled={atualizandoModeloId === m.id} onClick={() => reativarModelo(m.id)}>{atualizandoModeloId === m.id ? "Reativando…" : "Reativar"}</button>}
              <button className="icon-button" onClick={() => { setDeletingModelo(m); setDeleteModeloError(""); }}>Excluir</button>
            </td>
          </tr>)}
        </tbody>
      </table>
      {modelosCarregados && modelos.length === 0 && <Empty title="Nenhum modelo de recorrência" text="Cadastre um modelo para gerar tarefas automaticamente." />}
    </section>

    {open && <AccessibleModal label="Nova tarefa" onClose={() => setOpen(false)}><form className="modal" onSubmit={add}>
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
      <label>Responsável<select value={draft.responsavelId} onChange={(e) => setDraft({ ...draft, responsavelId: e.target.value })}><option value="">Sem responsável</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
      <label>Vencimento<input type="date" value={draft.vencimento} onChange={(e) => setDraft({ ...draft, vencimento: e.target.value })} /></label>
      {semEmpresaExterna && <p className="inline-error">Nenhuma empresa cadastrada — cadastre uma no Onboarding para criar tarefas externas.</p>}
      <button className="primary" disabled={saving || semEmpresaExterna}>{saving ? "Salvando…" : "Salvar tarefa"}</button>
    </form></AccessibleModal>}

    {modeloOpen && <AccessibleModal label="Novo modelo de recorrência" onClose={() => setModeloOpen(false)}><form className="modal" onSubmit={criarModelo}>
      <button type="button" className="close" onClick={() => setModeloOpen(false)} aria-label="Fechar">×</button>
      <h2>Novo modelo de recorrência</h2>
      <p>Gera tarefas automaticamente a cada mês, ao abrir o calendário.</p>
      <label>Título<input required value={modeloDraft.titulo} onChange={(e) => setModeloDraft({ ...modeloDraft, titulo: e.target.value })} placeholder="Ex.: Fechamento da folha" /></label>
      <div className="field-block">
        <span className="field-label">Natureza do modelo</span>
        <div className="segmented" role="group" aria-label="Natureza do modelo">
          <button type="button" className={modeloDraft.natureza === "Interna" ? "selected" : ""} onClick={() => setModeloDraft({ ...modeloDraft, natureza: "Interna" })}>Interna</button>
          <button type="button" className={modeloDraft.natureza === "Externa" ? "selected" : ""} onClick={escolherExternaNoModeloDraft}>Externa</button>
        </div>
        <small className="field-hint">{modeloDraft.natureza === "Interna" ? "Rotina ou reunião recorrente da própria equipe." : "Obrigação recorrente de uma empresa cliente."}</small>
      </div>
      <label>Tipo<input required value={modeloDraft.tipo} onChange={(e) => setModeloDraft({ ...modeloDraft, tipo: e.target.value })} placeholder="Ex.: Fiscal" /></label>
      <label>Periodicidade<select value={modeloDraft.periodicidade} onChange={(e) => alterarPeriodicidadeDraft(e.target.value as Periodicidade)}><option value="diario">Diário</option><option value="semanal">Semanal</option><option value="mensal">Mensal</option><option value="anual">Anual</option></select></label>
      {modeloDraft.periodicidade === "semanal" && <div className="field-block">
        <span className="field-label">Dias da semana</span>
        <div className="choice-group" role="group" aria-label="Dias da semana">
          {DIAS_SEMANA_CURTO.map(([n, label]) => <button key={n} type="button" className={modeloDraft.diasSemana.includes(n) ? "selected" : ""} onClick={() => alternarDiaSemanaDraft(n)}>{label}</button>)}
        </div>
      </div>}
      {modeloDraft.periodicidade === "anual" && <div className="field-grid">
        <label>Mês<select value={modeloDraft.mesReferencia} onChange={(e) => setModeloDraft({ ...modeloDraft, mesReferencia: Number(e.target.value) })}>{MESES_PT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label>Dia do mês<input type="number" min={1} max={31} required value={modeloDraft.diaReferencia} onChange={(e) => setModeloDraft({ ...modeloDraft, diaReferencia: Number(e.target.value) })} /></label>
      </div>}
      {modeloDraft.periodicidade === "mensal" && <label>Dia do mês<input type="number" min={1} max={31} required value={modeloDraft.diaReferencia} onChange={(e) => setModeloDraft({ ...modeloDraft, diaReferencia: Number(e.target.value) })} /></label>}
      <div className="field-block">
        <span className="field-label">Repetição</span>
        <div className="segmented" role="group" aria-label="Repetição">
          <button type="button" className={modeloDraft.repeticoesQuantidade === null ? "selected" : ""} onClick={() => setModeloDraft({ ...modeloDraft, repeticoesQuantidade: null, repeticoesUnidade: null })}>Sem data final</button>
          <button type="button" className={modeloDraft.repeticoesQuantidade !== null ? "selected" : ""} onClick={iniciarRepeticaoLimitadaDraft}>Repetir por um período</button>
        </div>
        <small className="field-hint">{modeloDraft.repeticoesQuantidade === null ? "Gera tarefas indefinidamente, todo mês." : "Para de gerar novas tarefas após o período informado."}</small>
        {modeloDraft.repeticoesQuantidade !== null && <div className="field-grid">
          <label>Quantidade<input type="number" min={1} required value={modeloDraft.repeticoesQuantidade} onChange={(e) => setModeloDraft({ ...modeloDraft, repeticoesQuantidade: Number(e.target.value) })} /></label>
          <label>Unidade<select value={modeloDraft.repeticoesUnidade ?? unidadesValidas(modeloDraft.periodicidade)[0]} onChange={(e) => setModeloDraft({ ...modeloDraft, repeticoesUnidade: e.target.value as UnidadeRepeticao })}>{unidadesValidas(modeloDraft.periodicidade).map((u) => <option key={u} value={u}>{UNIDADE_TEXTO[u]}</option>)}</select></label>
        </div>}
      </div>
      {modeloDraft.natureza === "Externa" && companies.length > 0 && <label>Empresa<select value={modeloDraft.empresaId} onChange={(e) => setModeloDraft({ ...modeloDraft, empresaId: e.target.value })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.fantasia}</option>)}</select></label>}
      <label>Responsável<select value={modeloDraft.responsavelId} onChange={(e) => setModeloDraft({ ...modeloDraft, responsavelId: e.target.value })}><option value="">Sem responsável</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
      {semEmpresaExternaModelo && <p className="inline-error">Nenhuma empresa cadastrada — cadastre uma no Onboarding para criar modelos externos.</p>}
      <button className="primary" disabled={modeloSaving || semEmpresaExternaModelo}>{modeloSaving ? "Salvando…" : "Salvar modelo"}</button>
    </form></AccessibleModal>}

    {editingTask && <TarefaEditModal tarefa={editingTask} companies={companies} perfis={perfis} onClose={() => setEditingTask(null)} onSaved={handleTarefaEditada} />}

    {deletingTask && <AccessibleModal label="Confirmar exclusão" onClose={() => setDeletingTask(null)}><div className="modal"><button type="button" className="close" onClick={() => setDeletingTask(null)} aria-label="Fechar">×</button><h2>Excluir tarefa</h2><p>Tem certeza que deseja excluir <strong>{deletingTask.titulo}</strong>? {deletingTask.modeloId ? "Essa ocorrência será removida do calendário e não voltará a ser gerada — as próximas datas do modelo de recorrência continuam normalmente." : "Essa ação não pode ser desfeita."}</p>{deleteError && <div className="notice error" role="alert"><p>{deleteError}</p></div>}<button type="button" className="primary danger" onClick={confirmDeleteTask} disabled={deleteSaving}>{deleteSaving ? "Excluindo…" : "Excluir definitivamente"}</button></div></AccessibleModal>}

    {editingModelo && <ModeloEditModal modelo={editingModelo} companies={companies} perfis={perfis} onClose={() => setEditingModelo(null)} onSaved={handleModeloEditado} />}

    {deletingModelo && <AccessibleModal label="Confirmar exclusão" onClose={() => setDeletingModelo(null)}><div className="modal"><button type="button" className="close" onClick={() => setDeletingModelo(null)} aria-label="Fechar">×</button><h2>Excluir modelo de recorrência</h2><p>Tem certeza que deseja excluir <strong>{deletingModelo.titulo}</strong>? Todas as tarefas já geradas por este modelo somem do calendário junto. Essa ação não pode ser desfeita.</p>{deleteModeloError && <div className="notice error" role="alert"><p>{deleteModeloError}</p></div>}<button type="button" className="primary danger" onClick={confirmDeleteModelo} disabled={deleteModeloSaving}>{deleteModeloSaving ? "Excluindo…" : "Excluir definitivamente"}</button></div></AccessibleModal>}
  </>;
}
