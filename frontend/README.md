# Frontend (placeholder)

Not started yet. The plan, once the backend foundation is approved:

- **Next.js + TypeScript + Tailwind + shadcn/ui**, talking to the backend
  purely over the REST API defined in `backend/` (see `/api/docs/` for the
  live OpenAPI/Swagger UI once the backend is running).
- Reads `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_RAZORPAY_KEY_ID` from
  environment (see the repo root `.env.example`) — no backend secrets ever
  reach this app; only public, client-safe values.
- Scaffolding this app is intentionally deferred until there's more than one
  backend vertical slice to build a UI against.
