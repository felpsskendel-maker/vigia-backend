# VIGIA Backend V1.7.1 — Supabase

Esta versão substitui o `db.json` por persistência permanente no Supabase/PostgreSQL.

## Variáveis obrigatórias no Render

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Arquivos do repositório

Substitua o conteúdo do repositório `vigia-backend` por:

- `server.js`
- `package.json`
- `README.md`

A pasta `data` e o `db.json` da V1.7.0 não são mais usados.

## Deploy

Faça commit na branch `main`.
O Render conectado ao GitHub fará o deploy automaticamente.

## Teste

Abra:

`https://SEU-SERVICO.onrender.com/api/health`

Resultado esperado:

```json
{
  "ok": true,
  "app": "VIGIA",
  "version": "1.7.1",
  "database": "Supabase",
  "configured": true
}
```

Depois faça uma comparação/atualização na extensão e abra:

`https://SEU-SERVICO.onrender.com/api/products`

Os produtos devem vir do Supabase.
