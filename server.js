// ======================================================
// VIGIA BACKEND
// V1.7.0
// Desenvolvedor: Felipe Skendel
//
// Backend inicial do VIGIA.
// - persiste produtos
// - persiste histórico de preços
// - recebe comparações / vendedor / pagamento
// - zero dependências externas
//
// Execução:
// node server.js
// ======================================================

const http =
    require("http");

const fs =
    require("fs");

const path =
    require("path");

const crypto =
    require("crypto");


const PORT =
    Number(
        process.env.PORT ||
        8787
    );


const HOST =
    process.env.HOST ||
    "0.0.0.0";


const DATA_DIR =
    path.join(
        __dirname,
        "data"
    );


const DB_FILE =
    path.join(
        DATA_DIR,
        "db.json"
    );


function agora() {

    return new Date()
        .toISOString();
}


function garantirBanco() {

    fs.mkdirSync(
        DATA_DIR,
        {
            recursive: true
        }
    );


    if (
        !fs.existsSync(
            DB_FILE
        )
    ) {

        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(
                {
                    version:
                        "1.7.0",

                    createdAt:
                        agora(),

                    updatedAt:
                        agora(),

                    products:
                        {}
                },
                null,
                2
            ),
            "utf8"
        );
    }
}


function lerBanco() {

    garantirBanco();


    try {

        return JSON.parse(
            fs.readFileSync(
                DB_FILE,
                "utf8"
            )
        );

    } catch {

        return {
            version:
                "1.7.0",

            createdAt:
                agora(),

            updatedAt:
                agora(),

            products:
                {}
        };
    }
}


function salvarBanco(db) {

    db.updatedAt =
        agora();


    const temp =
        DB_FILE +
        ".tmp";


    fs.writeFileSync(
        temp,
        JSON.stringify(
            db,
            null,
            2
        ),
        "utf8"
    );


    fs.renameSync(
        temp,
        DB_FILE
    );
}


function chaveProduto(url) {

    return crypto
        .createHash(
            "sha256"
        )
        .update(
            String(
                url ||
                ""
            )
        )
        .digest(
            "hex"
        )
        .substring(
            0,
            24
        );
}


function json(
    res,
    status,
    payload
) {

    const body =
        JSON.stringify(
            payload
        );


    res.writeHead(
        status,
        {
            "Content-Type":
                "application/json; charset=utf-8",

            "Access-Control-Allow-Origin":
                "*",

            "Access-Control-Allow-Headers":
                "Content-Type",

            "Access-Control-Allow-Methods":
                "GET,POST,OPTIONS",

            "Cache-Control":
                "no-store"
        }
    );


    res.end(
        body
    );
}


function receberBody(req) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            let body =
                "";


            req.on(
                "data",
                chunk => {

                    body +=
                        chunk;


                    if (
                        body.length >
                        2_000_000
                    ) {

                        reject(
                            new Error(
                                "Payload muito grande."
                            )
                        );


                        req.destroy();
                    }
                }
            );


            req.on(
                "end",
                () => {

                    try {

                        resolve(
                            body
                                ? JSON.parse(
                                    body
                                )
                                : {}
                        );

                    } catch {

                        reject(
                            new Error(
                                "JSON inválido."
                            )
                        );
                    }
                }
            );


            req.on(
                "error",
                reject
            );
        }
    );
}


function normalizarHistorico(
    produto
) {

    const historico =
        Array.isArray(
            produto?.historico
        )
            ? produto.historico
            : [];


    return historico
        .map(
            item => ({
                preco:
                    Number(
                        item.preco
                    ),

                data:
                    item.data ||
                    agora()
            })
        )
        .filter(
            item =>
                Number.isFinite(
                    item.preco
                ) &&
                item.preco > 0
        )
        .slice(
            -500
        );
}


function mesclarHistorico(
    existente,
    recebido
) {

    const todos =
        [
            ...(
                Array.isArray(
                    existente
                )
                    ? existente
                    : []
            ),
            ...(
                Array.isArray(
                    recebido
                )
                    ? recebido
                    : []
            )
        ];


    const mapa =
        new Map();


    for (
        const item of todos
    ) {

        const preco =
            Number(
                item.preco
            );


        if (
            !Number.isFinite(
                preco
            ) ||
            preco <= 0
        ) {
            continue;
        }


        const data =
            item.data ||
            agora();


        const chave =
            `${data}|${preco.toFixed(2)}`;


        mapa.set(
            chave,
            {
                preco,
                data
            }
        );
    }


    return [
        ...mapa.values()
    ]
        .sort(
            (a, b) =>
                new Date(
                    a.data
                ) -
                new Date(
                    b.data
                )
        )
        .slice(
            -1000
        );
}


const server =
    http.createServer(
        async (
            req,
            res
        ) => {

            if (
                req.method ===
                "OPTIONS"
            ) {

                res.writeHead(
                    204,
                    {
                        "Access-Control-Allow-Origin":
                            "*",

                        "Access-Control-Allow-Headers":
                            "Content-Type",

                        "Access-Control-Allow-Methods":
                            "GET,POST,OPTIONS"
                    }
                );


                res.end();


                return;
            }


            const url =
                new URL(
                    req.url,
                    `http://${req.headers.host || "localhost"}`
                );


            if (
                req.method ===
                    "GET" &&
                url.pathname ===
                    "/api/health"
            ) {

                json(
                    res,
                    200,
                    {
                        ok:
                            true,

                        app:
                            "VIGIA",

                        version:
                            "1.7.0",

                        time:
                            agora()
                    }
                );


                return;
            }


            if (
                req.method ===
                    "GET" &&
                url.pathname ===
                    "/api/products"
            ) {

                const db =
                    lerBanco();


                json(
                    res,
                    200,
                    {
                        ok:
                            true,

                        products:
                            Object.values(
                                db.products ||
                                {}
                            )
                    }
                );


                return;
            }


            if (
                req.method ===
                    "GET" &&
                url.pathname ===
                    "/api/history"
            ) {

                const productUrl =
                    url.searchParams.get(
                        "url"
                    );


                if (!productUrl) {

                    json(
                        res,
                        400,
                        {
                            ok:
                                false,

                            error:
                                "Informe ?url="
                        }
                    );


                    return;
                }


                const db =
                    lerBanco();


                const id =
                    chaveProduto(
                        productUrl
                    );


                const produto =
                    db.products?.[
                        id
                    ];


                json(
                    res,
                    200,
                    {
                        ok:
                            true,

                        found:
                            Boolean(
                                produto
                            ),

                        history:
                            produto?.historico ||
                            []
                    }
                );


                return;
            }


            if (
                req.method ===
                    "POST" &&
                url.pathname ===
                    "/api/products/sync"
            ) {

                try {

                    const payload =
                        await receberBody(
                            req
                        );


                    const produto =
                        payload?.product;


                    if (
                        !produto?.url
                    ) {

                        json(
                            res,
                            400,
                            {
                                ok:
                                    false,

                                error:
                                    "Produto sem URL."
                            }
                        );


                        return;
                    }


                    const db =
                        lerBanco();


                    const id =
                        chaveProduto(
                            produto.url
                        );


                    const anterior =
                        db.products?.[
                            id
                        ] ||
                        {};


                    const historicoRecebido =
                        normalizarHistorico(
                            produto
                        );


                    const historico =
                        mesclarHistorico(
                            anterior.historico,
                            historicoRecebido
                        );


                    db.products =
                        db.products ||
                        {};


                    db.products[
                        id
                    ] = {

                        ...anterior,

                        ...produto,

                        id,

                        appVersion:
                            payload.appVersion ||
                            "1.7.0",

                        backendUpdatedAt:
                            agora(),

                        historico
                    };


                    salvarBanco(
                        db
                    );


                    json(
                        res,
                        200,
                        {
                            ok:
                                true,

                            id,

                            historyCount:
                                historico.length
                        }
                    );


                } catch (
                    erro
                ) {

                    json(
                        res,
                        400,
                        {
                            ok:
                                false,

                            error:
                                String(
                                    erro?.message ||
                                    erro
                                )
                        }
                    );
                }


                return;
            }


            json(
                res,
                404,
                {
                    ok:
                        false,

                    error:
                        "Rota não encontrada."
                }
            );
        }
    );


server.listen(
    PORT,
    HOST,
    () => {

        garantirBanco();


        console.log(
            `VIGIA Backend V1.7.0 ativo em http://${HOST}:${PORT}`
        );
    }
);
