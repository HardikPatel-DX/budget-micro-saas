'use client';
import React from 'react';

export default function TransactionsTable({ loading, rows }:
  { loading: boolean; rows: Array<any> }) {
  if (loading) return <div>Loading...</div>;
  if (!rows || rows.length === 0) return <div>No transactions found.</div>;

  return (
    <div className="overflow-x-auto bg-white rounded shadow">
      <table className="w-full text-sm">
        <thead className="text-left bg-gray-50">
          <tr>
            <th className="p-2">Date</th>
            <th className="p-2">Description</th>
            <th className="p-2">Amount</th>
            <th className="p-2">Processed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id} className="border-t">
              <td className="p-2">{new Date(r.date || r.created_at).toLocaleDateString()}</td>
              <td className="p-2">{r.description}</td>
              <td className="p-2">{r.amount}</td>
              <td className="p-2">{r.processed ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
