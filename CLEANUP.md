# CLEANUP: route conflict resolution — feat/dashboard-hp

Backup branch created (remote): backup/feat-dashboard-hp-keep-app-20251018-1341

What changed:
- Removed conflicting app-router pages so Next.js can use the new pages-router implementations.
  - Deleted: app/dashboard/page.tsx
  - Deleted: app/sign-in/page.tsx

Why:
- Next.js cannot have the same route defined in both app/ and pages/.
- We keep pages/* (dashboard.tsx, sign-in.tsx) which are the new, intended implementations.

Follow-ups:
1. Monitor Vercel preview redeploy for branch feat/dashboard-hp.
2. If build fails, copy the Vercel build error and paste it here.
3. After successful deploy, we should (a) add your Vercel domain(s) to Supabase Auth redirect URLs, (b) remove the temporary token-extraction fallback in pages/dashboard.tsx and rely on supabase.auth.getSession().

