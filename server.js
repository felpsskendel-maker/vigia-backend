// ======================================================
// VIGIA BACKEND
// V1.8.1
// Desenvolvedor: Felipe Skendel
//
// Supabase/PostgreSQL + monitoramento server-side.
// Primeira loja monitorada na nuvem: Mercado Livre.
//
// Variáveis obrigatórias:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Variável recomendada para proteger execução remota:
//   MONITOR_SECRET
// ======================================================

const http = require("http");
const crypto = require("crypto");
const {
    executarMonitoramento,
    obterEstadoMonitoramento
} = require("./monitor");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

const SUPABASE_URL_RAW = String(
    process.env.SUPABASE_URL || ""
).trim();

const SUPABASE_SERVICE_ROLE_KEY = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const MONITOR_SECRET = String(
    process.env.MONITOR_SECRET || ""
).trim();

function normalizarSupabaseUrl(valor) {
    let url = String(valor || "").trim();

    if (!url) {
        return "";
    }

    url = url.replace(/^["']|["']$/g, "");
    url = url.replace(/\/rest\/v1\/?$/i, "");
    url = url.replace(/\/+$/g, "");

    if (!/^https?:\/\//i.test(url)) {
        if (/^[a-z0-9]{15,40}$/i.test(url)) {
            url = `https://${url}.supabase.co`;
        } else {
            url = `https://${url}`;
        }
    }

    return url;
}

const SUPABASE_URL = normalizarSupabaseUrl(
    SUPABASE_URL_RAW
);

function agora() {
    return new Date().toISOString();
}

function configurado() {
    return Boolean(
        SUPABASE_URL &&
        SUPABASE_SERVICE_ROLE_KEY
    );
}

function chaveProduto(url) {
    return crypto
        .createHash("sha256")
        .update(String(url || ""))
        .digest("hex")
        .substring(0, 24);
}

function headersSupabase(extra = {}) {
    return {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        ...extra
    };
}

async function supabase(path, options = {}) {
    if (!configurado()) {
        throw new Error(
            "Supabase não configurado no ambiente."
        );
    }

    const endpoint =
        `${SUPABASE_URL}/rest/v1/${path}`;

    let resposta;

    try {
        resposta = await fetch(
            endpoint,
            {
                ...options,
                headers: {
                    ...headersSupabase(),
                    ...(options.headers || {})
                }
            }
        );
    } catch (erro) {
        throw new Error(
            `Falha ao acessar ${SUPABASE_URL}: ${String(
                erro?.message || erro
            )}`
        );
    }

    const texto = await resposta.text();
    let dados = null;

    if (texto) {
        try {
            dados = JSON.parse(texto);
        } catch {
            dados = texto;
        }
    }

    if (!resposta.ok) {
        const detalhe =
            typeof dados === "string"
                ? dados
                : JSON.stringify(dados);

        throw new Error(
            `Supabase ${resposta.status}: ${detalhe}`
        );
    }

    return dados;
}

function json(res, status, payload) {
    const body = JSON.stringify(payload);

    res.writeHead(status, {
        "Content-Type":
            "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
            "Content-Type, X-Vigia-Monitor-Secret",
        "Access-Control-Allow-Methods":
            "GET,POST,OPTIONS",
        "Cache-Control": "no-store"
    });

    res.end(body);
}

function receberBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";

        req.on("data", chunk => {
            body += chunk;

            if (body.length > 2_000_000) {
                reject(
                    new Error("Payload muito grande.")
                );
                req.destroy();
            }
        });

        req.on("end", () => {
            try {
                resolve(
                    body
                        ? JSON.parse(body)
                        : {}
                );
            } catch {
                reject(
                    new Error("JSON inválido.")
                );
            }
        });

        req.on("error", reject);
    });
}

function normalizarHistorico(produto) {
    const historico =
        Array.isArray(produto?.historico)
            ? produto.historico
            : [];

    return historico
        .map(item => ({
            preco: Number(item.preco),
            data: item.data || agora()
        }))
        .filter(item =>
            Number.isFinite(item.preco) &&
            item.preco > 0 &&
            item.data
        )
        .slice(-500);
}

function precoEfetivoProduto(produto) {
    const candidatos = [
        produto?.pagamentoAtual?.precoEfetivo,
        produto?.precoEfetivo,
        produto?.precoAtual,
        produto?.preco
    ];

    for (const valor of candidatos) {
        const numero = Number(valor);

        if (
            Number.isFinite(numero) &&
            numero > 0
        ) {
            return numero;
        }
    }

    return null;
}

async function upsertProduto(produto, appVersion) {
    const id = chaveProduto(produto.url);
    const precoEfetivo =
        precoEfetivoProduto(produto);

    const registro = {
        id,
        url: produto.url,
        nome:
            produto.nome ||
            produto.titulo ||
            null,
        loja: produto.loja || null,
        preco:
            Number.isFinite(
                Number(produto.precoAtual)
            )
                ? Number(produto.precoAtual)
                : (
                    Number.isFinite(
                        Number(produto.preco)
                    )
                        ? Number(produto.preco)
                        : null
                ),
        preco_efetivo: precoEfetivo,
        preco_alvo:
            Number.isFinite(
                Number(produto.precoAlvo)
            )
                ? Number(produto.precoAlvo)
                : null,
        ativo: produto.ativo !== false,
        dados: produto,
        app_version:
            appVersion || "1.8.1",
        updated_at: agora()
    };

    await supabase(
        "products?on_conflict=id",
        {
            method: "POST",
            headers: {
                Prefer:
                    "resolution=merge-duplicates,return=minimal"
            },
            body: JSON.stringify([registro])
        }
    );

    return id;
}

async function upsertHistorico(
    productId,
    produto
) {
    const historico =
        normalizarHistorico(produto);

    const atual =
        precoEfetivoProduto(produto);

    if (
        atual &&
        !historico.some(
            item =>
                Math.abs(
                    Number(item.preco) -
                    atual
                ) < 0.009
        )
    ) {
        historico.push({
            preco: atual,
            data:
                produto.ultimaAtualizacao ||
                produto.ultimaTentativa ||
                agora()
        });
    }

    if (!historico.length) {
        return 0;
    }

    const registros =
        historico.map(item => ({
            product_id: productId,
            preco: Number(item.preco),
            captured_at: item.data
        }));

    await supabase(
        "price_history?on_conflict=product_id,captured_at,preco",
        {
            method: "POST",
            headers: {
                Prefer:
                    "resolution=ignore-duplicates,return=minimal"
            },
            body: JSON.stringify(registros)
        }
    );

    return registros.length;
}

async function listarProdutos() {
    const linhas =
        await supabase(
            "products?select=*&order=updated_at.desc",
            { method: "GET" }
        ) || [];

    const produtos = [];

    for (const linha of linhas) {
        const historicoResp =
            await supabase(
                `price_history?product_id=eq.${encodeURIComponent(
                    linha.id
                )}&select=preco,captured_at&order=captured_at.asc`,
                { method: "GET" }
            ) || [];

        produtos.push({
            ...(linha.dados || {}),
            id: linha.id,
            url: linha.url,
            nome:
                linha.nome ??
                linha.dados?.nome ??
                null,
            loja:
                linha.loja ??
                linha.dados?.loja ??
                null,
            precoAtual:
                linha.preco ??
                linha.dados?.precoAtual ??
                null,
            precoEfetivo:
                linha.preco_efetivo ??
                linha.dados?.precoEfetivo ??
                null,
            precoAlvo:
                linha.preco_alvo ??
                linha.dados?.precoAlvo ??
                null,
            ativo: linha.ativo,
            appVersion: linha.app_version,
            backendUpdatedAt:
                linha.updated_at,
            historico:
                historicoResp.map(item => ({
                    preco:
                        Number(item.preco),
                    data:
                        item.captured_at
                }))
        });
    }

    return produtos;
}

async function historicoPorUrl(productUrl) {
    const id = chaveProduto(productUrl);

    const produtos =
        await supabase(
            `products?id=eq.${encodeURIComponent(
                id
            )}&select=id&limit=1`,
            { method: "GET" }
        ) || [];

    if (!produtos.length) {
        return {
            found: false,
            history: []
        };
    }

    const linhas =
        await supabase(
            `price_history?product_id=eq.${encodeURIComponent(
                id
            )}&select=preco,captured_at&order=captured_at.asc`,
            { method: "GET" }
        ) || [];

    return {
        found: true,
        history:
            linhas.map(item => ({
                preco:
                    Number(item.preco),
                data:
                    item.captured_at
            }))
    };
}

function segredoMonitorValido(req) {
    if (!MONITOR_SECRET) {
        return false;
    }

    const recebido = String(
        req.headers[
            "x-vigia-monitor-secret"
        ] || ""
    ).trim();

    if (!recebido) {
        return false;
    }

    const esperadoBuffer =
        Buffer.from(MONITOR_SECRET);

    const recebidoBuffer =
        Buffer.from(recebido);

    if (
        esperadoBuffer.length !==
        recebidoBuffer.length
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        esperadoBuffer,
        recebidoBuffer
    );
}

const monitorDeps = {
    supabase,
    agora
};

const server = http.createServer(
    async (req, res) => {
        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin":
                    "*",
                "Access-Control-Allow-Headers":
                    "Content-Type, X-Vigia-Monitor-Secret",
                "Access-Control-Allow-Methods":
                    "GET,POST,OPTIONS"
            });
            res.end();
            return;
        }

        const url = new URL(
            req.url,
            `http://${
                req.headers.host ||
                "localhost"
            }`
        );

        if (
            req.method === "GET" &&
            url.pathname === "/"
        ) {
            json(res, 200, {
                ok: true,
                app: "VIGIA Backend",
                version: "1.8.1",
                database:
                    "Supabase/PostgreSQL",
                monitor:
                    "Ofertas server-side",
                configured: configurado(),
                monitorSecretConfigured:
                    Boolean(MONITOR_SECRET),
                supabaseHost:
                    SUPABASE_URL
            });
            return;
        }

        if (
            req.method === "GET" &&
            url.pathname === "/api/health"
        ) {
            if (!configurado()) {
                json(res, 503, {
                    ok: false,
                    app: "VIGIA",
                    version: "1.8.1",
                    database: "Supabase",
                    configured: false,
                    monitorSecretConfigured:
                        Boolean(MONITOR_SECRET),
                    supabaseHost:
                        SUPABASE_URL,
                    error:
                        "Variáveis do Supabase não configuradas."
                });
                return;
            }

            try {
                await supabase(
                    "products?select=id&limit=1",
                    { method: "GET" }
                );

                json(res, 200, {
                    ok: true,
                    app: "VIGIA",
                    version: "1.8.1",
                    database: "Supabase",
                    configured: true,
                    monitor:
                        "Ofertas server-side",
                    monitorSecretConfigured:
                        Boolean(MONITOR_SECRET),
                    supabaseHost:
                        SUPABASE_URL,
                    time: agora()
                });
            } catch (erro) {
                json(res, 503, {
                    ok: false,
                    app: "VIGIA",
                    version: "1.8.1",
                    database: "Supabase",
                    configured: true,
                    monitorSecretConfigured:
                        Boolean(MONITOR_SECRET),
                    supabaseHost:
                        SUPABASE_URL,
                    error: String(
                        erro?.message ||
                        erro
                    )
                });
            }

            return;
        }

        if (
            req.method === "GET" &&
            url.pathname ===
                "/api/products"
        ) {
            try {
                const products =
                    await listarProdutos();

                json(res, 200, {
                    ok: true,
                    database: "Supabase",
                    products
                });
            } catch (erro) {
                json(res, 500, {
                    ok: false,
                    error: String(
                        erro?.message ||
                        erro
                    )
                });
            }

            return;
        }

        if (
            req.method === "GET" &&
            url.pathname ===
                "/api/history"
        ) {
            const productUrl =
                url.searchParams.get("url");

            if (!productUrl) {
                json(res, 400, {
                    ok: false,
                    error: "Informe ?url="
                });
                return;
            }

            try {
                const resultado =
                    await historicoPorUrl(
                        productUrl
                    );

                json(res, 200, {
                    ok: true,
                    database: "Supabase",
                    ...resultado
                });
            } catch (erro) {
                json(res, 500, {
                    ok: false,
                    error: String(
                        erro?.message ||
                        erro
                    )
                });
            }

            return;
        }

        if (
            req.method === "GET" &&
            url.pathname ===
                "/api/monitor/status"
        ) {
            json(res, 200, {
                ok: true,
                version: "1.8.1",
                ...obterEstadoMonitoramento()
            });
            return;
        }

        if (
            req.method === "POST" &&
            url.pathname ===
                "/api/monitor/run"
        ) {
            if (!segredoMonitorValido(req)) {
                json(res, 401, {
                    ok: false,
                    error:
                        "Monitor não autorizado."
                });
                return;
            }

            try {
                const resultado =
                    await executarMonitoramento(
                        monitorDeps
                    );

                json(res, 200, {
                    ok: true,
                    version: "1.8.1",
                    ...resultado
                });
            } catch (erro) {
                console.error(
                    "[VIGIA] Erro no monitor:",
                    erro
                );

                json(res, 500, {
                    ok: false,
                    version: "1.8.1",
                    error: String(
                        erro?.message ||
                        erro
                    )
                });
            }

            return;
        }

        if (
            req.method === "POST" &&
            url.pathname ===
                "/api/products/sync"
        ) {
            try {
                const payload =
                    await receberBody(req);

                const produto =
                    payload?.product;

                if (!produto?.url) {
                    json(res, 400, {
                        ok: false,
                        error:
                            "Produto sem URL."
                    });
                    return;
                }

                const id =
                    await upsertProduto(
                        produto,
                        payload.appVersion ||
                            "1.8.1"
                    );

                const historyCount =
                    await upsertHistorico(
                        id,
                        produto
                    );

                json(res, 200, {
                    ok: true,
                    database: "Supabase",
                    id,
                    historyCount
                });
            } catch (erro) {
                console.error(
                    "[VIGIA] Erro de sincronização:",
                    erro
                );

                json(res, 500, {
                    ok: false,
                    error: String(
                        erro?.message ||
                        erro
                    )
                });
            }

            return;
        }

        json(res, 404, {
            ok: false,
            error: "Rota não encontrada."
        });
    }
);

server.listen(
    PORT,
    HOST,
    () => {
        console.log(
            `VIGIA Backend V1.8.1 ativo em http://${HOST}:${PORT}`
        );

        console.log(
            configurado()
                ? "Supabase configurado."
                : "ATENÇÃO: Supabase ainda não configurado."
        );

        console.log(
            MONITOR_SECRET
                ? "Monitor remoto protegido e pronto."
                : "ATENÇÃO: MONITOR_SECRET não configurado; /api/monitor/run ficará bloqueado."
        );
    }
);
