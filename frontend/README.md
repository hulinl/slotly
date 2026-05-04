# Slotly frontend

Next.js 15 + TypeScript + Tailwind + shadcn/ui. PWA via `next-pwa`.

## Layout (target)

```
frontend/
├── package.json
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.ts
├── app/                    # App Router routes
│   ├── layout.tsx
│   ├── page.tsx
│   ├── (auth)/             # login, register, verify
│   ├── (app)/              # authenticated app shell
│   └── api/                # route handlers (proxy / auth callbacks)
├── components/
│   ├── ui/                 # shadcn primitives
│   └── ...
├── lib/
│   ├── api.ts              # backend client
│   └── auth.ts
└── public/
    ├── icon-192.png
    ├── icon-512.png
    └── manifest.webmanifest
```

## Run locally

```bash
npm install
npm run dev
```
