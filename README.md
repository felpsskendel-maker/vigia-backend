# VIGIA Backend V1.8.0 — Monitoramento 24/7

Desenvolvedor: **Felipe Skendel**

Esta versão parte da V1.7.2 validada e preserva toda a integração com Supabase.

## O que entra na V1.8.0

A primeira loja monitorada diretamente pelo servidor é o **Mercado Livre**.

Fluxo:

```text
Supabase products
    ↓
produtos ativos do Mercado Livre
    ↓
Render acessa a página do produto
    ↓
captura o preço
    ↓
atualiza products
    ↓
insere nova leitura em price_history
```

A extensão continua funcionando normalmente. O monitor da nuvem é adicional.

## Arquivos

Substitua/adicone no repositório:

```text
server.js
monitor.js
package.json
README.md
.github/workflows/vigia-monitor.yml
```

## Variáveis do Render

Mantenha as que já funcionam:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Crie mais uma variável:

```text
MONITOR_SECRET
```

Use um valor longo e aleatório. Não envie esse valor em chat.

Exemplo apenas de formato:

```text
vigia_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Teste 1 — Health

Depois do deploy:

```text
https://vigia-backend-cjwb.onrender.com/api/health
```

Deve mostrar:

```json
{
  "ok": true,
  "version": "1.8.0",
  "database": "Supabase",
  "monitor": "Mercado Livre server-side",
  "monitorSecretConfigured": true
}
```

## Teste 2 — Executar manualmente o monitor

A rota é:

```text
POST /api/monitor/run
```

Ela exige o header:

```text
X-Vigia-Monitor-Secret: SEU_MONITOR_SECRET
```

No PowerShell:

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "https://vigia-backend-cjwb.onrender.com/api/monitor/run" `
  -Headers @{
    "X-Vigia-Monitor-Secret" = "SEU_MONITOR_SECRET"
  }
```

O resultado informa quantos produtos foram encontrados, suportados, verificados, concluídos e quantos falharam.

## Teste 3 — Conferir Supabase

Abra:

```text
Table Editor → price_history
```

Se houver produto ativo do Mercado Livre, uma nova linha deve aparecer com horário da execução.

Em:

```text
Table Editor → products
```

o produto monitorado também terá, dentro de `dados`:

```json
{
  "monitorNuvem": {
    "ativo": true,
    "loja": "Mercado Livre",
    "status": "ok"
  }
}
```

## Execução automática

O arquivo:

```text
.github/workflows/vigia-monitor.yml
```

pode chamar o Render a cada 30 minutos.

No GitHub, crie dois **Repository Secrets**:

```text
VIGIA_MONITOR_URL
VIGIA_MONITOR_SECRET
```

`VIGIA_MONITOR_URL`:

```text
https://vigia-backend-cjwb.onrender.com/api/monitor/run
```

`VIGIA_MONITOR_SECRET` precisa ser exatamente o mesmo valor de `MONITOR_SECRET` do Render.

Isso é importante porque o serviço gratuito do Render pode dormir. O GitHub Actions faz uma chamada externa periódica, acorda o serviço e dispara a verificação.

## Limites desta primeira versão

A V1.8.0 monitora na nuvem apenas produtos reconhecidos como Mercado Livre.

Amazon, KaBuM, Magalu e Shopee continuam funcionando pela extensão como antes e serão adicionados ao monitor server-side loja por loja, após validarmos o Mercado Livre.

Sites podem aplicar bloqueios ou alterar HTML. Uma falha de captura não apaga o preço anterior: ela apenas registra `monitorNuvem.status = "erro"` no produto.
