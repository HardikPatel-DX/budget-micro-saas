'use client';
import React from 'react';

export default function SummaryCards({ total, avg, count }:
  { total: number; avg: number; count: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="p-4 bg-white shadow rounded">
        <div className="text-sm text-gray-500">Recent total</div>
        <div className="text-2xl font-bold">${total.toFixed(2)}</div>
      </div>
      <div className="p-4 bg-white shadow rounded">
        <div className="text-sm text-gray-500">Average txn</div>
        <div className="text-2xl font-bold">${avg.toFixed(2)}</div>
      </div>
      <div className="p-4 bg-white shadow rounded">
        <div className="text-sm text-gray-500">Transactions</div>
        <div className="text-2xl font-bold">{count}</div>
      </div>
    </div>
  );
}
