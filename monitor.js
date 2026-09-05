// ======================================================
// VIGIA MONITOR SERVER-SIDE
// V1.8.1
// Desenvolvedor: Felipe Skendel
//
// Evolução da V1.8.0:
// - mantém monitoramento server-side;
// - passa a ler as ofertas já encontradas em `comparações`;
// - grava histórico separado em `offer_history`;
// - primeiro suporte de ofertas na nuvem:
//      Mercado Livre
//      KaBuM
//
// IMPORTANTE:
// O produto principal pode ser Amazon, Magalu, Shopee etc.
// Mesmo assim, suas ofertas conhecidas do Mercado Livre/KaBuM
// podem ser verificadas pelo servidor.
// ======================================================

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/152.0.0.0 Safari/537.36";

const TIMEOUT_MS = 20_000;
const ESPERA_ENTRE_REQUISICOES_MS = 1_500;
const LIMITE_PRODUTOS_POR_EXECUCAO = 20;
const LIMITE_OFERTAS_POR_PRODUTO = 12;

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

    if (typeof valor === "number") {
        return (
            Number.isFinite(valor) &&
            valor > 0
        )
            ? Math.round(valor * 100) / 100
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

    const numero = Number(texto);

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

function normalizarLoja(loja, url = "") {
    const nome =
        String(loja || "")
            .toLowerCase();

    const endereco =
        String(url || "")
            .toLowerCase();

    if (
        nome.includes("mercado livre") ||
        nome.includes("mercadolivre") ||
        endereco.includes(
            "mercadolivre.com.br"
        ) ||
        endereco.includes(
            "mercadolibre.com"
        )
    ) {
        return "Mercado Livre";
    }

    if (
        nome.includes("kabum") ||
        endereco.includes("kabum.com.br")
    ) {
        return "KaBuM";
    }

    if (
        nome.includes("amazon") ||
        endereco.includes("amazon.com.br")
    ) {
        return "Amazon";
    }

    if (
        nome.includes("magalu") ||
        nome.includes("magazine luiza") ||
        endereco.includes("magazineluiza.com.br")
    ) {
        return "Magalu";
    }

    if (
        nome.includes("shopee") ||
        endereco.includes("shopee.com.br")
    ) {
        return "Shopee";
    }

    return textoLimpo(loja) || "Outra";
}

function lojaSuportadaServidor(loja, url) {
    const normalizada =
        normalizarLoja(loja, url);

    return (
        normalizada === "Mercado Livre" ||
        normalizada === "KaBuM"
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
            // JSON-LD inválido: ignora e continua.
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
            Array.isArray(
                valor["@graph"]
            )
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

            for (const candidato of candidatos) {
                const preco =
                    numeroPreco(candidato);

                if (preco) {
                    return {
                        preco,
                        fonte: "JSON-LD"
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
                fonte: "HTML"
            };
        }
    }

    return null;
}

function extrairPrecoKabum(html) {
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
        /"price"\s*:\s*"?(?:R\$\s*)?([\d.,]+)"?/i,
        /"finalPrice"\s*:\s*"?([\d.,]+)"?/i,
        /"pixPrice"\s*:\s*"?([\d.,]+)"?/i,
        /R\$\s*([\d.]+,\d{2})/i
    ];

    for (const regex of regexes) {
        const match =
            html.match(regex);

        const preco =
            numeroPreco(match?.[1]);

        if (preco) {
            return {
                preco,
                fonte: "HTML"
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
            `products?ativo=eq.true&select=id,url,nome,loja,preco,preco_efetivo,preco_alvo,dados,app_version,updated_at&order=updated_at.asc&limit=${LIMITE_PRODUTOS_POR_EXECUCAO}`,
            { method: "GET" }
        )
    ) || [];
}

function ofertasConhecidas(produto) {
    const dados =
        produto?.dados &&
        typeof produto.dados === "object"
            ? produto.dados
            : {};

    const arrays = [
        dados["comparações"],
        dados.comparacoes
    ];

    let comparacoes = [];

    for (const valor of arrays) {
        if (Array.isArray(valor)) {
            comparacoes = valor;
            break;
        }
    }

    const porChave = new Map();

    for (
        const oferta of comparacoes
            .slice(
                0,
                LIMITE_OFERTAS_POR_PRODUTO
            )
    ) {
        if (!oferta?.url) {
            continue;
        }

        const loja =
            normalizarLoja(
                oferta.loja,
                oferta.url
            );

        const chave =
            `${loja}|${oferta.url}`;

        if (!porChave.has(chave)) {
            porChave.set(
                chave,
                {
                    ...oferta,
                    loja
                }
            );
        }
    }

    return [
        ...porChave.values()
    ];
}

async function ultimoPrecoOferta(
    deps,
    productId,
    loja,
    url
) {
    const { supabase } = deps;

    const linhas =
        await supabase(
            `offer_history?product_id=eq.${encodeURIComponent(
                productId
            )}&loja=eq.${encodeURIComponent(
                loja
            )}&url=eq.${encodeURIComponent(
                url
            )}&select=preco,captured_at&order=captured_at.desc&limit=1`,
            { method: "GET" }
        ) || [];

    if (!linhas.length) {
        return null;
    }

    const numero =
        Number(linhas[0].preco);

    return (
        Number.isFinite(numero) &&
        numero > 0
    )
        ? numero
        : null;
}

async function gravarHistoricoOfertaSeMudou(
    deps,
    productId,
    loja,
    url,
    preco
) {
    const {
        supabase,
        agora
    } = deps;

    const anterior =
        await ultimoPrecoOferta(
            deps,
            productId,
            loja,
            url
        );

    if (
        anterior !== null &&
        Math.abs(
            Number(anterior) -
            Number(preco)
        ) < 0.009
    ) {
        return {
            inserted: false,
            previousPrice:
                anterior
        };
    }

    const instante = agora();

    await supabase(
        "offer_history?on_conflict=product_id,loja,url,captured_at,preco",
        {
            method: "POST",
            headers: {
                Prefer:
                    "resolution=ignore-duplicates,return=minimal"
            },
            body: JSON.stringify([
                {
                    product_id:
                        productId,
                    loja,
                    url,
                    preco:
                        Number(preco),
                    captured_at:
                        instante
                }
            ])
        }
    );

    return {
        inserted: true,
        previousPrice:
            anterior,
        capturedAt:
            instante
    };
}

async function atualizarOfertaNoProduto(
    deps,
    produto,
    ofertaOriginal,
    captura,
    historico
) {
    const {
        supabase,
        agora
    } = deps;

    const instante = agora();

    const dados =
        produto?.dados &&
        typeof produto.dados === "object"
            ? produto.dados
            : {};

    const chaveComparacoes =
        Array.isArray(
            dados["comparações"]
        )
            ? "comparações"
            : "comparacoes";

    const comparacoes =
        Array.isArray(
            dados[chaveComparacoes]
        )
            ? dados[chaveComparacoes]
                .map(item => ({ ...item }))
            : [];

    const indice =
        comparacoes.findIndex(
            item =>
                item?.url ===
                ofertaOriginal.url
        );

    const ofertaAtualizada = {
        ...ofertaOriginal,
        loja:
            normalizarLoja(
                ofertaOriginal.loja,
                ofertaOriginal.url
            ),
        preco:
            Number(captura.preco),
        precoEfetivo:
            Number(captura.preco),
        monitorNuvem: {
            ativo: true,
            status: "ok",
            fonte:
                captura.fonte,
            ultimaVerificacao:
                instante,
            urlFinal:
                captura.finalUrl,
            precoCapturado:
                Number(
                    captura.preco
                ),
            historicoInserido:
                Boolean(
                    historico.inserted
                )
        }
    };

    if (indice >= 0) {
        comparacoes[indice] =
            ofertaAtualizada;
    } else {
        comparacoes.push(
            ofertaAtualizada
        );
    }

    const dadosNovos = {
        ...dados,
        [chaveComparacoes]:
            comparacoes,
        monitorNuvem: {
            ...(
                dados.monitorNuvem ||
                {}
            ),
            ofertas: {
                ativo: true,
                ultimaVerificacao:
                    instante
            }
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
                    "1.8.1",
                updated_at:
                    instante
            })
        }
    );
}

async function registrarFalhaOferta(
    deps,
    produto,
    ofertaOriginal,
    erro
) {
    const {
        supabase,
        agora
    } = deps;

    const instante = agora();

    const dados =
        produto?.dados &&
        typeof produto.dados === "object"
            ? produto.dados
            : {};

    const chaveComparacoes =
        Array.isArray(
            dados["comparações"]
        )
            ? "comparações"
            : "comparacoes";

    const comparacoes =
        Array.isArray(
            dados[chaveComparacoes]
        )
            ? dados[chaveComparacoes]
                .map(item => ({ ...item }))
            : [];

    const indice =
        comparacoes.findIndex(
            item =>
                item?.url ===
                ofertaOriginal.url
        );

    if (indice >= 0) {
        comparacoes[indice] = {
            ...comparacoes[indice],
            monitorNuvem: {
                ...(
                    comparacoes[indice]
                        ?.monitorNuvem ||
                    {}
                ),
                ativo: true,
                status: "erro",
                ultimaVerificacao:
                    instante,
                erro: String(
                    erro?.message ||
                    erro
                ).slice(0, 500)
            }
        };
    }

    const dadosNovos = {
        ...dados,
        [chaveComparacoes]:
            comparacoes,
        monitorNuvem: {
            ...(
                dados.monitorNuvem ||
                {}
            ),
            ofertas: {
                ativo: true,
                ultimaVerificacao:
                    instante
            }
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
                    "1.8.1",
                updated_at:
                    instante
            })
        }
    );
}

async function capturarOferta(oferta) {
    const loja =
        normalizarLoja(
            oferta.loja,
            oferta.url
        );

    const pagina =
        await baixarPagina(
            oferta.url
        );

    let captura = null;

    if (
        loja === "Mercado Livre"
    ) {
        captura =
            extrairPrecoMercadoLivre(
                pagina.html
            );
    } else if (
        loja === "KaBuM"
    ) {
        captura =
            extrairPrecoKabum(
                pagina.html
            );
    }

    if (!captura?.preco) {
        throw new Error(
            `Preço não encontrado no HTML de ${loja}.`
        );
    }

    return {
        ...captura,
        loja,
        titulo:
            extrairTitulo(
                pagina.html
            ),
        finalUrl:
            pagina.finalUrl
    };
}

async function verificarOferta(
    deps,
    produto,
    oferta
) {
    const captura =
        await capturarOferta(
            oferta
        );

    const historico =
        await gravarHistoricoOfertaSeMudou(
            deps,
            produto.id,
            captura.loja,
            oferta.url,
            captura.preco
        );

    await atualizarOfertaNoProduto(
        deps,
        produto,
        oferta,
        captura,
        historico
    );

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
                        produto?.dados
                            ?.precoAlvo
                    )
                )
                    ? Number(
                        produto.dados
                            .precoAlvo
                    )
                    : null
            );

    return {
        productId:
            produto.id,
        productName:
            produto.nome ||
            produto?.dados?.produto ||
            produto?.dados?.nome ||
            null,
        loja:
            captura.loja,
        url:
            oferta.url,
        preco:
            Number(
                captura.preco
            ),
        precoAnteriorHistorico:
            historico.previousPrice,
        historyInserted:
            historico.inserted,
        precoAlvo:
            alvo,
        atingiuAlvo:
            alvo !== null
                ? Number(
                    captura.preco
                ) <= alvo
                : false,
        fonte:
            captura.fonte
    };
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

        // Compatibilidade com V1.8.0
        selected: 0,
        supported: 0,
        checked: 0,
        success: 0,
        failed: 0,
        ignoredUnsupported: 0,
        hitsTarget: 0,

        // Métricas V1.8.1
        productsSelected: 0,
        offersFound: 0,
        offersSupported: 0,
        offersChecked: 0,
        offersSuccess: 0,
        offersFailed: 0,
        offersIgnoredUnsupported: 0,
        historyInserted: 0,

        items: []
    };

    try {
        const produtos =
            await selecionarProdutos(
                deps
            );

        resultado.selected =
            produtos.length;

        resultado.productsSelected =
            produtos.length;

        for (
            let p = 0;
            p < produtos.length;
            p++
        ) {
            const produto =
                produtos[p];

            const ofertas =
                ofertasConhecidas(
                    produto
                );

            resultado.offersFound +=
                ofertas.length;

            for (
                let i = 0;
                i < ofertas.length;
                i++
            ) {
                const oferta =
                    ofertas[i];

                if (
                    !lojaSuportadaServidor(
                        oferta.loja,
                        oferta.url
                    )
                ) {
                    resultado
                        .offersIgnoredUnsupported++;

                    resultado
                        .ignoredUnsupported++;

                    continue;
                }

                resultado
                    .offersSupported++;

                resultado.supported++;

                resultado
                    .offersChecked++;

                resultado.checked++;

                try {
                    const item =
                        await verificarOferta(
                            deps,
                            produto,
                            oferta
                        );

                    resultado
                        .offersSuccess++;

                    resultado.success++;

                    if (
                        item.historyInserted
                    ) {
                        resultado
                            .historyInserted++;
                    }

                    if (
                        item.atingiuAlvo
                    ) {
                        resultado
                            .hitsTarget++;
                    }

                    resultado.items.push({
                        ok: true,
                        type:
                            "comparison-offer",
                        ...item
                    });
                } catch (erro) {
                    resultado
                        .offersFailed++;

                    resultado.failed++;

                    try {
                        await registrarFalhaOferta(
                            deps,
                            produto,
                            oferta,
                            erro
                        );
                    } catch (
                        erroGravacao
                    ) {
                        console.error(
                            "[VIGIA] Falha ao registrar erro da oferta:",
                            erroGravacao
                        );
                    }

                    resultado.items.push({
                        ok: false,
                        type:
                            "comparison-offer",
                        productId:
                            produto.id,
                        productName:
                            produto.nome ||
                            produto?.dados?.produto ||
                            null,
                        loja:
                            normalizarLoja(
                                oferta.loja,
                                oferta.url
                            ),
                        url:
                            oferta.url,
                        error:
                            String(
                                erro?.message ||
                                erro
                            )
                    });
                }

                await dormir(
                    ESPERA_ENTRE_REQUISICOES_MS
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
    extrairPrecoMercadoLivre,
    extrairPrecoKabum,
    normalizarLoja,
    ofertasConhecidas
};
