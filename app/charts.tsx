"use client";

// Componentes de gráfico baseados em recharts, isolados aqui e carregados sob
// demanda (React.lazy) por home-client.tsx. Motivo: recharts é uma dependência
// grande; importá-la no topo do home-client fazia o grafo de módulos da rota
// "/" carregar recharts já no primeiro render (que abre na "Visão geral", sem
// gráfico nenhum), deixando o primeiro acesso lento — os gráficos só aparecem
// na aba "Análise". Mantê-la num chunk separado tira recharts do caminho
// crítico do primeiro paint e do bundle inicial.
import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Uma cor por categoria possível — "Situação cadastral" tem 6 valores
// ("Não informada" + as 5 situações), e o `i % cores.length` das fatias
// reciclaria a primeira cor (azul escuro) ao lado da segunda (azul médio) se a
// lista tivesse só 5. Ao acrescentar categorias, acrescente cores aqui também.
const coresClaras = ["#2d6478", "#5d89a5", "#92b0bf", "#c8d9db", "#d9af72", "#8c5a4a"];
// O tema escuro preserva a identidade azul da aplicação. A lista abaixo é
// compartilhada pelo gráfico e pela legenda, evitando qualquer divergência.
const coresEscuras = ["#2d6478", "#5d89a5", "#92b0bf", "#c8d9db", "#d9af72", "#8c5a4a"];
// Okabe-Ito sem dois tons de azul: azul, laranja, verde, magenta, amarelo e vermelhão.
const coresDaltonismo = ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#f0e442", "#d55e00"];

function coresDoGrafico() {
  if (typeof document === "undefined") return coresClaras;
  if (document.documentElement.dataset.vision === "colorblind") return coresDaltonismo;
  return document.documentElement.dataset.theme === "dark" ? coresEscuras : coresClaras;
}

function useCoresDoGrafico() {
  const [cores, setCores] = useState(coresDoGrafico);
  useEffect(() => {
    const root = document.documentElement;
    const atualizar = () => setCores(coresDoGrafico());
    const observador = new MutationObserver(atualizar);
    observador.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-vision"] });
    return () => observador.disconnect();
  }, []);
  return cores;
}

function axisLabelLines(value: string) {
  return value.split(" ").reduce<string[]>((lines, word) => {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > 13) return [...lines, word];
    return [...lines.slice(0, -1), `${current} ${word}`];
  }, []);
}

function BarAxisTick({ y = 0, payload, onSelect }: { y?: number; payload?: { value: string }; onSelect?: (name: string) => void }) {
  const lines = axisLabelLines(payload?.value ?? "");
  const selecionar = () => onSelect?.(payload?.value ?? "");
  return <text x={4} y={y - ((lines.length - 1) * 6)} fill="currentColor" fontSize={11} textAnchor="start" tabIndex={onSelect ? 0 : undefined} role={onSelect ? "button" : undefined} aria-label={onSelect ? `Ver empresas: ${payload?.value}` : undefined} onClick={onSelect ? selecionar : undefined} onKeyDown={onSelect ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selecionar(); } } : undefined} className={onSelect ? "bar-axis-tick-clickable" : undefined}>{lines.map((line, index) => <tspan key={line} x={4} dy={index === 0 ? 4 : 12}>{line}</tspan>)}</text>;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return <div className="chart-tooltip">{label ?? name}<strong>{value}</strong></div>;
}

export function BarVisual({ data, onSelect, scrollable = false }: { data: { name: string; value: number }[]; onSelect?: (name: string) => void; scrollable?: boolean }) {
  const cores = useCoresDoGrafico();
  const labelWidth = Math.max(36, ...data.map(({ name }) => {
    const largestLine = Math.max(...axisLabelLines(name).map((line) => line.length * 6 + 16));
    return Math.min(92, largestLine);
  }));
  const chartHeight = Math.max(190, data.length * 30);
  const chart = <ResponsiveContainer width="100%" height={scrollable ? chartHeight : "100%"}><BarChart data={data} layout="vertical" margin={{ left: 6, right: 12 }} tabIndex={-1}><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={labelWidth} tick={<BarAxisTick onSelect={onSelect} />} axisLine={false} tickLine={false} /><Tooltip cursor={false} content={<ChartTooltip />} allowEscapeViewBox={{ x: false, y: false }} /><Bar dataKey="value" fill={cores[0]} activeBar={onSelect ? { fill: cores[0] } : undefined} radius={[0, 5, 5, 0]} barSize={14} onClick={onSelect ? (entry) => { const nome = entry.payload?.name; if (nome) onSelect(nome); } : undefined} style={onSelect ? { cursor: "pointer" } : undefined} /></BarChart></ResponsiveContainer>;
  return scrollable ? <div className="bar-chart-scroll"><div style={{ height: chartHeight }}>{chart}</div></div> : chart;
}

export function PieVisual({ data, legend = true, onSelect }: { data: { name: string; value: number }[]; legend?: boolean; onSelect?: (name: string) => void }) {
  const cores = useCoresDoGrafico();
  return <div className="pie-layout"><ResponsiveContainer width={legend ? "55%" : "100%"} height="100%"><PieChart tabIndex={-1}><Pie data={data} dataKey="value" innerRadius={42} outerRadius={72} paddingAngle={3} onClick={onSelect ? (entry) => { if (entry.name != null) onSelect(String(entry.name)); } : undefined} style={onSelect ? { cursor: "pointer" } : undefined}>{data.map((_, i) => <Cell key={i} fill={cores[i % cores.length]} />)}</Pie><Tooltip content={<ChartTooltip />} allowEscapeViewBox={{ x: false, y: false }} /></PieChart></ResponsiveContainer>{legend && <div className="legend">{data.map((d, i) => onSelect ? <button type="button" key={d.name} className="legend-clickable" onClick={() => onSelect(d.name)}><i style={{ background: cores[i % cores.length] }} aria-hidden="true" />{d.name}<strong>{d.value}</strong></button> : <p key={d.name}><i style={{ background: cores[i % cores.length] }} />{d.name}<strong>{d.value}</strong></p>)}</div>}</div>;
}
