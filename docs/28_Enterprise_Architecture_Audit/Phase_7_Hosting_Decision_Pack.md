# Phase 7 / Track C — Hosting Decision Pack (owner picks one word)

**Type:** Decision support (Track C, owner-gated) · **Date:** 2026-07-10 · **App:** Vite SPA + PWA,
all data via Supabase (ap-northeast-1) — the host serves STATIC FILES ONLY. No server code, no secrets
on the host (the anon key is public by design; RLS is the security). TWA/Play (Track E) needs the
stable HTTPS domain this creates.

## The comparison, for THIS app + a Philippines user base

| | **Vercel** | **Netlify** | **Cloudflare Pages** |
|---|---|---|---|
| Free tier fits us | ✅ 100 GB/mo bandwidth | ✅ 100 GB/mo | ✅ **unlimited bandwidth** |
| PH edge latency | Good (SG edge) | Good (SG edge) | **Best (MNL edge — your CF-RAY already showed MNL)** |
| Deploy from GitHub repo | ✅ auto per push | ✅ auto per push | ✅ auto per push |
| SPA fallback + PWA/service-worker | ✅ trivial config | ✅ trivial config | ✅ trivial config |
| Custom domain + auto-HTTPS | ✅ | ✅ | ✅ |
| Gotchas | commercial-use limits on free tier | build-minute caps | none material for a static SPA |

**Recommendation: Cloudflare Pages** — Manila edge + unlimited free bandwidth is the best fit for a
PH farm POS; no meaningful downside for a static SPA.

## Owner one-word go: reply "Vercel", "Netlify", or "Cloudflare"

Then the agent-executable half (next session): add the SPA-fallback config + build settings, connect the
GitHub repo in the host dashboard (OWNER clicks: import repo `noyanxtdoor-maker/pick-ur-veggie-farm`,
build `npm run build`, output `dist/`, env vars `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`), first
deploy, then: Supabase Auth → URL configuration (add the hosted domain to redirect allow-list), re-run
the live E2E against the hosted URL, and unblock Track E (PNG icons → Bubblewrap → assetlinks → AAB).

**Non-secret reminder:** only the anon key ever reaches the host env — never service_role, never the DB
password (C2 §7).
