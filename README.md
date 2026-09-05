# VIGIA Backend V1.7.2 — Supabase FIX

Correção da integração com as novas chaves `sb_secret_...` do Supabase.

## O que mudou

- remove `Authorization: Bearer` para secret key;
- usa a secret key somente em `apikey`;
- normaliza `SUPABASE_URL`;
- aceita tanto a URL completa quanto apenas o Project Ref;
- remove `/rest/v1` caso tenha sido colocado por engano na variável;
- `/api/health` mostra somente o host do Supabase para facilitar diagnóstico, nunca a chave secreta.

## Render

Mantenha estas duas variáveis:

```text
SUPABASE_URL
https://SEU_PROJECT_REF.supabase.co

SUPABASE_SERVICE_ROLE_KEY
sb_secret_...
```

## Atualização

No repositório `vigia-backend`, substitua:

- `server.js`
- `package.json`
- `README.md`

Faça commit na branch `main`.
O Render fará o deploy automaticamente.

## Teste

Abra:

```text
https://SEU-SERVICO.onrender.com/api/health
```

Resultado esperado:

```json
{
  "ok": true,
  "app": "VIGIA",
  "version": "1.7.2",
  "database": "Supabase",
  "configured": true,
  "supabaseHost": "https://SEU_PROJECT_REF.supabase.co"
}
```
