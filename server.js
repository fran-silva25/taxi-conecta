const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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

const ARQUIVO_RECUSAS = path.join(__dirname, 'historico_recusas.json');
const ARQUIVO_FROTA = path.join(__dirname, 'frota_cadastrada.json');
const ARQUIVO_USUARIOS_ADM = path.join(__dirname, 'usuarios_adm.json');
const ARQUIVO_HISTORICO_PTT = path.join(__dirname, 'historico_ptt.json');
const ARQUIVO_CORRIDAS = path.join(__dirname, 'historico_corridas.json');

function checarAniversarioApp() {
    const hoje = new Date();
    return (hoje.getDate() === 3 && hoje.getMonth() === 9 && hoje.getFullYear() > 2026);
}

function limparAudiosAntigos() {
    try {
        if (fs.existsSync(PASTA_AUDIOS)) {
            const arquivos = fs.readdirSync(PASTA_AUDIOS);
            const agora = Date.now();
            const quinzeDiasMs = 15 * 24 * 60 * 60 * 1000;

            arquivos.forEach(file => {
                const caminhoArquivo = path.join(PASTA_AUDIOS, file);
                const stats = fs.statSync(caminhoArquivo);
                if ((agora - stats.mtimeMs) > quinzeDiasMs) {
                    fs.unlinkSync(caminhoArquivo);
                }
            });

            historicoAudio = historicoAudio.filter(h => (agora - h.timestamp) <= quinzeDiasMs);
            salvarHistoricoPTTNaNuvem();
        }
    } catch (e) {
        console.error("Erro na limpeza automática de áudios antigos:", e);
    }
}

function carregarHistoricoPTT() {
    try {
        if (fs.existsSync(ARQUIVO_HISTORICO_PTT)) {
            const dados = fs.readFileSync(ARQUIVO_HISTORICO_PTT, 'utf8');
            return JSON.parse(dados);
        }
    } catch (e) {}
    return [];
}

function salvarHistoricoPTTNaNuvem() {
    try {
        fs.writeFileSync(ARQUIVO_HISTORICO_PTT, JSON.stringify(historicoAudio, null, 2), 'utf8');
    } catch (e) {}
}

let historicoAudio = carregarHistoricoPTT();
limparAudiosAntigos();
setInterval(limparAudiosAntigos, 24 * 60 * 60 * 1000);

function carregarHistoricoRecusas() {
    try {
        if (fs.existsSync(ARQUIVO_RECUSAS)) {
            const dados = fs.readFileSync(ARQUIVO_RECUSAS, 'utf8');
            const lista = JSON.parse(dados);
            const agora = Date.now();
            const seteDiasMs = 7 * 24 * 60 * 60 * 1000;
            return lista.filter(r => (agora - r.timestamp) <= seteDiasMs);
        }
    } catch (e) {}
    return [];
}

function salvarHistoricoRecusas() {
    try {
        const agora = Date.now();
        const seteDiasMs = 7 * 24 * 60 * 60 * 1000;
        historicoRecusas = historicoRecusas.filter(r => (agora - r.timestamp) <= seteDiasMs);
        fs.writeFileSync(ARQUIVO_RECUSAS, JSON.stringify(historicoRecusas, null, 2), 'utf8');
    } catch (e) {}
}

function carregarHistoricoCorridas() {
    try {
        if (fs.existsSync(ARQUIVO_CORRIDAS)) {
            const dados = fs.readFileSync(ARQUIVO_CORRIDAS, 'utf8');
            return JSON.parse(dados);
        }
    } catch (e) {}
    return [];
}

function salvarHistoricoCorridas() {
    try {
        fs.writeFileSync(ARQUIVO_CORRIDAS, JSON.stringify(historicoCorridas, null, 2), 'utf8');
    } catch (e) {}
}

function carregarFrota() {
    try {
        if (fs.existsSync(ARQUIVO_FROTA)) {
            const dados = fs.readFileSync(ARQUIVO_FROTA, 'utf8');
            return JSON.parse(dados);
        }
    } catch (e) {}
    return {
        "Carro.99": {
            numero: "99", placa: "ABC1D00", login: "Carro.99",
            nome: "Admin Teste", modelo: "Fiat Grand Siena", cargo: "Comum",
            telefones: ["11900000000"], senha: "123", ehModerador: true,
            statusRadio: "ONLINE", mutadoAte: null, banidoAte: null, bloqueioRecusa: false
        }
    };
}

function salvarFrota() {
    try {
        fs.writeFileSync(ARQUIVO_FROTA, JSON.stringify(frotaCadastrada, null, 2), 'utf8');
    } catch (e) {}
}

function carregarUsuariosAdm() {
    try {
        if (fs.existsSync(ARQUIVO_USUARIOS_ADM)) {
            const dados = fs.readFileSync(ARQUIVO_USUARIOS_ADM, 'utf8');
            return JSON.parse(dados);
        }
    } catch (e) {}
    return {
        "adm": { usuario: "adm", senha: "123", cargo: "ADM", nome: "Administrador Geral" },
        "fiscal": { usuario: "fiscal", senha: "123", cargo: "FISCAL", nome: "Fiscal de Ponto" }
    };
}

function salvarUsuariosAdm() {
    try {
        fs.writeFileSync(ARQUIVO_USUARIOS_ADM, JSON.stringify(usuariosAdmCadastrados, null, 2), 'utf8');
    } catch (e) {}
}

let historicoRecusas = carregarHistoricoRecusas();
let frotaCadastrada = carregarFrota();
let usuariosAdmCadastrados = carregarUsuariosAdm();
let historicoCorridas = carregarHistoricoCorridas(); 

const PONTOS_FISICOS = {
    PH: { nome: "Ponto PH (Subida Arnaldo Rosa / Abel Ferreira)", capacidade: 15, latitude: -23.580278, longitude: -46.561389, raioMetros: 40 },
    PA2: { nome: "PA2 (Subida Fila Indiana)", capacidade: 5, latitude: -23.562111, longitude: -46.560305, raioMetros: 20 },
    PA4: { nome: "PA4 (Ponto Final / Bolsão Lado a Lado)", capacidade: 3, latitude: -23.561417, longitude: -46.561639, raioMetros: 12 }
};

let modoOperacao = "MANHA_SHOPPING";
let modoManualOverridden = false;
let filaGeral = [];
let motoristasConectados = {};
let chamadasPendentes = {};

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
    io.emit('atualizarSistema', { 
        fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, 
        usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, 
        recusas: historicoRecusas, corridas: historicoCorridas 
    });
}, 30 * 1000);

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.get('/whats', (req, res) => res.sendFile(__dirname + '/whats.html'));
app.get('/motorista', (req, res) => res.sendFile(__dirname + '/motorista.html'));
app.use('/audios', express.static(PASTA_AUDIOS));

io.on('connection', (socket) => {
    socket.emit('atualizarSistema', { 
        fila: filaGeral, 
        modo: modoOperacao, 
        frota: frotaCadastrada, 
        usuariosAdm: usuariosAdmCadastrados,
        historico: historicoAudio,
        recusas: historicoRecusas,
        corridas: historicoCorridas
    });

    // 🔄 FUNÇÃO DE LIMPEZA / REFRESH GERAL DO SISTEMA VIA ADMIN
    socket.on('adminLimparSistemaGeral', () => {
        console.log(`🧹 [ADMIN] Limpeza e refresh geral do sistema executados.`);

        // 1. Zera filas e chamadas/corridas presas
        filaGeral = [];
        chamadasPendentes = {};

        // 2. Libera todos os motoristas cadastrados e conectados para o status LIVRE e remove bloqueios temporários de recusa
        for (let chave in frotaCadastrada) {
            frotaCadastrada[chave].bloqueioRecusa = false;
        }
        salvarFrota();

        for (let idTaxi in motoristasConectados) {
            motoristasConectados[idTaxi].status = "LIVRE";
        }

        // 3. Emite atualização imediata para todos os clientes sincronizarem
        io.emit('atualizarSistema', { 
            fila: filaGeral, 
            modo: modoOperacao, 
            frota: frotaCadastrada, 
            usuariosAdm: usuariosAdmCadastrados, 
            historico: historicoAudio, 
            recusas: historicoRecusas,
            corridas: historicoCorridas 
        });

        // 4. Força todos os motoristas conectados a voltarem para o status LIVRE em suas telas
        io.emit('forcarStatusLivreGeral');
    });

    socket.on('loginAdm', (dados) => {
        const usuarioKey = dados.usuario.trim().toLowerCase();
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
    });

    socket.on('cadastrarCarro', (dados) => {
        const loginGerado = `Carro.${dados.numero}`;
        frotaCadastrada[loginGerado] = {
            numero: dados.numero,
            placa: (dados.placa || '').trim().toUpperCase(),
            login: loginGerado,
            nome: dados.nome,
            modelo: dados.modelo,
            cargo: dados.cargo || "Comum",
            telefones: dados.telefones,
            senha: dados.senha,
            ehModerador: Boolean(dados.ehModerador),
            statusRadio: "ONLINE",
            mutadoAte: null,
            banidoAte: null,
            bloqueioRecusa: false
        };
        salvarFrota();
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
        socket.emit('cadastroSucesso', { login: loginGerado });
    });

    socket.on('atualizarCarro', (dados) => {
        const login = dados.login;
        if (frotaCadastrada[login]) {
            frotaCadastrada[login].placa = (dados.placa || '').trim().toUpperCase();
            frotaCadastrada[login].nome = dados.nome;
            frotaCadastrada[login].modelo = dados.modelo;
            frotaCadastrada[login].telefones = dados.telefones;
            frotaCadastrada[login].ehModerador = Boolean(dados.ehModerador);

            salvarFrota();
            io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
            socket.emit('edicaoSucesso', { login: login });
        }
    });

    socket.on('excluirCarro', (dados) => {
        if (frotaCadastrada[dados.login]) {
            delete frotaCadastrada[dados.login];
            salvarFrota();
            const indexFila = filaGeral.findIndex(m => `Carro.${m.idTaxi}` === dados.login || String(m.idTaxi) === String(dados.login.replace('Carro.', '')));
            if (indexFila !== -1) {
                filaGeral.splice(indexFila, 1);
                redistribuirVagas();
            }
            io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
            socket.emit('excluirSucesso', { login: dados.login });
        }
    });

    socket.on('resetarSenhaCarro', (dados) => {
        if (frotaCadastrada[dados.login]) {
            frotaCadastrada[dados.login].senha = dados.novaSenha;
            salvarFrota();
            socket.emit('senhaResetadaSucesso', { login: dados.login });
        }
    });

    socket.on('loginMotorista', (dados) => {
        const idStr = String(dados.login).replace('Carro.', '');
        const carro = frotaCadastrada[dados.login] || frotaCadastrada[`Carro.${idStr}`];
        if (!carro) {
            socket.emit('loginErro', { mensagem: "Login (número do carro) não cadastrado." });
            return;
        }
        if (carro.senha !== dados.senha) {
            socket.emit('loginErro', { mensagem: "Senha incorreta." });
            return;
        }

        motoristasConectados[idStr] = { idTaxi: idStr, nome: carro.nome, status: "LIVRE", socketId: socket.id };
        socket.emit('loginSucesso', { carro: carro, historicoAudio: historicoAudio });

        if (checarAniversarioApp()) {
            socket.emit('aniversarioApp', { mensagem: "🎉 Parabéns! O Táxi Conecta completa mais um ano de vida hoje! (Início em 03/10/2026) 🚖" });
        }
    });

    socket.on('moderarBloqueioFila', (dados) => {
        const targetLogin = `Carro.${dados.alvoId}`;
        const tempoMs = dados.minutos ? dados.minutos * 60 * 1000 : 0;
        
        if (frotaCadastrada[targetLogin]) {
            frotaCadastrada[targetLogin].banidoAte = tempoMs > 0 ? (Date.now() + tempoMs) : (frotaCadastrada[targetLogin].banidoAte ? null : (Date.now() + 24*60*60*1000));
            salvarFrota();

            const idx = filaGeral.findIndex(m => String(m.idTaxi) === String(dados.alvoId));
            if (idx !== -1) {
                filaGeral.splice(idx, 1);
                redistribuirVagas();
            }
            io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
        }
    });

    socket.on('moderarBloqueioFala', (dados) => {
        const targetLogin = `Carro.${dados.alvoId}`;
        const tempoMs = dados.minutos ? dados.minutos * 60 * 1000 : 0;

        if (frotaCadastrada[targetLogin]) {
            frotaCadastrada[targetLogin].mutadoAte = tempoMs > 0 ? (Date.now() + tempoMs) : (frotaCadastrada[targetLogin].mutadoAte ? null : (Date.now() + 24*60*60*1000));
            salvarFrota();
            io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
        }
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
        // Informa para os outros motoristas que o canal está ocupado (botão azul)
        socket.broadcast.emit('canalOcupado', { idTaxi: dados.idTaxi, nome: dados.nome });
    });

    socket.on('liberarCanalPTT', () => {
        // Informa para os outros motoristas que o canal ficou livre
        io.emit('canalLivre');
    });

    socket.on('transmitirAudioPTT', (dados) => {
        const login = `Carro.${dados.idTaxi}`;
        const carro = frotaCadastrada[login];
        if (!carro) return;

        if (carro.mutadoAte && Date.now() < carro.mutadoAte) {
            socket.emit('loginErro', { mensagem: "Sua fala está temporariamente silenciada pela moderação." });
            return;
        }

        const nomeArquivo = `audio_${dados.idTaxi}_${Date.now()}.webm`;
        const caminhoCompleto = path.join(PASTA_AUDIOS, nomeArquivo);

        if (dados.audioBuffer) {
            fs.writeFile(caminhoCompleto, Buffer.from(dados.audioBuffer), (err) => {
                if (!err) {
                    const registroHistorico = {
                        id: Date.now(), timestamp: Date.now(), idTaxi: dados.idTaxi,
                        nomeMotorista: carro.nome, modelo: carro.modelo, cargo: carro.cargo,
                        ehModerador: Boolean(carro.ehModerador), arquivo: nomeArquivo,
                        audioUrl: `/audios/${nomeArquivo}`, duracao: dados.duracao || "0s",
                        dataHora: new Date().toLocaleString('pt-BR')
                    };

                    historicoAudio.unshift(registroHistorico);
                    if (historicoAudio.length > 500) historicoAudio.pop();

                    salvarHistoricoPTTNaNuvem();

                    io.emit('receberAudioPTT', {
                        idTaxi: dados.idTaxi, nomeMotorista: carro.nome, cargo: carro.cargo,
                        ehModerador: Boolean(carro.ehModerador), audioUrl: `/audios/${nomeArquivo}`,
                        historico: historicoAudio
                    });
                }
            });
        }
    });

    socket.on('cadastrarAdm', (dados) => {
        const key = (dados.usuario || '').trim().toLowerCase();
        if (!key || !dados.senha || !dados.nome) { return; }
        usuariosAdmCadastrados[key] = { usuario: key, senha: dados.senha.trim(), nome: dados.nome.trim(), cargo: dados.cargo || 'FISCAL' };
        salvarUsuariosAdm();
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
    });

    socket.on('editarAdmin', (dados) => {
        const key = (dados.usuario || '').trim().toLowerCase();
        if (usuariosAdmCadastrados[key]) {
            usuariosAdmCadastrados[key].nome = dados.nome.trim();
            if (dados.cargo) usuariosAdmCadastrados[key].cargo = dados.cargo;
            salvarUsuariosAdm();
            io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
        }
    });

    socket.on('resetarSenhaAdmin', (dados) => {
        const key = (dados.usuario || dados.idAdmin || '').trim().toLowerCase();
        if (usuariosAdmCadastrados[key]) {
            usuariosAdmCadastrados[key].senha = dados.novaSenha.trim();
            salvarUsuariosAdm();
        }
    });

    socket.on('excluirAdm', (dados) => {
        const key = (dados.usuario || '').trim().toLowerCase();
        if (usuariosAdmCadastrados[key]) {
            delete usuariosAdmCadastrados[key];
            salvarUsuariosAdm();
            io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
        }
    });

    socket.on('limparHistoricoRecusas', () => {
        historicoRecusas = [];
        try { if (fs.existsSync(ARQUIVO_RECUSAS)) fs.unlinkSync(ARQUIVO_RECUSAS); } catch (e) {}
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
    });

    socket.on('limparHistoricoPTT', () => {
        try {
            if (fs.existsSync(PASTA_AUDIOS)) {
                fs.readdirSync(PASTA_AUDIOS).forEach(file => fs.unlinkSync(path.join(PASTA_AUDIOS, file)));
            }
            if (fs.existsSync(ARQUIVO_HISTORICO_PTT)) fs.unlinkSync(ARQUIVO_HISTORICO_PTT);
        } catch (e) {}
        historicoAudio = [];
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
        io.emit('receberAudioPTT', { historico: [] });
    });

    socket.on('limparHistoricoCorridas', () => {
        historicoCorridas = [];
        try { if (fs.existsSync(ARQUIVO_CORRIDAS)) fs.unlinkSync(ARQUIVO_CORRIDAS); } catch (e) {}
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
    });

    socket.on('atualizarGPS', (dados) => {
        const idTaxiStr = String(dados.idTaxi);
        const login = `Carro.${idTaxiStr}`;
        const veiculo = frotaCadastrada[login];

        if (veiculo && veiculo.banidoAte && Date.now() < veiculo.banidoAte) return;

        if (veiculo && veiculo.bloqueioRecusa) {
            if (dados.simulacao === true) {
                veiculo.bloqueioRecusa = false;
                salvarFrota();
            }
        }

        const bloqueadoPorRecusa = veiculo && veiculo.bloqueioRecusa;

        if (dados.status === "AUSENTE") {
            if (motoristasConectados[idTaxiStr]) motoristasConectados[idTaxiStr].status = "AUSENTE";
            return; 
        }

        motoristasConectados[idTaxiStr] = { idTaxi: idTaxiStr, nome: dados.nome, latitude: dados.latitude, longitude: dados.longitude, status: dados.status, socketId: socket.id };

        const indexFila = filaGeral.findIndex(m => String(m.idTaxi) === idTaxiStr);

        if (dados.status === "OCUPADO" || dados.status === "EM CORRIDA") {
            if (indexFila !== -1) {
                filaGeral.splice(indexFila, 1);
                redistribuirVagas();
                io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
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
            io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
        }
    });

    socket.on('statusAusente', (dados) => {
        const idTaxiStr = String(dados.idTaxi);
        const indexFila = filaGeral.findIndex(m => String(m.idTaxi) === idTaxiStr);
        if (indexFila !== -1) {
            filaGeral.splice(indexFila, 1);
            redistribuirVagas();
        }
        if (motoristasConectados[idTaxiStr]) motoristasConectados[idTaxiStr].status = "AUSENTE";
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
    });

    socket.on('alterarModoOperacao', (novoModo) => {
        if (novoModo === 'AUTOMATICO') {
            modoManualOverridden = false;
            redistribuirVagas();
        } else if (["SO_PH", "MANHA_SHOPPING", "SHOPPING_COMPLETO", "BAIXA_FROTA"].includes(novoModo)) {
            modoOperacao = novoModo;
            modoManualOverridden = true;
            redistribuirVagas();
        }
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
    });

    socket.on('chamarCorrida', () => {
        if (filaGeral.length === 0) return;
        const motorista = filaGeral[0];
        filaGeral.shift();
        redistribuirVagas();

        const chamadoFinal = { idTaxi: motorista.idTaxi, nome: motorista.nome, origem: 'Fila Geral (Painel Fiscal)' };
        if (motoristasConectados[motorista.idTaxi]) {
            motoristasConectados[motorista.idTaxi].status = "OCUPADO";
            io.to(motoristasConectados[motorista.idTaxi].socketId).emit('forcarStatusOcupado');
        }

        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
        io.emit('corridaAtribuida', chamadoFinal);
    });

    socket.on('aceitarCorridaMotorista', (dadosAceite) => {
        confirmarEBaixarCorrida(dadosAceite.idChamada);
    });

    socket.on('recusarCorridaMotorista', (dadosRecusa) => {
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

        if (frotaCadastrada[loginRecusa]) {
            frotaCadastrada[loginRecusa].bloqueioRecusa = true;
            salvarFrota();
        }

        if (motoristasConectados[idTaxiRecusou] && motoristasConectados[idTaxiRecusou].socketId) {
            io.to(motoristasConectados[idTaxiRecusou].socketId).emit('avisoRecusaBloqueio', { idTaxi: idTaxiRecusou });
        }

        historicoRecusas.unshift({
            id: Date.now(), timestamp: Date.now(), idTaxi: idTaxiRecusou,
            nomeMotorista: motoristaRecusou.nome, origemChamado: chamada.origem || "WhatsApp",
            cliente: chamada.nomeCliente, dataHora: new Date().toLocaleString('pt-BR')
        });
        salvarHistoricoRecusas();

        chamada.indiceTentativaAtual = 0; 
        
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
        dispararPonteiroFila(dadosRecusa.idChamada);
    });

    socket.on('disconnect', () => {
        for (const idTaxi in motoristasConectados) {
            if (motoristasConectados[idTaxi].socketId === socket.id) {
                delete motoristasConectados[idTaxi];
                break;
            }
        }
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

function confirmarEBaixarCorrida(idChamada) {
    const chamada = chamadasPendentes[idChamada];
    if (!chamada) return;

    const idTaxiStr = String(chamada.idTaxi);
    const indexAtual = filaGeral.findIndex(m => String(m.idTaxi) === idTaxiStr);
    if (indexAtual !== -1) {
        filaGeral.splice(indexAtual, 1);
        redistribuirVagas();
    }

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
    salvarHistoricoCorridas();

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

    io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });
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
server.listen(PORTA, () => console.log(`🚖 Servidor Ponto 2216 rodando na porta ${PORTA} com Regras de Fila Progressivas Corrigidas!`));