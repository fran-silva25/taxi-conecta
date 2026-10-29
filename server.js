const fs = require('fs');
const path = require('path');
// Apaga a pasta de sessão antiga se existir ao iniciar
try {
    fs.rmSync(path.join(__dirname, 'sessao_whatsapp'), { recursive: true, force: true });
} catch (e) {}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const { iniciarBotWhatsApp, liberarClienteWhatsApp, verificarDentroDaCerca, fronteiraPonto2216 } = require('./bot_whatsapp');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 10 * 1024 * 1024
});

// PASTA LOCAL PARA ÁUDIOS PTT NO RENDER
const PASTA_AUDIOS = path.join(__dirname, 'audios_historico');
if (!fs.existsSync(PASTA_AUDIOS)) {
    fs.mkdirSync(PASTA_AUDIOS, { recursive: true });
}

const PASTA_SALVOS_MODERACAO = path.join(__dirname, 'audios_salvos_moderacao');
if (!fs.existsSync(PASTA_SALVOS_MODERACAO)) {
    fs.mkdirSync(PASTA_SALVOS_MODERACAO, { recursive: true });
}

// ROTINA AUTOMÁTICA: Apaga áudios do servidor com mais de 3 dias (72h)
function limparAudiosAntigosLocais() {
    try {
        const tresDiasEmMs = 3 * 24 * 60 * 60 * 1000;
        const agora = Date.now();
        fs.readdir(PASTA_AUDIOS, (err, files) => {
            if (err) return;
            files.forEach(file => {
                const caminho = path.join(PASTA_AUDIOS, file);
                fs.stat(caminho, (err, stats) => {
                    if (!err && (agora - stats.mtimeMs > tresDiasEmMs)) {
                        fs.unlink(caminho, () => {});
                    }
                });
            });
        });
    } catch (e) {
        console.error("Erro na limpeza local de áudios:", e);
    }
}
setInterval(limparAudiosAntigosLocais, 12 * 60 * 60 * 1000); // Executa a cada 12 horas

let historicoAudio = [];
let historicoRecusas = [];
let historicoCorridas = [];
let filaGeral = [];
let motoristasConectados = {};
let chamadasPendentes = {};

async function garantirTabelasNoBanco() {
    try {
        // 1. APAGA A TABELA COMPLETA E REINICIA A ESTRUTURA
        await db.query(`DROP TABLE IF EXISTS motoristas CASCADE;`);

        // 2. CRIA A TABELA NOVA E LIMPA
        await db.query(`
            CREATE TABLE motoristas (
                id SERIAL PRIMARY KEY,
                numero VARCHAR(50),
                placa VARCHAR(20),
                login VARCHAR(50) UNIQUE NOT NULL,
                nome VARCHAR(100),
                modelo VARCHAR(100),
                cargo VARCHAR(50),
                telefones TEXT[],
                senha_hash VARCHAR(100),
                eh_moderador BOOLEAN DEFAULT FALSE,
                status_radio VARCHAR(20) DEFAULT 'ONLINE',
                mutado_ate BIGINT,
                banido_ate BIGINT,
                bloqueio_recusa BOOLEAN DEFAULT FALSE
            );
        `);

        // 3. GARANTE A TABELA DE ADMINISTRADORES
        await db.query(`
            CREATE TABLE IF NOT EXISTS administradores (
                id SERIAL PRIMARY KEY,
                usuario VARCHAR(50) UNIQUE NOT NULL,
                senha_hash VARCHAR(100) NOT NULL,
                nome VARCHAR(100),
                cargo VARCHAR(50)
            );
        `);

        await db.query(`
            INSERT INTO administradores (usuario, senha_hash, nome, cargo)
            VALUES ('adm', '123', 'Administrador Geral', 'ADM')
            ON CONFLICT (usuario) DO NOTHING;
        `);

        console.log("✔ Tabela de motoristas eliminada e recriada do zero no PostgreSQL!");
    } catch (e) {
        console.error("❌ Erro ao recriar tabela no PostgreSQL:", e);
    }
}
function checarAniversarioApp() {
    const hoje = new Date();
    return (hoje.getDate() === 3 && hoje.getMonth() === 9 && hoje.getFullYear() > 2026);
}

async function carregarFrotaDoBanco() {
    try {
        const res = await db.query('SELECT * FROM motoristas');
        const frotaObj = {};
        res.rows.forEach(m => {
            frotaObj[m.login] = {
                numero: m.numero,
                placa: m.placa,
                login: m.login,
                nome: m.nome,
                modelo: m.modelo,
                cargo: m.cargo,
                telefones: m.telefones,
                senha: m.senha_hash,
                ehModerador: m.eh_moderador,
                statusRadio: m.status_radio,
                mutadoAte: m.mutado_ate,
                banidoAte: m.banido_ate,
                bloqueioRecusa: m.bloqueio_recusa
            };
        });
        return frotaObj;
    } catch (e) {
        console.error("Erro ao carregar frota do banco:", e);
        return {};
    }
}

async function carregarUsuariosAdmDoBanco() {
    try {
        const res = await db.query('SELECT * FROM administradores');
        const admObj = {};
        res.rows.forEach(a => {
            admObj[a.usuario.toLowerCase().trim()] = {
                usuario: a.usuario,
                senha: a.senha_hash,
                cargo: a.cargo,
                nome: a.nome
            };
        });
        return admObj;
    } catch (e) {
        return {
            "adm": { usuario: "adm", senha: "123", cargo: "ADM", nome: "Administrador Geral" },
            "fiscal": { usuario: "fiscal", senha: "123", cargo: "FISCAL", nome: "Fiscal de Ponto" }
        };
    }
}

const PONTOS_FISICOS = {
    PH: { nome: "Ponto PH (Subida Arnaldo Rosa / Abel Ferreira)", capacidade: 15, latitude: -23.580278, longitude: -46.561389, raioMetros: 40 },
    PA2: { nome: "PA2 (Subida Fila Indiana)", capacidade: 5, latitude: -23.562111, longitude: -46.560305, raioMetros: 20 },
    PA4: { nome: "PA4 (Ponto Final / Bolsão Lado a Lado)", capacidade: 3, latitude: -23.561417, longitude: -46.561639, raioMetros: 12 }
};

let modoOperacao = "MANHA_SHOPPING";
let modoManualOverridden = false;

async function emitirSistemaGeral(ioInstance) {
    const frotaCadastrada = await carregarFrotaDoBanco();
    const usuariosAdmCadastrados = await carregarUsuariosAdmDoBanco();

    const listaConectadosArray = Object.values(motoristasConectados).map(m => ({
        idTaxi: m.idTaxi,
        nome: m.nome,
        status: m.status
    }));

    ioInstance.emit('atualizarSistema', { 
        fila: filaGeral, 
        modo: modoOperacao, 
        frota: frotaCadastrada, 
        usuariosAdm: usuariosAdmCadastrados, 
        historico: historicoAudio, 
        recusas: historicoRecusas, 
        corridas: historicoCorridas,
        conectados: listaConectadosArray
    });
}

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function determinarModoAutomatico() {
    const hora = new Date().getHours();
    if (hora >= 5 && hora < 8) return "SO_PH";
    if (hora >= 8 && hora < 10) return "MANHA_SHOPPING";
    if (hora >= 10 && hora < 22) return "SHOPPING_COMPLETO";
    return "BAIXA_FROTA";
}

function redistribuirVagas() {
    if (!modoManualOverridden) {
        const modoCalculado = determinarModoAutomatico();
        if (modoOperacao !== modoCalculado) {
            modoOperacao = modoCalculado;
        }
    }

    if (filaGeral.length === 0) return;

    const totalCarros = filaGeral.length;
    filaGeral.forEach(c => c.setor = 'Aguardando Vaga');

    if (modoOperacao === "SO_PH") {
        filaGeral.forEach((carro, idx) => {
            carro.setor = (idx < PONTOS_FISICOS.PH.capacidade) ? 'PH' : 'Aguardando PH';
        });
        return;
    }

    if (modoOperacao === "MANHA_SHOPPING") {
        filaGeral.forEach((carro, idx) => {
            if (idx === 0) {
                carro.setor = 'PA4';
            } else if (idx === 1) {
                carro.setor = 'PA2';
            } else if (idx - 2 < PONTOS_FISICOS.PH.capacidade) {
                carro.setor = 'PH';
            } else {
                carro.setor = 'Aguardando PH';
            }
        });
        return;
    }

    let indiceAtribuicao = 0;
    const vagasPA4 = Math.min(PONTOS_FISICOS.PA4.capacidade, totalCarros - indiceAtribuicao);
    for (let i = 0; i < vagasPA4; i++) { 
        filaGeral[indiceAtribuicao].setor = 'PA4'; 
        indiceAtribuicao++; 
    }

    const mesAtual = new Date().getMonth() + 1;
    const mesDezembro = (mesAtual === 12);
    const phAberto = filaGeral.some(c => c.pontoFisicoReal === 'PH');
    const limitePA2 = (mesDezembro && !phAberto) ? 10 : PONTOS_FISICOS.PA2.capacidade;

    const vagasPA2 = Math.min(limitePA2, totalCarros - indiceAtribuicao);
    for (let i = 0; i < vagasPA2; i++) { 
        filaGeral[indiceAtribuicao].setor = 'PA2'; 
        indiceAtribuicao++; 
    }

    const vagasPH = Math.min(PONTOS_FISICOS.PH.capacidade, totalCarros - indiceAtribuicao);
    for (let i = 0; i < vagasPH; i++) { 
        filaGeral[indiceAtribuicao].setor = 'PH'; 
        indiceAtribuicao++; 
    }

    for (let i = indiceAtribuicao; i < totalCarros; i++) {
        filaGeral[i].setor = 'Aguardando PH';
    }
}

setInterval(() => {
    redistribuirVagas();
    emitirSistemaGeral(io);
}, 30 * 1000);

app.get('/', (req, res) => res.sendFile(__dirname + '/www/index.html'));
app.get('/admin.html', (req, res) => res.sendFile(__dirname + '/www/admin.html'));
app.get('/motorista.html', (req, res) => res.sendFile(__dirname + '/www/motorista.html'));
app.get('/motorista', (req, res) => res.sendFile(__dirname + '/www/motorista.html'));
app.use('/audios', express.static(PASTA_AUDIOS));

io.on('connection', async (socket) => {
    await emitirSistemaGeral(socket);

    socket.on('adminLimparSistemaGeral', async () => {
        try {
            // 1. APAGA TODOS OS MOTORISTAS DO POSTGRESQL
            await db.query('DELETE FROM motoristas;');
            
            // 2. RESETA A MEMÓRIA RAM DO SERVIDOR
            filaGeral = [];
            chamadasPendentes = {};
            motoristasConectados = {};
            
            console.log("🧹 BANCO DE DADOS E MEMÓRIA ZERADOS VIA ADMIN!");
            
            await emitirSistemaGeral(io);
            io.emit('forcarStatusLivreGeral');
        } catch (e) {
            console.error("❌ Erro ao limpar banco via admin:", e);
        }
    });

    socket.on('loginAdm', async (dados) => {
        const usuarioKey = dados.usuario.trim().toLowerCase();
        try {
            const usuariosAdmCadastrados = await carregarUsuariosAdmDoBanco();
            const userObj = usuariosAdmCadastrados[usuarioKey];

            if (!userObj) {
                socket.emit('loginErro', { mensagem: "Usuário administrativo não encontrado." });
                return;
            }
            if (String(userObj.senha).trim() !== String(dados.senha).trim()) {
                socket.emit('loginErro', { mensagem: "Senha incorreta." });
                return;
            }
            socket.emit('loginAdmSucesso', { usuario: userObj, historicoAudio: historicoAudio });

            if (checarAniversarioApp()) {
                socket.emit('aniversarioApp', { mensagem: "🎉 Parabéns! O Táxi Conecta completa mais um ano de vida hoje!" });
            }
        } catch (err) {
            socket.emit('loginErro', { mensagem: "Erro interno no servidor." });
        }
    });

    // GERENCIAMENTO DE FROTA (CORRIGIDO PARA SALVAR SENHA E ACEITAR AMBOS EVENTOS)
    socket.on('salvarCarroFrota', async (dados) => {
        const numeroCarro = String(dados.idAntigo || dados.numero || '').trim();
        const loginGerado = `Carro.${numeroCarro}`;
        const senhaLimpa = String(dados.senha || '123').trim();
        const telefonesArray = dados.telefone ? [String(dados.telefone).trim()] : [];

        try {
            if (dados.idAntigo) {
                await db.query(
                    `UPDATE motoristas SET placa = $1, nome = $2, modelo = $3, telefones = $4, eh_moderador = $5, senha_hash = $6 WHERE login = $7`,
                    [(dados.placa || '').trim().toUpperCase(), dados.nome, dados.modelo || 'Padrão', telefonesArray, Boolean(dados.ehModerador), senhaLimpa, loginGerado]
                );
            } else {
                await db.query(
                    `INSERT INTO motoristas (numero, placa, login, nome, modelo, cargo, telefones, senha_hash, eh_moderador, status_radio) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                     ON CONFLICT (login) DO UPDATE SET nome = $4, placa = $2, modelo = $5, telefones = $7, senha_hash = $8, eh_moderador = $9`,
                    [numeroCarro, (dados.placa || '').trim().toUpperCase(), loginGerado, dados.nome, dados.modelo || 'Padrão', "Comum", telefonesArray, senhaLimpa, Boolean(dados.ehModerador), "ONLINE"]
                );
            }
            await emitirSistemaGeral(io);
        } catch (e) {
            console.error("❌ Erro ao salvar frota:", e);
        }
    });

    socket.on('excluirFrota', async (dados) => {
        const loginBusca = `Carro.${dados.id || dados.login?.replace('Carro.', '')}`;
        try {
            await db.query('DELETE FROM motoristas WHERE login = $1', [loginBusca]);
            const indexFila = filaGeral.findIndex(m => String(m.idTaxi) === String(dados.id));
            if (indexFila !== -1) {
                filaGeral.splice(indexFila, 1);
                redistribuirVagas();
            }
            await emitirSistemaGeral(io);
        } catch (e) {}
    });

    socket.on('resetarSenhaFrota', async (dados) => {
        const loginBusca = `Carro.${dados.id || dados.login?.replace('Carro.', '')}`;
        const novaSenha = String(dados.novaSenha || '123').trim();
        try {
            await db.query('UPDATE motoristas SET senha_hash = $1 WHERE login = $2', [novaSenha, loginBusca]);
            await emitirSistemaGeral(io);
        } catch (e) {}
    });

    // LOGIN DO MOTORISTA CORRIGIDO
    // LOGIN DO MOTORISTA ULTRA-FLEXÍVEL E COM LOGS DE DIAGNÓSTICO
    socket.on('loginMotorista', async (dados) => {
        const loginEntrada = String(dados.login || '').trim();
        const senhaDigitada = String(dados.senha || '').trim();
        const numeroLimpo = loginEntrada.replace(/[^0-9]/g, '');

        console.log(`🔑 Tentativa de login -> Recebido: "${loginEntrada}" | Núm: "${numeroLimpo}" | Senha: "${senhaDigitada}"`);

        try {
            const queryRes = await db.query(
                `SELECT * FROM motoristas 
                 WHERE LOWER(login) = LOWER($1) 
                    OR numero = $2 
                    OR login = $2 
                 LIMIT 1`,
                [`Carro.${numeroLimpo}`, numeroLimpo]
            );

            if (queryRes.rows.length === 0) {
                console.log(`❌ Login falhou: Carro.${numeroLimpo} não encontrado.`);
                socket.emit('loginErro', { mensagem: `Veículo Carro.${numeroLimpo || loginEntrada} não cadastrado.` });
                return;
            }

            const carroBanco = queryRes.rows[0];
            const senhaBanco = String(carroBanco.senha_hash || '').trim();

            if (senhaBanco !== senhaDigitada) {
                console.log(`❌ Senha incorreta para o ${carroBanco.login}.`);
                socket.emit('loginErro', { mensagem: "Senha incorreta. Verifique no painel Admin." });
                return;
            }

            const idStr = String(carroBanco.numero || numeroLimpo);
            const objetoMotorista = {
                idTaxi: idStr,
                numero: idStr,
                placa: carroBanco.placa,
                login: carroBanco.login,
                nome: carroBanco.nome,
                modelo: carroBanco.modelo,
                cargo: carroBanco.cargo,
                ehModerador: carroBanco.eh_moderador
            };

            motoristasConectados[idStr] = { 
                idTaxi: idStr, 
                nome: carroBanco.nome, 
                status: "LIVRE", 
                socketId: socket.id 
            };

            console.log(`✔ LOGIN AUTORIZADO: ${carroBanco.login} (${carroBanco.nome})`);
            
            socket.emit('loginSucesso', { carro: objetoMotorista, idTaxi: idStr, historicoAudio: historicoAudio });
            await emitirSistemaGeral(io);

        } catch (err) {
            console.error("❌ Erro ao validar login:", err);
            socket.emit('loginErro', { mensagem: "Erro no servidor ao validar o acesso." });
        }
    });

    // PTT SALVANDO DIRETO NO SERVIDOR DO RENDER (SEM DRIVE)
    socket.on('solicitarCanalPTT', (dados) => {
        socket.broadcast.emit('canalOcupado', { idTaxi: dados.idTaxi, nome: dados.nome });
    });

    socket.on('liberarCanalPTT', () => {
        io.emit('canalLivre');
    });

    socket.on('transmitirAudioPTT', async (dados) => {
        let idIdentificacao = dados.idTaxi;
        let nomeMotorista = "Fiscal / Central";
        let modeloCarro = "Painel ADM";
        let cargoPerfil = "FISCAL";
        let ehModeradorPerfil = true;

        const frotaCadastrada = await carregarFrotaDoBanco();

        if (dados.idTaxi && dados.idTaxi !== 'ADM' && dados.idTaxi !== 'Fiscal') {
            const login = `Carro.${dados.idTaxi}`;
            const carro = frotaCadastrada[login];
            if (!carro) return;

            if (carro.mutadoAte && Date.now() < carro.mutadoAte) {
                socket.emit('loginErro', { mensagem: "Sua fala está temporariamente silenciada pela moderação." });
                return;
            }
            nomeMotorista = carro.nome;
            modeloCarro = carro.modelo;
            cargoPerfil = carro.cargo;
            ehModeradorPerfil = Boolean(carro.ehModerador);
        }

        const nomeArquivo = `audio_${idIdentificacao}_${Date.now()}.webm`;
        const caminhoCompleto = path.join(PASTA_AUDIOS, nomeArquivo);

        if (dados.audioBuffer) {
            fs.writeFile(caminhoCompleto, Buffer.from(dados.audioBuffer), (err) => {
                if (!err) {
                    const relUrl = `/audios/${nomeArquivo}`;

                    const registroHistorico = {
                        id: Date.now(), 
                        timestamp: Date.now(), 
                        idTaxi: String(idIdentificacao),
                        nomeMotorista: nomeMotorista, 
                        modelo: modeloCarro, 
                        cargo: cargoPerfil,
                        ehModerador: ehModeradorPerfil, 
                        arquivo: nomeArquivo,
                        audioUrl: relUrl, 
                        duracao: dados.duracao || "0s",
                        dataHora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    };

                    historicoAudio.unshift(registroHistorico);
                    if (historicoAudio.length > 500) historicoAudio.pop();

                    io.emit('receberAudioPTT', {
                        idTaxi: String(idIdentificacao), 
                        nomeMotorista: nomeMotorista, 
                        cargo: cargoPerfil,
                        ehModerador: ehModeradorPerfil, 
                        audioUrl: relUrl,
                        duracao: dados.duracao || "0s",
                        historico: historicoAudio
                    });
                } else {
                    console.error("Erro ao salvar áudio local no Render:", err);
                }
            });
        }
    });

    socket.on('cadastrarAdm', async (dados) => {
        const key = (dados.usuario || '').trim().toLowerCase();
        if (!key || !dados.senha || !dados.nome) { return; }
        try {
            await db.query(
                `INSERT INTO administradores (usuario, senha_hash, nome, cargo) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (usuario) DO UPDATE SET senha_hash = $2, nome = $3, cargo = $4`,
                [key, dados.senha.trim(), dados.nome.trim(), dados.cargo || 'FISCAL']
            );
            await emitirSistemaGeral(io);
        } catch (e) {}
    });

    socket.on('limparHistoricoPTT', () => {
        try {
            if (fs.existsSync(PASTA_AUDIOS)) {
                fs.readdirSync(PASTA_AUDIOS).forEach(file => fs.unlinkSync(path.join(PASTA_AUDIOS, file)));
            }
        } catch (e) {}
        historicoAudio = [];
        emitirSistemaGeral(io);
        io.emit('receberAudioPTT', { historico: [] });
    });

    socket.on('limparHistoricoRecusas', () => {
        historicoRecusas = [];
        emitirSistemaGeral(io);
    });

    socket.on('limparHistoricoCorridas', () => {
        historicoCorridas = [];
        emitirSistemaGeral(io);
    });

    socket.on('atualizarGPS', async (dados) => {
        const idTaxiStr = String(dados.idTaxi);
        const login = `Carro.${idTaxiStr}`;
        const frotaCadastrada = await carregarFrotaDoBanco();
        const veiculo = frotaCadastrada[login];

        if (veiculo && veiculo.banidoAte && Date.now() < veiculo.banidoAte) return;

        if (veiculo && veiculo.bloqueioRecusa) {
            if (dados.simulacao === true) {
                try {
                    await db.query('UPDATE motoristas SET bloqueio_recusa = false WHERE login = $1', [login]);
                } catch (e) {}
            }
        }

        const bloqueadoPorRecusa = veiculo && veiculo.bloqueioRecusa;

        if (dados.status === "AUSENTE") {
            if (motoristasConectados[idTaxiStr]) motoristasConectados[idTaxiStr].status = "AUSENTE";
            await emitirSistemaGeral(io);
            return; 
        }

        motoristasConectados[idTaxiStr] = { idTaxi: idTaxiStr, nome: dados.nome, latitude: dados.latitude, longitude: dados.longitude, status: dados.status, socketId: socket.id };

        const indexFila = filaGeral.findIndex(m => String(m.idTaxi) === idTaxiStr);

        if (dados.status === "OCUPADO" || dados.status === "EM CORRIDA") {
            if (indexFila !== -1) {
                filaGeral.splice(indexFila, 1);
                redistribuirVagas();
                await emitirSistemaGeral(io);
            }
            return;
        }

        const distPH = calcularDistanciaMetros(dados.latitude, dados.longitude, PONTOS_FISICOS.PH.latitude, PONTOS_FISICOS.PH.longitude);
        const distPA2 = calcularDistanciaMetros(dados.latitude, dados.longitude, PONTOS_FISICOS.PA2.latitude, PONTOS_FISICOS.PA2.longitude);
        const distPA4 = calcularDistanciaMetros(dados.latitude, dados.longitude, PONTOS_FISICOS.PA4.latitude, PONTOS_FISICOS.PA4.longitude);

        let estaNoPonto = (distPH <= PONTOS_FISICOS.PH.raioMetros) || (distPA2 <= PONTOS_FISICOS.PA2.raioMetros) || (distPA4 <= PONTOS_FISICOS.PA4.raioMetros);

        const simulacaoForcada = dados.simulacao === true || (dados.latitude === PONTOS_FISICOS.PH.latitude && dados.longitude === PONTOS_FISICOS.PH.longitude);
        const naArea = simulacaoForcada || verificarDentroDaCerca([dados.latitude, dados.longitude], fronteiraPonto2216);

        if ((estaNoPonto || simulacaoForcada) && naArea && indexFila === -1 && !bloqueadoPorRecusa) {
            const novoCarroFila = {
                idTaxi: idTaxiStr,
                nome: dados.nome,
                distanciaMetros: simulacaoForcada ? 0 : Math.min(Math.round(distPH), Math.round(distPA2), Math.round(distPA4)),
                pontoFisicoReal: (distPH <= PONTOS_FISICOS.PH.raioMetros) ? 'PH' : 'OUTRO',
                dataEntrada: new Date()
            };

            filaGeral.push(novoCarroFila);
            redistribuirVagas();
            await emitirSistemaGeral(io);
        }
    });

    socket.on('disconnect', async () => {
        for (const idTaxi in motoristasConectados) {
            if (motoristasConectados[idTaxi].socketId === socket.id) {
                delete motoristasConectados[idTaxi];
                break;
            }
        }
        await emitirSistemaGeral(io);
    });
});

iniciarBotWhatsApp((dados) => {
    if (filaGeral.length === 0) return false;
    const idChamada = "CORRIDA_WA_" + Date.now();
    chamadasPendentes[idChamada] = { idChamada, nomeCliente: dados.nomeCliente, jidCliente: dados.jidCliente, sockWhatsApp: dados.sockWhatsApp, indiceTentativaAtual: 0, origem: dados.origem || "WhatsApp" };
    return true;
});

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => console.log(`🚖 Servidor Taxi Conecta pronto na porta ${PORTA}!`));