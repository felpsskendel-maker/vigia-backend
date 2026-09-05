// ======================================================
// VIGIA MONITOR SERVER-SIDE
// V1.8.0
// Desenvolvedor: Felipe Skendel
//
// Primeira implementação:
//   Mercado Livre
//
// Não depende do Chrome.
// Lê produtos ativos do Supabase, acessa a página,
// captura o preço e grava a leitura no price_history.
// ======================================================

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/152.0.0.0 Safari/537.36";

const TIMEOUT_MS = 20_000;
const ESPERA_ENTRE_PRODUTOS_MS = 1_500;
const LIMITE_POR_EXECUCAO = 20;

let estado = {
    running: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastResult: null
};

function dormir(ms) {
    return new Promise(
        resolve => setTimeout(resolve, ms)
    );
}

function textoLimpo(valor) {
    return String(valor ?? "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&#x27;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

function numeroPreco(valor) {
    if (
        valor === null ||
        valor === undefined
    ) {
        return null;
    }

    if (
        typeof valor === "number"
    ) {
        return (
            Number.isFinite(valor) &&
            valor > 0
        )
            ? valor
            : null;
    }

    let texto = String(valor)
        .replace(/\s/g, "")
        .replace(/[^\d.,-]/g, "");

    if (!texto) {
        return null;
    }

    const ultimaVirgula =
        texto.lastIndexOf(",");

    const ultimoPonto =
        texto.lastIndexOf(".");

    if (
        ultimaVirgula >= 0 &&
        ultimoPonto >= 0
    ) {
        if (
            ultimaVirgula >
            ultimoPonto
        ) {
            texto = texto
                .replace(/\./g, "")
                .replace(",", ".");
        } else {
            texto = texto
                .replace(/,/g, "");
        }
    } else if (
        ultimaVirgula >= 0
    ) {
        const decimais =
            texto.length -
            ultimaVirgula -
            1;

        texto =
            decimais === 2
                ? texto.replace(",", ".")
                : texto.replace(/,/g, "");
    } else if (
        ultimoPonto >= 0
    ) {
        const decimais =
            texto.length -
            ultimoPonto -
            1;

        if (decimais !== 2) {
            texto =
                texto.replace(/\./g, "");
        }
    }

    const numero =
        Number(texto);

    if (
        !Number.isFinite(numero) ||
        numero <= 0
    ) {
        return null;
    }

    return Math.round(
        numero * 100
    ) / 100;
}

function eMercadoLivre(produto) {
    const url =
        String(produto?.url || "")
            .toLowerCase();

    const loja =
        String(produto?.loja || "")
            .toLowerCase();

    return (
        url.includes(
            "mercadolivre.com.br"
        ) ||
        url.includes(
            "mercadolibre.com"
        ) ||
        loja.includes(
            "mercado livre"
        ) ||
        loja.includes(
            "mercadolivre"
        )
    );
}

function extrairJsonLd(html) {
    const blocos = [];
    const regex =
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match;

    while (
        (match = regex.exec(html))
    ) {
        const bruto =
            match[1]?.trim();

        if (!bruto) {
            continue;
        }

        try {
            blocos.push(
                JSON.parse(bruto)
            );
        } catch {
            // Alguns sites inserem JSON-LD inválido.
        }
    }

    return blocos;
}

function achatarJsonLd(valor, saida = []) {
    if (!valor) {
        return saida;
    }

    if (Array.isArray(valor)) {
        for (const item of valor) {
            achatarJsonLd(
                item,
                saida
            );
        }
        return saida;
    }

    if (
        typeof valor === "object"
    ) {
        saida.push(valor);

        if (
            Array.isArray(valor["@graph"])
        ) {
            achatarJsonLd(
                valor["@graph"],
                saida
            );
        }
    }

    return saida;
}

function extrairPrecoJsonLd(html) {
    const objetos =
        extrairJsonLd(html)
            .flatMap(item =>
                achatarJsonLd(item)
            );

    for (const objeto of objetos) {
        const tipo =
            String(
                objeto?.["@type"] || ""
            ).toLowerCase();

        if (
            tipo !== "product" &&
            !objeto?.offers
        ) {
            continue;
        }

        const ofertas =
            Array.isArray(objeto.offers)
                ? objeto.offers
                : [objeto.offers]
                    .filter(Boolean);

        for (const oferta of ofertas) {
            const candidatos = [
                oferta?.price,
                oferta?.lowPrice,
                oferta?.highPrice
            ];

            for (
                const candidato
                of candidatos
            ) {
                const preco =
                    numeroPreco(candidato);

                if (preco) {
                    return {
                        preco,
                        fonte:
                            "JSON-LD"
                    };
                }
            }
        }
    }

    return null;
}

function extrairMeta(html, atributo) {
    const escaped =
        atributo.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

    const regexes = [
        new RegExp(
            `<meta[^>]+itemprop=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']${escaped}["'][^>]*>`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`,
            "i"
        )
    ];

    for (const regex of regexes) {
        const match =
            html.match(regex);

        if (match?.[1]) {
            return textoLimpo(
                match[1]
            );
        }
    }

    return null;
}

function extrairPrecoMeta(html) {
    const campos = [
        "price",
        "product:price:amount",
        "og:price:amount"
    ];

    for (const campo of campos) {
        const valor =
            extrairMeta(html, campo);

        const preco =
            numeroPreco(valor);

        if (preco) {
            return {
                preco,
                fonte:
                    `META:${campo}`
            };
        }
    }

    return null;
}

function extrairPrecoMercadoLivre(html) {
    const porJsonLd =
        extrairPrecoJsonLd(html);

    if (porJsonLd) {
        return porJsonLd;
    }

    const porMeta =
        extrairPrecoMeta(html);

    if (porMeta) {
        return porMeta;
    }

    const regexes = [
        /"price"\s*:\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
        /"amount"\s*:\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
        /andes-money-amount__fraction[^>]*>\s*([\d.]+)\s*</i
    ];

    for (const regex of regexes) {
        const match =
            html.match(regex);

        const preco =
            numeroPreco(match?.[1]);

        if (preco) {
            return {
                preco,
                fonte:
                    "HTML"
            };
        }
    }

    return null;
}

function extrairTitulo(html) {
    const og =
        extrairMeta(
            html,
            "og:title"
        );

    if (og) {
        return og;
    }

    const match =
        html.match(
            /<title[^>]*>([\s\S]*?)<\/title>/i
        );

    return match?.[1]
        ? textoLimpo(match[1])
        : null;
}

async function baixarPagina(url) {
    const controller =
        new AbortController();

    const timer =
        setTimeout(
            () => controller.abort(),
            TIMEOUT_MS
        );

    try {
        const resposta =
            await fetch(url, {
                method: "GET",
                redirect: "follow",
                signal:
                    controller.signal,
                headers: {
                    "User-Agent":
                        USER_AGENT,
                    "Accept":
                        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language":
                        "pt-BR,pt;q=0.9,en;q=0.7",
                    "Cache-Control":
                        "no-cache",
                    "Pragma":
                        "no-cache",
                    "Upgrade-Insecure-Requests":
                        "1"
                }
            });

        const html =
            await resposta.text();

        if (!resposta.ok) {
            throw new Error(
                `HTTP ${resposta.status}`
            );
        }

        if (
            !html ||
            html.length < 1000
        ) {
            throw new Error(
                "HTML vazio ou incompleto."
            );
        }

        return {
            html,
            finalUrl:
                resposta.url || url,
            status:
                resposta.status
        };
    } catch (erro) {
        if (
            erro?.name ===
            "AbortError"
        ) {
            throw new Error(
                "Timeout ao acessar produto."
            );
        }

        throw erro;
    } finally {
        clearTimeout(timer);
    }
}

async function selecionarProdutos(deps) {
    const { supabase } = deps;

    return (
        await supabase(
            `products?ativo=eq.true&select=id,url,nome,loja,preco,preco_efetivo,preco_alvo,dados,app_version,updated_at&order=updated_at.asc&limit=${LIMITE_POR_EXECUCAO}`,
            { method: "GET" }
        )
    ) || [];
}

async function gravarSucesso(
    deps,
    produto,
    captura
) {
    const {
        supabase,
        agora
    } = deps;

    const instante = agora();
    const preco =
        Number(captura.preco);

    const dadosAnteriores =
        produto?.dados &&
        typeof produto.dados ===
            "object"
            ? produto.dados
            : {};

    const alvo =
        Number.isFinite(
            Number(produto.preco_alvo)
        )
            ? Number(
                produto.preco_alvo
            )
            : (
                Number.isFinite(
                    Number(
                        dadosAnteriores
                            ?.precoAlvo
                    )
                )
                    ? Number(
                        dadosAnteriores
                            .precoAlvo
                    )
                    : null
            );

    const dadosNovos = {
        ...dadosAnteriores,
        url: produto.url,
        nome:
            produto.nome ||
            dadosAnteriores.nome ||
            captura.titulo ||
            null,
        loja:
            produto.loja ||
            dadosAnteriores.loja ||
            "Mercado Livre",
        precoAtual: preco,
        precoEfetivo: preco,
        ultimaAtualizacao:
            instante,
        monitorNuvem: {
            ativo: true,
            loja:
                "Mercado Livre",
            status: "ok",
            fonte:
                captura.fonte,
            ultimaVerificacao:
                instante,
            urlFinal:
                captura.finalUrl,
            precoCapturado:
                preco,
            atingiuAlvo:
                alvo !== null
                    ? preco <= alvo
                    : false
        }
    };

    await supabase(
        `products?id=eq.${encodeURIComponent(
            produto.id
        )}`,
        {
            method: "PATCH",
            headers: {
                Prefer:
                    "return=minimal"
            },
            body: JSON.stringify({
                preco,
                preco_efetivo:
                    preco,
                dados: dadosNovos,
                app_version:
                    "1.8.0",
                updated_at:
                    instante
            })
        }
    );

    await supabase(
        "price_history?on_conflict=product_id,captured_at,preco",
        {
            method: "POST",
            headers: {
                Prefer:
                    "resolution=ignore-duplicates,return=minimal"
            },
            body: JSON.stringify([
                {
                    product_id:
                        produto.id,
                    preco,
                    captured_at:
                        instante
                }
            ])
        }
    );

    return {
        id: produto.id,
        nome:
            produto.nome ||
            captura.titulo ||
            null,
        url: produto.url,
        preco,
        precoAlvo: alvo,
        atingiuAlvo:
            alvo !== null
                ? preco <= alvo
                : false,
        fonte: captura.fonte
    };
}

async function gravarFalha(
    deps,
    produto,
    erro
) {
    const {
        supabase,
        agora
    } = deps;

    const instante = agora();

    const dadosAnteriores =
        produto?.dados &&
        typeof produto.dados ===
            "object"
            ? produto.dados
            : {};

    const dadosNovos = {
        ...dadosAnteriores,
        monitorNuvem: {
            ...(
                dadosAnteriores
                    .monitorNuvem ||
                {}
            ),
            ativo: true,
            loja:
                "Mercado Livre",
            status: "erro",
            ultimaVerificacao:
                instante,
            erro: String(
                erro?.message ||
                erro
            ).slice(0, 500)
        }
    };

    await supabase(
        `products?id=eq.${encodeURIComponent(
            produto.id
        )}`,
        {
            method: "PATCH",
            headers: {
                Prefer:
                    "return=minimal"
            },
            body: JSON.stringify({
                dados: dadosNovos,
                app_version:
                    "1.8.0",
                updated_at:
                    instante
            })
        }
    );
}

async function verificarMercadoLivre(
    deps,
    produto
) {
    const pagina =
        await baixarPagina(
            produto.url
        );

    const captura =
        extrairPrecoMercadoLivre(
            pagina.html
        );

    if (!captura?.preco) {
        throw new Error(
            "Preço não encontrado no HTML do Mercado Livre."
        );
    }

    return gravarSucesso(
        deps,
        produto,
        {
            ...captura,
            titulo:
                extrairTitulo(
                    pagina.html
                ),
            finalUrl:
                pagina.finalUrl
        }
    );
}

async function executarMonitoramento(
    deps
) {
    if (estado.running) {
        return {
            skipped: true,
            reason:
                "Monitoramento já está em execução.",
            state:
                obterEstadoMonitoramento()
        };
    }

    estado.running = true;
    estado.lastStartedAt =
        deps.agora();

    const resultado = {
        startedAt:
            estado.lastStartedAt,
        finishedAt: null,
        selected: 0,
        supported: 0,
        checked: 0,
        success: 0,
        failed: 0,
        ignoredUnsupported: 0,
        hitsTarget: 0,
        items: []
    };

    try {
        const produtos =
            await selecionarProdutos(
                deps
            );

        resultado.selected =
            produtos.length;

        for (
            let i = 0;
            i < produtos.length;
            i++
        ) {
            const produto =
                produtos[i];

            if (!eMercadoLivre(produto)) {
                resultado
                    .ignoredUnsupported++;
                continue;
            }

            resultado.supported++;
            resultado.checked++;

            try {
                const item =
                    await verificarMercadoLivre(
                        deps,
                        produto
                    );

                resultado.success++;

                if (
                    item.atingiuAlvo
                ) {
                    resultado.hitsTarget++;
                }

                resultado.items.push({
                    ok: true,
                    ...item
                });
            } catch (erro) {
                resultado.failed++;

                try {
                    await gravarFalha(
                        deps,
                        produto,
                        erro
                    );
                } catch (
                    erroGravacao
                ) {
                    console.error(
                        "[VIGIA] Falha ao registrar erro do monitor:",
                        erroGravacao
                    );
                }

                resultado.items.push({
                    ok: false,
                    id:
                        produto.id,
                    nome:
                        produto.nome ||
                        null,
                    url:
                        produto.url,
                    error:
                        String(
                            erro?.message ||
                            erro
                        )
                });
            }

            if (
                i <
                produtos.length - 1
            ) {
                await dormir(
                    ESPERA_ENTRE_PRODUTOS_MS
                );
            }
        }

        resultado.finishedAt =
            deps.agora();

        estado.lastFinishedAt =
            resultado.finishedAt;

        estado.lastResult =
            resultado;

        return resultado;
    } finally {
        estado.running = false;
    }
}

function obterEstadoMonitoramento() {
    return {
        running:
            estado.running,
        lastStartedAt:
            estado.lastStartedAt,
        lastFinishedAt:
            estado.lastFinishedAt,
        lastResult:
            estado.lastResult
    };
}

module.exports = {
    executarMonitoramento,
    obterEstadoMonitoramento,

    // Exportados para testes locais.
    numeroPreco,
    extrairPrecoMercadoLivre
};
