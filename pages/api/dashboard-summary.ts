// pages/api/dashboard-summary.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Minimal placeholder response so the endpoint compiles and can be tested.
    // We'll replace this with the full Supabase-backed implementation next step.
    return res.status(200).json({
      ok: true,
      tiles: { currentBalance: null, weeklyAvgSpend: 0, monthlyNetFlow: 0 },
      charts: { weekly: [], categories: [], payees: [] },
      recurring: [],
      suggestions: {
        conservative: { pct: 0.05, weekly_amount: 0 },
        moderate: { pct: 0.10, weekly_amount: 0 },
        aggressive: { pct: 0.15, weekly_amount: 0 },
        projection_12_weeks: { conservative: 0, moderate: 0, aggressive: 0 }
      },
      topUnmapped: [],
      generatedAt: new Date().toISOString()
    })
  } catch (err) {
    console.error('dashboard-summary placeholder error', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
