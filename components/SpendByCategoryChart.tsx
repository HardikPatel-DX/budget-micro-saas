'use client';
import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend
} from 'recharts';

type DataPoint = { category: string; total: number };

const COLORS = [
  '#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#06b6d4'
];

export default function SpendByCategoryChart() {
  const [data, setData] = useState<DataPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch('/api/analytics/spend-by-category');
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json?.error || 'failed to load');
        }
        if (mounted) {
          const d: DataPoint[] = (json.data || []).map((r: any) => ({
            category: String(r.category || 'Uncategorized'),
            total: Math.abs(Number(r.total || 0))
          }));
          setData(d);
        }
      } catch (err: any) {
        console.error('chart load error', err);
        if (mounted) setError(err.message || 'error');
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  if (error) return <div className="p-4 text-sm text-red-600">Chart error: {error}</div>;
  if (!data) return <div className="p-4">Loading chart…</div>;
  if (data.length === 0) return <div className="p-4">No spend data in last 30 days.</div>;

  return (
    <div style={{ width: '100%', height: 320 }} className="bg-white rounded shadow p-4">
      <h3 className="text-md font-medium mb-3">Spend by category (30d)</h3>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="total"
            nameKey="category"
            cx="50%"
            cy="50%"
            outerRadius={100}
            // ensure entry.total is a number before calling toFixed
            label={(entry: any) => `${String(entry.category)} (${Number(entry.total).toFixed(2)})`}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value: any) => (typeof value === 'number' ? value.toFixed(2) : String(value))} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
