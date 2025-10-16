'use client';
import React, { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import SummaryCards from '../../components/SummaryCards';
import TransactionsTable from '../../components/TransactionsTable';
import TryDemoButton from '../../components/TryDemoButton';

type Tx = {
  id: number;
  date: string;
  amount: string;
  description: string;
  processed?: boolean;
};

export default function DashboardPage() {
  const supabase = createClientComponentClient();
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('transactions')
          .select('id, date, amount, description, processed, created_at')
          .order('created_at', { ascending: false })
          .limit(20);
        if (error) throw error;
        if (!cancelled) setTxs(data as Tx[]);
      } catch (err) {
        console.error('load txs error', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [supabase]);

  const total = txs.reduce((s, t) => s + Number(t.amount || 0), 0);
  const avg = txs.length ? (total / txs.length) : 0;

  return (
    <main className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-3">
          <TryDemoButton />
        </div>
      </div>

      <SummaryCards
        total={total}
        avg={avg}
        count={txs.length}
      />

      <section className="mt-6">
        <h2 className="text-lg font-semibold mb-2">Recent transactions</h2>
        <TransactionsTable loading={loading} rows={txs} />
      </section>
    </main>
  );
}
