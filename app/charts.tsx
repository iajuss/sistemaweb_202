"use client";

// Componentes de gráfico baseados em recharts, isolados aqui e carregados sob
// demanda (React.lazy) por home-client.tsx. Motivo: recharts é uma dependência
// grande; importá-la no topo do home-client fazia o grafo de módulos da rota
// "/" carregar recharts já no primeiro render (que abre na "Visão geral", sem
// gráfico nenhum), deixando o primeiro acesso lento — os gráficos só aparecem
// na aba "Análise". Mantê-la num chunk separado tira recharts do caminho
// crítico do primeiro paint e do bundle inicial.
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const cores = ["#2d6478", "#5d89a5", "#92b0bf", "#c8d9db", "#d9af72"];

function axisLabelLines(value: string) {
  return value.split(" ").reduce<string[]>((lines, word) => {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > 13) return [...lines, word];
    return [...lines.slice(0, -1), `${current} ${word}`];
  }, []);
}

function BarAxisTick({ y = 0, payload }: { y?: number; payload?: { value: string } }) {
  const lines = axisLabelLines(payload?.value ?? "");
  return <text x={4} y={y - ((lines.length - 1) * 6)} fill="#617179" fontSize={11} textAnchor="start">{lines.map((line, index) => <tspan key={line} x={4} dy={index === 0 ? 4 : 12}>{line}</tspan>)}</text>;
}

export function BarVisual({ data }: { data: { name: string; value: number }[] }) {
  const labelWidth = Math.max(36, ...data.map(({ name }) => {
    const largestLine = Math.max(...axisLabelLines(name).map((line) => line.length * 6 + 16));
    return Math.min(92, largestLine);
  }));
  return <ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ left: 6, right: 12 }}><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={labelWidth} tick={<BarAxisTick />} axisLine={false} tickLine={false} /><Tooltip cursor={false} /><Bar dataKey="value" fill="#2d6478" radius={[0, 5, 5, 0]} barSize={14} /></BarChart></ResponsiveContainer>;
}

export function PieVisual({ data }: { data: { name: string; value: number }[] }) {
  return <div className="pie-layout"><ResponsiveContainer width="55%" height="100%"><PieChart><Pie data={data} dataKey="value" innerRadius={42} outerRadius={72} paddingAngle={3}>{data.map((_, i) => <Cell key={i} fill={cores[i % cores.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="legend">{data.map((d, i) => <p key={d.name}><i style={{ background: cores[i % cores.length] }} />{d.name}<strong>{d.value}</strong></p>)}</div></div>;
}
