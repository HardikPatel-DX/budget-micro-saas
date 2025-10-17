// pages/api/dashboard-summary.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
dayjs.extend(isoWeek)

let cache: { ts: number; userId: string; payload: any } | null = null
const TTL_MS = 5 * 60 * 1000 // 5 minutes

function safeNum(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: 'Missing Supabase client env variables' })
    }

    const authHeader = req.headers.authorization || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' })

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })

    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'Invalid token' })
    }
    const userId = userData.user.id

    if (cache && cache.userId === userId && Date.now() - cache.ts < TTL_MS) {
      return res.status(200).json({ fromCache: true, ...cache.payload })
    }

    const sixMonthsAgo = dayjs().subtract(26, 'week').startOf('week').toISOString()
    const { data: txs, error: txErr } = await supabase
      .from('transactions')
      .select('id,date_parsed,amount_num,transaction_type,category,payee_clean,created_at,owner')
      .eq('owner', userId)
      .gte('date_parsed', sixMonthsAgo)
      .order('date_parsed', { ascending: false })
      .limit(10000)

    if (txErr) {
      console.error('txErr', txErr)
      return res.status(500).json({ error: 'Failed to fetch transactions' })
    }

    const validTxs = (txs || []).filter((t: any) => {
      const amount = safeNum(t.amount_num)
      const date = t.date_parsed || t.created_at
      return amount !== null && date
    })

    const weeksMap: Record<string, number> = {}
    const weekKeys: string[] = []
    for (let i = 25; i >= 0; i--) {
      const wkStart = dayjs().subtract(i, 'week').startOf('week')
      const key = wkStart.format('YYYY-[W]WW')
      weeksMap[key] = 0
      weekKeys.push(key)
    }

    validTxs.forEach((t: any) => {
      const amount = safeNum(t.amount_num)!
      const date = dayjs(t.date_parsed || t.created_at)
      const weekKey = date.startOf('week').format('YYYY-[W]WW')
      if (weekKey in weeksMap) weeksMap[weekKey] += amount
    })

    const weekly = weekKeys.map((wk) => ({ week: wk, amount: +weeksMap[wk].toFixed(2) }))

    const categoriesMap: Record<string, number> = {}
    validTxs.forEach((t: any) => {
      const cat = t.category || 'Uncategorized'
      const amount = safeNum(t.amount_num) || 0
      categoriesMap[cat] = (categoriesMap[cat] || 0) + amount
    })
    const categories = Object.entries(categoriesMap)
      .map(([category, amount]) => ({ category, amount: +amount.toFixed(2) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 20)

    const payeeMap: Record<string, number> = {}
    validTxs.forEach((t: any) => {
      const p = t.payee_clean || 'Unknown'
      const amount = safeNum(t.amount_num) || 0
      payeeMap[p] = (payeeMap[p] || 0) + amount
    })
    const payees = Object.entries(payeeMap)
      .map(([payee, amount]) => ({ payee, amount: +amount.toFixed(2) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 50)

    const totalSpendLast26 = weekly.reduce((s, w) => s + w.amount, 0)
    const weeksWithData = weekly.filter((w) => w.amount !== 0).length || 26
    const weeklyAvgSpend = +(totalSpendLast26 / weeksWithData).toFixed(2)
    const monthlyNetFlow = +((totalSpendLast26 / 26) * 4.345).toFixed(2)
    const currentBalance = null

    let recurring: any[] = []
    const { data: recData, error: recErr } = await supabase
      .from('recurring_summary')
      .select('*')
      .eq('owner', userId)
      .limit(50)

    if (recErr || !recData || recData.length === 0) {
      const fallbackMap: Record<string, { payee: string; avgAmount: number; count: number; lastSeen: string }> = {}
      const fallbackWindow = dayjs().subtract(6, 'month')
      const relevant = (await supabase
        .from('transactions')
        .select('id,date_parsed,amount_num,payee_clean,category,created_at,owner')
        .eq('owner', userId)
        .gte('date_parsed', fallbackWindow.toISOString())
        .limit(5000)).data || []

      relevant.forEach((t: any) => {
        const amount = safeNum(t.amount_num)
        if (amount === null) return
        const payee = (t.payee_clean || 'Unknown').slice(0, 120)
        const key = `${payee}::${Math.round(amount)}`
        if (!fallbackMap[key]) fallbackMap[key] = { payee, avgAmount: 0, count: 0, lastSeen: t.date_parsed || t.created_at }
        fallbackMap[key].avgAmount += amount
        fallbackMap[key].count += 1
        const last = t.date_parsed || t.created_at
        if (dayjs(last).isAfter(dayjs(fallbackMap[key].lastSeen))) fallbackMap[key].lastSeen = last
      })

      recurring = Object.values(fallbackMap)
        .filter((r) => r.count >= 2)
        .map((r) => ({ payee: r.payee, avgAmount: +(r.avgAmount / r.count).toFixed(2), occurrences: r.count, lastSeen: r.lastSeen }))
        .sort((a, b) => b.occurrences - a.occurrences)
        .slice(0, 20)
    } else {
      recurring = (recData || []).map((r: any) => ({
        payee: r.payee_clean || r.payee || 'Unknown',
        avgAmount: r.avg_amount || r.avgAmount || 0,
        cadence: r.cadence || r.detected_cadence || 'unknown',
        occurrences: r.count || r.occurrences || 1,
      })).slice(0, 30)
    }

    const unmapped = payees.filter((p) => p.payee && !p.payee.includes('Unknown') && p.payee !== '')
    const topUnmapped = unmapped.slice(0, 10)

    const conservativePct = 0.05
    const moderatePct = 0.10
    const aggressivePct = 0.15

    const suggestions = {
      conservative: { pct: conservativePct, weekly_amount: +(weeklyAvgSpend * conservativePct).toFixed(2) },
      moderate: { pct: moderatePct, weekly_amount: +(weeklyAvgSpend * moderatePct).toFixed(2) },
      aggressive: { pct: aggressivePct, weekly_amount: +(weeklyAvgSpend * aggressivePct).toFixed(2) },
      projection_12_weeks: {
        conservative: +( (weeklyAvgSpend * conservativePct) * 12 ).toFixed(2),
        moderate: +( (weeklyAvgSpend * moderatePct) * 12 ).toFixed(2),
        aggressive: +( (weeklyAvgSpend * aggressivePct) * 12 ).toFixed(2),
      },
      formulas: {
        weekly_average_spend: 'SUM(spend last 26 weeks) / number_of_weeks_with_data',
        suggested_weekly_save: 'weekly_average_spend * scenario_pct',
        projection_12_weeks: 'suggested_weekly_save * 12'
      }
    }

    const payload = {
      tiles: { currentBalance, weeklyAvgSpend, monthlyNetFlow },
      charts: { weekly, categories, payees: payees.slice(0, 10) },
      recurring,
      suggestions,
      topUnmapped,
      generatedAt: new Date().toISOString(),
    }

    cache = { ts: Date.now(), userId, payload }

    return res.status(200).json({ fromCache: false, ...payload })
  } catch (err) {
    console.error('dashboard-summary error', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
