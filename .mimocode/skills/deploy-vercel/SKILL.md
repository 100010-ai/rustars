---
name: deploy-vercel
description: "Deploy a Next.js project to Vercel production, with build verification and error diagnosis"
---

# Vercel Deploy Skill

Deploy a Next.js project to Vercel production with pre-flight checks.

## Pre-deploy checklist

1. **Typecheck**: `npx tsc --noEmit 2>&1`
2. **Build**: `npx next build 2>&1`
3. If either fails — fix errors before deploying.

## Deploy

```powershell
# Standard production deploy
npx vercel --prod --yes 2>&1

# Or via git push (if Vercel is linked to repo)
git add -A; git commit -m "<message>"; git push origin main
```

## Post-deploy verification

1. Check deployment URL is accessible
2. Check for runtime errors in Vercel logs: `npx vercel logs <url> --limit 20`
3. Verify environment variables: `npx vercel env ls`

## Common issues

- **Build passes locally but fails on Vercel**: check `NEXT_PUBLIC_*` env vars are set in Vercel dashboard.
- **"Invalid supabaseUrl" on cold start**: use lazy `import()` for Supabase client inside route handlers.
- **Module not found**: ensure `vercel.json` has correct `buildCommand` / `outputDirectory` if not auto-detected.
- **Puppeteer/Playwright can't run**: these need a VPS (Vercel serverless doesn't support them).
