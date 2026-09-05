# VIGIA Backend V1.7.0

Backend inicial do VIGIA para persistência de produtos e histórico de preços.

## Rodar localmente

1. Instale Node.js 18 ou superior.
2. Abra o terminal nesta pasta `backend`.
3. Rode:

```bash
npm start
```

O servidor iniciará em:

```text
http://localhost:8787
```

Teste:

```text
http://localhost:8787/api/health
```

## Integração com a extensão

A extensão V1.7.0 tenta sincronizar automaticamente com:

```text
http://localhost:8787
```

Se o backend estiver desligado, a extensão continua funcionando normalmente com `chrome.storage.local`.

Para usar outro endereço de backend, defina no console da extensão:

```js
chrome.storage.local.set({
  vigiaBackendUrl: "https://SEU-BACKEND.com"
});
```

Depois recarregue a extensão.

## O que já persiste

- produto;
- URL;
- preço atual;
- alvo;
- histórico de preços;
- comparações encontradas;
- condições de pagamento;
- vendedor e reputação quando disponíveis.

## Importante

Esta V1.7.0 introduz persistência remota e restaura o histórico visual.
O monitoramento/scraping principal ainda é executado pela extensão Chrome.
Para um serviço 100% independente do navegador, a próxima camada seria um worker
de monitoramento no servidor (Playwright/API/feed das lojas), com autenticação e banco de dados.
