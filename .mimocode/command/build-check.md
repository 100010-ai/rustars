---
description: "Run TypeScript typecheck + Next.js build, report errors clearly"
---

# Build Check

Run the full build verification cycle for a Next.js project.

## Steps

1. **TypeScript typecheck** — catch compile errors before the slower build:
   ```
   npx tsc --noEmit 2>&1
   ```

2. **Next.js production build** — full compilation check:
   ```
   npx next build 2>&1
   ```

3. **Report** — summarize: pass/fail, number of errors, key error lines (file:line).

## Notes

- If `npx tsc` fails, fix type errors first — `next build` will show the same errors plus more.
- If `tsc` passes but `next build` fails, the issue is likely in Next.js-specific code (server components, dynamic imports, missing env vars).
- Use `Select-Object -Last 5` on Windows PowerShell for quick tail output.
- For projects where `npx` is slow, try `node_modules/.bin/tsc` directly.
