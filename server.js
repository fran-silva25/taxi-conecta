const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./db'); // Conexão com o PostgreSQL do Render
const { enviarAudioParaDrive } = require('./drive'); // Integração com o Google Drive

// Importando as funções e a cerca virtual do bot do WhatsApp
const { iniciarBotWhatsApp, liberarClienteWhatsApp, verificarDentroDaCerca, fronteiraPonto2216 } = require('./bot_whatsapp');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 10 * 1024 * 1024
});

const PASTA_AUDIOS = path.join(__dirname, 'audios_historico');
if (!fs.existsSync(PASTA_AUDIOS)) {
    fs.mkdirSync(PASTA_AUDIOS, { recursive: true });
}

const PASTA_SALVOS_MODERACAO = path.join(__dirname, 'audios_salvos_moderacao');
if (!fs.existsSync(PASTA_SALVOS_MODERACAO)) {
    fs.mkdirSync(PASTA_SALVOS_MODERACAO, { recursive: true });
}

let historicoAudio = [];
let historicoRecusas = [];
let historicoCorridas = [];
let filaGeral = [];
let motoristasConectados = {};
let chamadasPendentes = {};

// Função para garantir automaticamente que as tabelas existem na nuvem
async function garantirTabelasNoBanco() {
    try {
        // 1. APAGA A TABELA DEFEITUOSA COMPLETAMENTE (Cuidado: remova essa linha depois que funcionar)

        // 2. CRIA A TABELA NOVA, LIMPA E PERFEITA DO ZERO
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

        // Garante a tabela de admins
        await db.query(`
            CREATE TABLE IF NOT EXISTS administradores (
                id SERIAL PRIMARY KEY,
                usuario VARCHAR(50) UNIQUE NOT NULL,
                senha_hash VARCHAR(100) NOT NULL,
                nome VARCHAR(100),
                cargo VARCHAR(50)
            );
        `);

        // Insere o carro de teste Carro.99
        await db.query(`
            INSERT INTO motoristas (numero, placa, login, nome, modelo, cargo, senha_hash, eh_moderador, status_radio)
            VALUES ('99', 'ABC1D00', 'Carro.99', 'Admin Teste', 'Fiat Grand Siena', 'Comum', '123', true, 'ONLINE')
            ON CONFLICT (login) DO NOTHING;
        `);

        // Insere o adm padrão
        await db.query(`
            INSERT INTO administradores (usuario, senha_hash, nome, cargo)
            VALUES ('adm', '123', 'Administrador Geral', 'ADM')
            ON CONFLICT (usuario) DO NOTHING;
        `);

        console.log("✔ Tabela antiga apagada e tabela nova recriada com sucesso do zero!");
    } catch (e) {
        console.error("❌ Erro ao recriar tabelas automáticas:", e);
    }
}

// Executa a verificação ao iniciar
garantirTabelasNoBanco();

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
        console.error("Erro ao carregar administradores do banco:", e);
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

// ROTAS ESTÁTICAS
app.get('/', (req, res) => res.sendFile(__dirname + '/www/index.html'));
app.get('/admin.html', (req, res) => res.sendFile(__dirname + '/www/admin.html'));
app.get('/motorista.html', (req, res) => res.sendFile(__dirname + '/www/motorista.html'));
app.get('/motorista', (req, res) => res.sendFile(__dirname + '/www/motorista.html'));
app.use('/audios', express.static(PASTA_AUDIOS));

io.on('connection', async (socket) => {
    await emitirSistemaGeral(socket);

    socket.on('adminLimparSistemaGeral', async () => {
        filaGeral = [];
        chamadasPendentes = {};
        try {
            await db.query('UPDATE motoristas SET bloqueio_recusa = false');
        } catch (e) {}

        for (let idTaxi in motoristasConectados) {
            motoristasConectados[idTaxi].status = "LIVRE";
        }
        await emitirSistemaGeral(io);
        io.emit('forcarStatusLivreGeral');
    });

    socket.on('loginAdm', async (dados) => {
        const usuarioKey = dados.usuario.trim().toLowerCase();
        try {
            const usuariosAdmCadastrados = await carregarUsuariosAdmDoBanco();
            const userObj = usuariosAdmCadastrados[usuarioKey];

            if (!userObj) {
                socket.emit('loginErro', { mensagem: "Usuário administrativo ou fiscal não encontrado." });
                return;
            }
            if (userObj.senha !== dados.senha) {
                socket.emit('loginErro', { mensagem: "Senha incorreta." });
                return;
            }
            socket.emit('loginAdmSucesso', { usuario: userObj, historicoAudio: historicoAudio });

            if (checarAniversarioApp()) {
                socket.emit('aniversarioApp', { mensagem: "🎉 Parabéns! O Táxi Conecta completa mais um ano de vida hoje! (Início em 03/10/2026) 🚖" });
            }
        } catch (err) {
            console.error("Erro no login ADM:", err);
            socket.emit('loginErro', { mensagem: "Erro interno no servidor." });
        }
    });

    socket.on('cadastrarCarro', async (dados) => {
        const loginGerado = `Carro.${dados.numero}`;
        try {
            await db.query(
                `INSERT INTO motoristas (numero, placa, login, nome, modelo, cargo, telefones, senha_hash, eh_moderador, status_radio) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 ON CONFLICT (login) DO UPDATE SET nome = $4, placa = $2, modelo = $5, cargo = $6, telefones = $7, senha_hash = $8, eh_moderador = $9`,
                [dados.numero, (dados.placa || '').trim().toUpperCase(), loginGerado, dados.nome, dados.modelo, dados.cargo || "Comum", dados.telefones, dados.senha, Boolean(dados.ehModerador), "ONLINE"]
            );
            await emitirSistemaGeral(io);
            socket.emit('cadastroSucesso', { login: loginGerado });
        } catch (e) {
            console.error("Erro ao cadastrar carro:", e);
        }
    });

    socket.on('atualizarCarro', async (dados) => {
        const login = dados.login;
        try {
            await db.query(
                `UPDATE motoristas SET placa = $1, nome = $2, modelo = $3, telefones = $4, eh_moderador = $5 WHERE login = $6`,
                [(dados.placa || '').trim().toUpperCase(), dados.nome, dados.modelo, dados.telefones, Boolean(dados.ehModerador), login]
            );
            await emitirSistemaGeral(io);
            socket.emit('edicaoSucesso', { login: login });
        } catch (e) {
            console.error("Erro ao atualizar carro:", e);
        }
    });

    socket.on('excluirCarro', async (dados) => {
        try {
            await db.query('DELETE FROM motoristas WHERE login = $1', [dados.login]);
            const indexFila = filaGeral.findIndex(m => `Carro.${m.idTaxi}` === dados.login || String(m.idTaxi) === String(dados.login.replace('Carro.', '')));
            if (indexFila !== -1) {
                filaGeral.splice(indexFila, 1);
                redistribuirVagas();
            }
            await emitirSistemaGeral(io);
            socket.emit('excluirSucesso', { login: dados.login });
        } catch (e) {
            console.error("Erro ao excluir carro:", e);
        }
    });

    socket.on('resetarSenhaCarro', async (dados) => {
        try {
            await db.query('UPDATE motoristas SET senha_hash = $1 WHERE login = $2', [dados.novaSenha, dados.login]);
            socket.emit('senhaResetadaSucesso', { login: dados.login });
        } catch (e) {
            console.error("Erro ao resetar senha:", e);
        }
    });

    socket.on('loginMotorista', async (dados) => {
        const idStr = String(dados.login).replace('Carro.', '');
        const loginBusca = `Carro.${idStr}`;

        try {
            const frotaCadastrada = await carregarFrotaDoBanco();
            const carro = frotaCadastrada[loginBusca] || frotaCadastrada[dados.login];

            if (!carro) {
                socket.emit('loginErro', { mensagem: "Login (número do carro) não cadastrado." });
                return;
            }
            if (String(carro.senha) !== String(dados.senha)) {
                socket.emit('loginErro', { mensagem: "Senha incorreta." });
                return;
            }

            motoristasConectados[idStr] = { idTaxi: idStr, nome: carro.nome, status: "LIVRE", socketId: socket.id };
            socket.emit('loginSucesso', { carro: carro, historicoAudio: historicoAudio });
            await emitirSistemaGeral(io);

            if (checarAniversarioApp()) {
                socket.emit('aniversarioApp', { mensagem: "🎉 Parabéns! O Táxi Conecta completa mais um ano de vida hoje! (Início em 03/10/2026) 🚖" });
            }
        } catch (err) {
            console.error("Erro no login do motorista:", err);
            socket.emit('loginErro', { mensagem: "Erro interno no servidor." });
        }
    });

    socket.on('moderarBloqueioFila', async (dados) => {
        const targetLogin = `Carro.${dados.alvoId}`;
        const tempoMs = dados.minutos ? dados.minutos * 60 * 1000 : 0;
        const banidoAteTime = tempoMs > 0 ? (Date.now() + tempoMs) : (Date.now() + 24*60*60*1000);

        try {
            await db.query('UPDATE motoristas SET banido_ate = $1 WHERE login = $2', [banidoAteTime, targetLogin]);
            const idx = filaGeral.findIndex(m => String(m.idTaxi) === String(dados.alvoId));
            if (idx !== -1) {
                filaGeral.splice(idx, 1);
                redistribuirVagas();
            }
            await emitirSistemaGeral(io);
        } catch (e) {}
    });

    socket.on('moderarBloqueioFala', async (dados) => {
        const targetLogin = `Carro.${dados.alvoId}`;
        const tempoMs = dados.minutos ? dados.minutos * 60 * 1000 : 0;
        const mutadoAteTime = tempoMs > 0 ? (Date.now() + tempoMs) : (Date.now() + 24*60*60*1000);

        try {
            await db.query('UPDATE motoristas SET mutado_ate = $1 WHERE login = $2', [mutadoAteTime, targetLogin]);
            await emitirSistemaGeral(io);
        } catch (e) {}
    });

    socket.on('salvarAudioCofre', (dados) => {
        if (!dados.audioUrl) return;
        const nomeArquivo = dados.audioUrl.split('/').pop(); 
        const arquivoOrigem = path.join(PASTA_AUDIOS, nomeArquivo);
        const arquivoDestino = path.join(PASTA_SALVOS_MODERACAO, nomeArquivo);
        try {
            if (fs.existsSync(arquivoOrigem)) {
                fs.copyFileSync(arquivoOrigem, arquivoDestino);
            }
        } catch(e) {}
    });

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
            fs.writeFile(caminhoCompleto, Buffer.from(dados.audioBuffer), async (err) => {
                if (!err) {
                    const resultadoDrive = await enviarAudioParaDrive(caminhoCompleto, nomeArquivo);
                    const relUrl = resultadoDrive ? resultadoDrive.audioUrl : `/audios/${nomeArquivo}`;

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
                    console.error("Erro ao salvar arquivo de áudio PTT:", err);
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

    socket.on('editarAdmin', async (dados) => {
        const key = (dados.usuario || '').trim().toLowerCase();
        try {
            await db.query('UPDATE administradores SET nome = $1, cargo = $2 WHERE usuario = $3', [dados.nome.trim(), dados.cargo || 'FISCAL', key]);
            await emitirSistemaGeral(io);
        } catch (e) {}
    });

    socket.on('resetarSenhaAdmin', async (dados) => {
        const key = (dados.usuario || dados.idAdmin || '').trim().toLowerCase();
        try {
            await db.query('UPDATE administradores SET senha_hash = $1 WHERE usuario = $2', [dados.novaSenha.trim(), key]);
        } catch (e) {}
    });

    socket.on('excluirAdm', async (dados) => {
        const key = (dados.usuario || '').trim().toLowerCase();
        try {
            await db.query('DELETE FROM administradores WHERE usuario = $1', [key]);
            await emitirSistemaGeral(io);
        } catch (e) {}
    });

    socket.on('limparHistoricoRecusas', () => {
        historicoRecusas = [];
        emitirSistemaGeral(io);
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

    socket.on('statusAusente', async (dados) => {
        const idTaxiStr = String(dados.idTaxi);
        const indexFila = filaGeral.findIndex(m => String(m.idTaxi) === idTaxiStr);
        if (indexFila !== -1) {
            filaGeral.splice(indexFila, 1);
            redistribuirVagas();
        }
        if (motoristasConectados[idTaxiStr]) motoristasConectados[idTaxiStr].status = "AUSENTE";
        await emitirSistemaGeral(io);
    });

    socket.on('alterarModoOperacao', async (novoModo) => {
        if (novoModo === 'AUTOMATICO') {
            modoManualOverridden = false;
            redistribuirVagas();
        } else if (["SO_PH", "MANHA_SHOPPING", "SHOPPING_COMPLETO", "BAIXA_FROTA"].includes(novoModo)) {
            modoOperacao = novoModo;
            modoManualOverridden = true;
            redistribuirVagas();
        }
        await emitirSistemaGeral(io);
    });

    socket.on('chamarCorrida', async () => {
        if (filaGeral.length === 0) return;
        const motorista = filaGeral[0];
        filaGeral.shift();
        redistribuirVagas();

        const chamadoFinal = { idTaxi: motorista.idTaxi, nome: motorista.nome, origem: 'Fila Geral (Painel Fiscal)' };
        if (motoristasConectados[motorista.idTaxi]) {
            motoristasConectados[motorista.idTaxi].status = "OCUPADO";
            io.to(motoristasConectados[motorista.idTaxi].socketId).emit('forcarStatusOcupado');
        }

        await emitirSistemaGeral(io);
        io.emit('corridaAtribuida', chamadoFinal);
    });

    socket.on('aceitarCorridaMotorista', (dadosAceite) => {
        confirmarEBaixarCorrida(dadosAceite.idChamada);
    });

    socket.on('recusarCorridaMotorista', async (dadosRecusa) => {
        const chamada = chamadasPendentes[dadosRecusa.idChamada];
        if (!chamada || filaGeral.length === 0) return;

        const motoristaRecusou = filaGeral[chamada.indiceTentativaAtual] || filaGeral[0];
        const idTaxiRecusou = motoristaRecusou.idTaxi;
        const loginRecusa = `Carro.${idTaxiRecusou}`;

        const indexFila = filaGeral.findIndex(m => m.idTaxi === idTaxiRecusou);
        if (indexFila !== -1) {
            filaGeral.splice(indexFila, 1);
            redistribuirVagas();
        }

        try {
            await db.query('UPDATE motoristas SET bloqueio_recusa = true WHERE login = $1', [loginRecusa]);
        } catch (e) {}

        if (motoristasConectados[idTaxiRecusou] && motoristasConectados[idTaxiRecusou].socketId) {
            io.to(motoristasConectados[idTaxiRecusou].socketId).emit('avisoRecusaBloqueio', { idTaxi: idTaxiRecusou });
        }

        historicoRecusas.unshift({
            id: Date.now(), timestamp: Date.now(), idTaxi: idTaxiRecusou,
            nomeMotorista: motoristaRecusou.nome, origemChamado: chamada.origem || "WhatsApp",
            cliente: chamada.nomeCliente, dataHora: new Date().toLocaleString('pt-BR')
        });

        chamada.indiceTentativaAtual = 0; 
        
        await emitirSistemaGeral(io);
        dispararPonteiroFila(dadosRecusa.idChamada);
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

function dispararPonteiroFila(idChamadaFixa) {
    if (filaGeral.length === 0) return;
    const chamada = chamadasPendentes[idChamadaFixa];
    if (!chamada) return;

    if (chamada.indiceTentativaAtual >= filaGeral.length) chamada.indiceTentativaAtual = 0;
    const motorista = filaGeral[chamada.indiceTentativaAtual];
    const idTaxiStr = String(motorista.idTaxi);

    chamada.idTaxi = idTaxiStr;
    chamada.nomeMotorista = motorista.nome;

    const dadosMotorista = motoristasConectados[idTaxiStr];
    if (dadosMotorista && dadosMotorista.socketId) {
        io.to(dadosMotorista.socketId).emit('ofertaCorrida', { idChamada: idChamadaFixa, cliente: chamada.nomeCliente, local: chamada.origem });
    }
}

async function confirmarEBaixarCorrida(idChamada) {
    const chamada = chamadasPendentes[idChamada];
    if (!chamada) return;

    const idTaxiStr = String(chamada.idTaxi);
    const indexAtual = filaGeral.findIndex(m => String(m.idTaxi) === idTaxiStr);
    if (indexAtual !== -1) {
        filaGeral.splice(indexAtual, 1);
        redistribuirVagas();
    }

    const frotaCadastrada = await carregarFrotaDoBanco();
    const veiculoObj = frotaCadastrada[`Carro.${idTaxiStr}`];
    const dadosAtribuicao = {
        idTaxi: idTaxiStr, 
        modelo: veiculoObj ? veiculoObj.modelo : "Veículo",
        placa: veiculoObj ? veiculoObj.placa : "ABC1D00", 
        nome: chamada.nomeMotorista,
        origem: chamada.origem || "WhatsApp", 
        nomeCliente: chamada.nomeCliente,
        lat: chamada.lat || null,
        lon: chamada.lon || null
    };

    if (motoristasConectados[idTaxiStr]) {
        motoristasConectados[idTaxiStr].status = "OCUPADO";
        io.to(motoristasConectados[idTaxiStr].socketId).emit('forcarStatusOcupado');
    }

    historicoCorridas.unshift({
        id: Date.now(), dataHora: new Date().toLocaleString('pt-BR'),
        telefoneCliente: chamada.jidCliente ? chamada.jidCliente.split('@')[0] : "Não informado",
        nomeCliente: chamada.nomeCliente, origem: chamada.origem || "WhatsApp",
        idTaxi: idTaxiStr, nomeMotorista: chamada.nomeMotorista, placa: veiculoObj ? veiculoObj.placa : ""
    });

    if (chamada.jidCliente && chamada.sockWhatsApp) {
        const tempoEstimado = chamada.origem === "G3 do Carrefour" ? "3 minutos" : "8 minutos";
        
        const mensagemFinal = `🚕 *TÁXI CONFIRMADO!*\n\n` +
                            `👤 *Passageiro(a):* ${dadosAtribuicao.nomeCliente}\n` +
                            `👨‍✈️ *Motorista:* ${dadosAtribuicao.nome}\n` +
                            `🚘 *Veículo:* ${dadosAtribuicao.modelo}\n` +
                            `📋 *Placa:* ${dadosAtribuicao.placa}\n\n` +
                            `⏱️ *Previsão de chegada:* aprox. ${tempoEstimado}\n\n` +
                            `⚠️ Aguarde no local *(se for condomínio, aguardar na portaria)*, o seu táxi está a caminho!`;

        chamada.sockWhatsApp.sendMessage(chamada.jidCliente, { text: mensagemFinal }).catch(e => console.error("Erro ao enviar WhatsApp:", e));
    }

    liberarClienteWhatsApp(chamada.jidCliente);

    await emitirSistemaGeral(io);
    io.emit('corridaAtribuida', dadosAtribuicao);
    delete chamadasPendentes[idChamada];
}

function solicitarCorridaViaWhatsApp(dados) {
    if (filaGeral.length === 0) return false; 

    const idChamada = "CORRIDA_WA_" + Date.now();
    chamadasPendentes[idChamada] = { 
        idChamada: idChamada, 
        nomeCliente: dados.nomeCliente, 
        jidCliente: dados.jidCliente, 
        sockWhatsApp: dados.sockWhatsApp, 
        indiceTentativaAtual: 0, 
        origem: dados.origem || "WhatsApp",
        lat: dados.lat || null,
        lon: dados.lon || null
    };
    
    dispararPonteiroFila(idChamada);
    return true;
}

iniciarBotWhatsApp(solicitarCorridaViaWhatsApp);

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => console.log(`🚖 Servidor Taxi Conecta rodando na porta ${PORTA} com banco PostgreSQL e Google Drive integrados!`));