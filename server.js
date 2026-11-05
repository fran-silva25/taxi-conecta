const express = require('express');   
const http = require('http');   
const { Server } = require('socket.io');   
const cors = require('cors');   
const fs = require('fs');   
const path = require('path');   
const db = require('./db');   
  
// Importando as funções e a cerca virtual do bot do WhatsApp   
const { iniciarBotWhatsApp, liberarClienteWhatsApp, verificarDentroDaCerca, fronteiraPonto2216, obterQrCodeAtual } = require('./bot_whatsapp');   
  
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
  
// Carregamento assíncrono do Banco de Dados para Frota   
async function carregarFrotaDoBanco() {   
    try {   
        const res = await db.query('SELECT * FROM motoristas');   
        const frotaObj = {};   
        if (res.rows.length > 0) {   
            res.rows.forEach(row => {   
                const senhaLimpa = (row.senha !== null && row.senha !== undefined && String(row.senha).trim() !== "") ? String(row.senha).trim() : "123";   
                frotaObj[row.login || `Carro.${row.numero}`] = {   
                    numero: row.numero,   
                    placa: row.placa,   
                    login: row.login || `Carro.${row.numero}`,   
                    nome: row.nome,   
                    modelo: row.modelo,   
                    cargo: row.cargo || "Comum",   
                    telefones: row.telefones ? (Array.isArray(row.telefones) ? row.telefones : [row.telefones]) : [],   
                    senha: senhaLimpa,   
                    ehModerador: Boolean(row.eh_moderador),   
                    statusRadio: row.status_radio || "ONLINE",   
                    mutadoAte: row.mutado_ate ? Number(row.mutado_ate) : null,   
                    banidoAte: row.banido_ate ? Number(row.banido_ate) : null,   
                    bloqueioRecusa: Boolean(row.bloqueio_recusa)   
                };   
            });   
            return frotaObj;   
        }   
    } catch (e) {   
        console.error("Erro ao carregar motoristas do banco:", e);   
    }   
    return {   
        "Carro.99": {   
            numero: "99", placa: "ABC1D00", login: "Carro.99",   
            nome: "Admin Teste", modelo: "Fiat Grand Siena", cargo: "Comum",   
            telefones: ["11900000000"], senha: "123", ehModerador: true,   
            statusRadio: "ONLINE", mutadoAte: null, banidoAte: null, bloqueioRecusa: false   
        }   
    };   
}   
  
async function salvarCarroNoBanco(carro) {   
    try {   
        const query = `   
            INSERT INTO motoristas (numero, placa, login, nome, modelo, cargo, telefones, senha, eh_moderador, status_radio, mutado_ate, banido_ate, bloqueio_recusa)   
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)   
            ON CONFLICT (numero) DO UPDATE SET   
            placa = EXCLUDED.placa,   
            nome = EXCLUDED.nome,   
            modelo = EXCLUDED.modelo,   
            cargo = EXCLUDED.cargo,   
            telefones = EXCLUDED.telefones,   
            senha = EXCLUDED.senha,   
            eh_moderador = EXCLUDED.eh_moderador,   
            status_radio = EXCLUDED.status_radio,   
            mutado_ate = EXCLUDED.mutado_ate,   
            banido_ate = EXCLUDED.banido_ate,   
            bloqueio_recusa = EXCLUDED.bloqueio_recusa;   
        `;   
        await db.query(query, [   
            carro.numero, carro.placa, carro.login, carro.nome, carro.modelo,   
            carro.cargo, JSON.stringify(carro.telefones), carro.senha, carro.ehModerador,   
            carro.statusRadio, carro.mutadoAte, carro.banidoAte, carro.bloqueioRecusa   
        ]);   
    } catch (e) {   
        console.error("Erro ao salvar carro no banco:", e);   
    }   
}   
  
async function excluirCarroDoBanco(numero) {   
    try {   
        await db.query('DELETE FROM motoristas WHERE numero = $1', [numero]);   
        console.log(`✅ Carro ${numero} excluído do banco com sucesso.`);   
    } catch (e) {   
        console.error("❌ Erro ao excluir carro do banco:", e);   
    }   
}   
  
// Carregamento assíncrono do Banco de Dados para Administradores   
async function carregarAdmsDoBanco() {   
    try {   
        const res = await db.query('SELECT * FROM administradores');   
        const admsObj = {};   
        if (res.rows.length > 0) {   
            res.rows.forEach(row => {   
                const key = (row.usuario || '').trim().toLowerCase();   
                if (key) {   
                    admsObj[key] = {   
                        usuario: row.usuario,   
                        senha: String(row.senha || row.senha_hash || '123').trim(),   
                        cargo: row.cargo || 'FISCAL',   
                        nome: row.nome || 'Administrador'   
                    };   
                }   
            });   
            return admsObj;   
        }   
    } catch (e) {   
        console.error("Erro ao carregar administradores do banco:", e);   
    }   
    return {   
        "adm": { usuario: "adm", senha: "123", cargo: "ADM", nome: "Administrador Geral" },   
        "fiscal": { usuario: "fiscal", senha: "123", cargo: "FISCAL", nome: "Fiscal de Ponto" }   
    };   
}   
  
async function salvarAdmNoBanco(adm) {   
    try {   
        const query = `   
            INSERT INTO administradores (usuario, senha, nome, cargo)   
            VALUES ($1, $2, $3, $4)   
            ON CONFLICT (usuario) DO UPDATE SET   
            senha = EXCLUDED.senha,   
            nome = EXCLUDED.nome,   
            cargo = EXCLUDED.cargo;   
        `;   
        await db.query(query, [adm.usuario, String(adm.senha).trim(), adm.nome, adm.cargo]);   
    } catch (e) {   
        console.error("Erro ao salvar administrador no banco:", e);   
    }   
}   
  
async function excluirAdmDoBanco(usuarioKey) {   
    try {   
        await db.query('DELETE FROM administradores WHERE LOWER(usuario) = LOWER($1)', [usuarioKey]);   
    } catch (e) {   
        console.error("Erro ao excluir administrador do banco:", e);   
    }   
}   
  
let historicoRecusas = carregarHistoricoRecusas();   
let historicoCorridas = carregarHistoricoCorridas();   
let frotaCadastrada = {};   
let usuariosAdmCadastrados = {};   
  
const PONTOS_FISICOS = {   
    PH: { nome: "Ponto PH (Subida Arnaldo Rosa / Abel Ferreira)", capacidade: 15, latitude: -23.580278, longitude: -46.561389, raioMetros: 40 },   
    PA2: { nome: "PA2 (Subida Fila Indiana)", capacidade: 5, latitude: -23.562111, longitude: -46.560305, raioMetros: 20 },   
    PA4: { nome: "PA4 (Ponto Final / Bolsão Lado a Lado)", capacidade: 3, latitude: -23.561417, longitude: -46.561639, raioMetros: 12 }   
};   
  
let modoOperacao = "AUTOMATICO";   
let modoManualOverridden = false;   
let pa2Fechado = false;   
let filaGeral = [];   
let motoristasConectados = {};   
let chamadasPendentes = {};   
let idEmTransmissaoPTT = null;   
  
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
  
    if (modoOperacao === "SO_PH" || modoOperacao === "BAIXA_FROTA") {   
        const capacidadePH = PONTOS_FISICOS.PH.capacidade;   
        filaGeral.forEach((carro, idx) => {   
            carro.setor = (idx < capacidadePH) ? 'PH' : 'Aguardando PH';   
        });   
        return;   
    }   
  
    if (modoOperacao === "MANHA_SHOPPING") {   
        filaGeral.forEach((carro, idx) => {   
            if (idx === 0) {   
                carro.setor = 'PA4';   
            } else if (idx === 1 && !pa2Fechado) {   
                carro.setor = 'PA2';   
            } else if (idx === (pa2Fechado ? 1 : 2) - 1 < PONTOS_FISICOS.PA4.capacidade && pa2Fechado) {   
                carro.setor = 'PA4';   
            } else if (idx - (pa2Fechado ? 1 : 2) < PONTOS_FISICOS.PH.capacidade) {   
                carro.setor = 'PH';   
            } else {   
                carro.setor = 'Aguardando PH';   
            }   
        });   
        return;   
    }   
  
    let indiceAtribuicao = 0;   
    const capacidadePA4Real = pa2Fechado ? (PONTOS_FISICOS.PA4.capacidade + 4) : PONTOS_FISICOS.PA4.capacidade;   
    const vagasPA4 = Math.min(capacidadePA4Real, totalCarros - indiceAtribuicao);   
    for (let i = 0; i < vagasPA4; i++) {   
        filaGeral[indiceAtribuicao].setor = 'PA4';   
        indiceAtribuicao++;   
    }   
  
    let vagasPA2 = 0;   
    if (!pa2Fechado) {   
        const mesAtual = new Date().getMonth() + 1;   
        const mesDezembro = (mesAtual === 12);   
        const phAberto = filaGeral.some(c => c.pontoFisicoReal === 'PH');   
        const limitePA2 = (mesDezembro && !phAberto) ? 10 : PONTOS_FISICOS.PA2.capacidade;   
  
        vagasPA2 = Math.min(limitePA2, totalCarros - indiceAtribuicao);   
        for (let i = 0; i < vagasPA2; i++) {   
            filaGeral[indiceAtribuicao].setor = 'PA2';   
            indiceAtribuicao++;   
        }   
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
        modo: modoOperacao,   
        pa2Fechado: pa2Fechado,   
        fila: filaGeral,   
        frota: frotaCadastrada,   
        usuariosAdm: usuariosAdmCadastrados,   
        historico: historicoAudio,   
        recusas: historicoRecusas,   
        corridas: historicoCorridas   
    });   
}, 30 * 1000);   
  
app.get('/', (req, res) => res.sendFile(__dirname + '/www/index.html'));   
app.get('/admin.html', (req, res) => res.sendFile(__dirname + '/www/admin.html'));   
app.get('/motorista.html', (req, res) => res.sendFile(__dirname + '/www/motorista.html'));   
app.get('/motorista', (req, res) => res.sendFile(__dirname + '/www/motorista.html'));   
app.use('/audios', express.static(PASTA_AUDIOS));   
  
app.get('/qr', (req, res) => {   
    const qr = obterQrCodeAtual();   
    if (!qr) {   
        return res.send(`   
            <div style="font-family:sans-serif; text-align:center; padding:50px; background:#121212; color:white; height:100vh;">   
                <h2>✅ WhatsApp já está conectado ou aguardando inicialização!</h2>   
            </div>   
        `);   
    }   
  
    const imgUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=350x350`;   
    res.send(`   
        <html>   
        <head><title>QR Code - Ponto 2216</title></head>   
        <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; background:#121212; color:white; margin:0;">   
            <h2>Escaneie com o seu WhatsApp</h2>   
            <div style="background:white; padding:15px; border-radius:12px; margin:20px 0;">   
                <img src="${imgUrl}" alt="QR Code" style="display:block;" />   
            </div>   
        </body>   
        </html>   
    `);   
});   
  
io.on('connection', (socket) => {   
    const listaConectadosArray = Object.values(motoristasConectados).map(m => ({   
        idTaxi: m.idTaxi, nome: m.nome, status: m.status   
    }));   
  
    socket.emit('atualizarSistema', {   
        fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada,   
        usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio,   
        recusas: historicoRecusas, corridas: historicoCorridas,   
        conectados: listaConectadosArray, emTransmissaoPTT: idEmTransmissaoPTT   
    });   
  
    // Validação estrita: apenas Administradores ('ADM') podem executar o refresh/limpeza geral
    socket.on('adminLimparSistemaGeral', async (dadosUsuario) => {   
        const cargoUser = dadosUsuario && dadosUsuario.cargo ? String(dadosUsuario.cargo).toUpperCase() : '';   
        if (cargoUser !== 'ADM') {   
            socket.emit('loginErro', { mensagem: 'Acesso negado: Apenas administradores podem executar a limpeza geral do sistema.' });   
            return;   
        }   

        filaGeral = [];   
        chamadasPendentes = {};   
        idEmTransmissaoPTT = null;   
  
        for (let chave in frotaCadastrada) {   
            frotaCadastrada[chave].bloqueioRecusa = false;   
            await salvarCarroNoBanco(frotaCadastrada[chave]);   
        }   
  
        for (let idTaxi in motoristasConectados) {   
            motoristasConectados[idTaxi].status = "LIVRE";   
        }   
  
        io.emit('atualizarSistema', {   
            fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada,   
            usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio,   
            recusas: historicoRecusas, corridas: historicoCorridas,   
            emTransmissaoPTT: null   
        });   
  
        io.emit('forcarStatusLivreGeral');   
        io.emit('canalLivre');   
    });   
  
    socket.on('alternarStatusPA2', (statusFechado) => {   
        pa2Fechado = Boolean(statusFechado);   
        redistribuirVagas();   
        io.emit('atualizarSistema', {   
            fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada,   
            usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio,   
            recusas: historicoRecusas, corridas: historicoCorridas,   
            emTransmissaoPTT: idEmTransmissaoPTT   
        });   
    });   
  
    socket.on('loginAdmin', (dados) => {   
        const usuario = dados.usuario ? dados.usuario.trim().toLowerCase() : "";   
        const senha = dados.senha ? dados.senha.trim() : "";   
        const admCadastrado = usuariosAdmCadastrados[usuario];   
  
        if (admCadastrado && admCadastrado.senha === senha) {   
            socket.emit('loginAdmSucesso', {   
                usuario: admCadastrado.usuario,   
                nome: admCadastrado.nome || 'Administrador',   
                cargo: admCadastrado.cargo || 'ADM'   
            });   
        } else {   
            socket.emit('loginErro', { mensagem: "Credenciais administrativas incorretas." });   
        }   
    });   
  
    socket.on('cadastrarCarro', async (dados) => {   
        const loginGerado = `Carro.${dados.numero}`;   
        const senhaDefinida = (dados.senha !== null && dados.senha !== undefined && String(dados.senha).trim() !== "") ? String(dados.senha).trim() : "123";   
  
        const novoCarro = {   
            numero: dados.numero,   
            placa: (dados.placa || '').trim().toUpperCase(),   
            login: loginGerado,   
            nome: dados.nome,   
            modelo: dados.modelo,   
            cargo: dados.cargo || "Comum",   
            telefones: dados.telefones,   
            senha: senhaDefinida,   
            ehModerador: Boolean(dados.ehModerador),   
            statusRadio: "ONLINE",   
            mutadoAte: null,   
            banidoAte: null,   
            bloqueioRecusa: false   
        };   
        frotaCadastrada[loginGerado] = novoCarro;   
        await salvarCarroNoBanco(novoCarro);   
  
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
        socket.emit('cadastroSucesso', { login: loginGerado });   
    });   
  
    socket.on('salvarCarroFrota', async (dados) => {   
        const numCarro = dados.numero.trim();   
        const loginGerado = `Carro.${numCarro}`;   
  
        if (dados.idAntigo && String(dados.idAntigo) !== String(numCarro)) {   
            delete frotaCadastrada[`Carro.${dados.idAntigo}`];   
            try {   
                await db.query('DELETE FROM motoristas WHERE numero = $1', [dados.idAntigo]);   
            } catch (e) {}   
        }   
  
        let senhaFinal = "123";   
        if (dados.senha !== null && dados.senha !== undefined && String(dados.senha).trim() !== "") {   
            senhaFinal = String(dados.senha).trim();   
        } else if (frotaCadastrada[loginGerado] && frotaCadastrada[loginGerado].senha) {   
            senhaFinal = frotaCadastrada[loginGerado].senha;   
        }   
  
        let listaTelefones = [];   
        if (Array.isArray(dados.telefone)) {   
            listaTelefones = dados.telefone;   
        } else if (dados.telefone) {   
            listaTelefones = [dados.telefone.trim()];   
        } else if (frotaCadastrada[loginGerado] && frotaCadastrada[loginGerado].telefones) {   
            listaTelefones = frotaCadastrada[loginGerado].telefones;   
        }   
  
        const carroAtualizado = {   
            numero: numCarro,   
            placa: (dados.placa || '').trim().toUpperCase(),   
            login: loginGerado,   
            nome: dados.nome.trim(),   
            modelo: dados.modelo || 'Padrão',   
            cargo: dados.ehModerador ? "Moderador" : "Comum",   
            telefones: listaTelefones,   
            senha: senhaFinal,   
            ehModerador: Boolean(dados.ehModerador),   
            statusRadio: "ONLINE",   
            mutadoAte: null,   
            banidoAte: null,   
            bloqueioRecusa: false   
        };   
  
        frotaCadastrada[loginGerado] = carroAtualizado;   
        await salvarCarroNoBanco(carroAtualizado);   
  
        io.emit('atualizarSistema', {   
            fila: filaGeral,   
            modo: modoOperacao,   
            pa2Fechado: typeof pa2Fechado !== 'undefined' ? pa2Fechado : false,   
            frota: frotaCadastrada,   
            usuariosAdm: usuariosAdmCadastrados,   
            historico: historicoAudio,   
            recusas: historicoRecusas,   
            corridas: historicoCorridas   
        });   
    });   
  
    socket.on('resetarSenhaFrota', async (dados) => {   
        const numLimpo = String(dados.id || dados.login || '').replace(/[^0-9]/g, '');   
        const chaveBusca = `Carro.${numLimpo}`;   
        if (frotaCadastrada[chaveBusca]) {   
            const novaSenhaLimpa = (dados.novaSenha !== null && dados.novaSenha !== undefined && String(dados.novaSenha).trim() !== "") ? String(dados.novaSenha).trim() : "123";   
            frotaCadastrada[chaveBusca].senha = novaSenhaLimpa;   
            await salvarCarroNoBanco(frotaCadastrada[chaveBusca]);   
            socket.emit('senhaResetadaSucesso', { login: chaveBusca });   
        }   
    });   
  
    socket.on('loginMotorista', (dados) => {
        const idStr = String(dados.login || '').replace(/[^0-9]/g, '').trim();
        const carro = Object.values(frotaCadastrada).find(c => String(c.numero).trim() === idStr);
  
        if (!carro) {
            socket.emit('loginErro', { mensagem: `Login (Carro ${idStr}) não encontrado na base.` });
            return;
        }
  
        // VALIDAÇÃO ANTI-DUPLICIDADE: Se o carro já estiver logado noutrom aparelho, bloqueia e avisa
        if (motoristasConectados[idStr]) {
            socket.emit('loginErro', { mensagem: `Acesso negado: O Carro.${idStr} já está conectado em outro dispositivo!` });
            return;
        }

        const senhaCadastrada = (carro.senha !== null && carro.senha !== undefined && String(carro.senha).trim() !== "") ? String(carro.senha).trim() : "123";
        const senhaInformada = (dados.senha !== null && dados.senha !== undefined) ? String(dados.senha).trim() : "";
  
        if (senhaCadastrada !== senhaInformada) {
            socket.emit('loginErro', { mensagem: "Senha incorreta." });
            return;
        }
  
        motoristasConectados[idStr] = { idTaxi: idStr, nome: carro.nome, status: "LIVRE", socketId: socket.id, timestampLogin: Date.now() };
        socket.emit('loginSucesso', { carro: carro, historicoAudio: historicoAudio });
  
        if (checarAniversarioApp()) {
            socket.emit('aniversarioApp', { mensagem: "🎉 Parabéns! O Táxi Conecta completa mais um ano de vida hoje! (Início em 03/10/2026) 🚖" });
        }
    });   
    // Evento PTT com suporte completo a Moderadores, Fiscais e ADMs
    socket.on('solicitarCanalPTT', (dados) => {   
        const idTransmissor = String(dados.idTaxi);   
        const loginTransmissor = `Carro.${idTransmissor}`;
        const carroObj = frotaCadastrada[loginTransmissor];
        const ehModeradorOuAdmin = (idTransmissor === 'ADM' || idTransmissor === 'Fiscal' || dados.ehModerador === true || (carroObj && carroObj.ehModerador));   
  
        if (idEmTransmissaoPTT && idEmTransmissaoPTT !== idTransmissor && ehModeradorOuAdmin) {   
            io.emit('forcarCortePTT', { idAtivo: idEmTransmissaoPTT });   
        }   
  
        idEmTransmissaoPTT = idTransmissor;   
        socket.broadcast.emit('canalOcupado', { idTaxi: idTransmissor, nome: dados.nome });   
    });   
  
    socket.on('liberarCanalPTT', () => {   
        idEmTransmissaoPTT = null;   
        io.emit('canalLivre');   
    });   
  
    socket.on('transmitirAudioPTT', (dados) => {   
        let idIdentificacao = dados.idTaxi;   
        let nomeMotorista = dados.nomeMotorista || "Fiscal / Central";   
        let modeloCarro = "Painel ADM";   
        let cargoPerfil = "FISCAL";   
        let ehModeradorPerfil = true;   
  
        if (dados.idTaxi && dados.idTaxi !== 'ADM' && dados.idTaxi !== 'Fiscal') {   
            const login = `Carro.${dados.idTaxi}`;   
            const carro = frotaCadastrada[login];   
            if (carro) {   
                if (carro.mutadoAte && Date.now() < carro.mutadoAte) {   
                    socket.emit('loginErro', { mensagem: "Sua fala está temporariamente silenciada pela moderação." });   
                    return;   
                }   
                nomeMotorista = carro.nome;   
                modeloCarro = carro.modelo;   
                cargoPerfil = carro.cargo;   
                ehModeradorPerfil = Boolean(carro.ehModerador);   
            }   
        }   
  
        const nomeArquivo = `audio_${idIdentificacao}_${Date.now()}.webm`;   
        const caminhoCompleto = path.join(PASTA_AUDIOS, nomeArquivo);   
  
        if (dados.audioBuffer) {   
            fs.writeFile(caminhoCompleto, Buffer.from(dados.audioBuffer), (err) => {   
                if (!err) {   
                    const registroHistorico = {   
                        id: Date.now(), timestamp: Date.now(), idTaxi: String(idIdentificacao),   
                        nomeMotorista: nomeMotorista, modelo: modeloCarro, cargo: cargoPerfil,   
                        ehModerador: ehModeradorPerfil, arquivo: nomeArquivo,   
                        audioUrl: `/audios/${nomeArquivo}`, duracao: dados.duracao || "0s",   
                        dataHora: new Date().toLocaleString('pt-BR')   
                    };   
  
                    historicoAudio.unshift(registroHistorico);   
                    if (historicoAudio.length > 500) historicoAudio.pop();   
  
                    salvarHistoricoPTTNaNuvem();   
                    idEmTransmissaoPTT = null;   
  
                    io.emit('receberAudioPTT', {   
                        idTaxi: String(idIdentificacao), nomeMotorista: nomeMotorista, cargo: cargoPerfil,   
                        ehModerador: ehModeradorPerfil, audioUrl: `/audios/${nomeArquivo}`,   
                        duracao: dados.duracao || "0s", historico: historicoAudio   
                    });   
                    io.emit('canalLivre');   
                }   
            });   
        }   
    });   
  
    socket.on('alterarModoOperacao', (modoRecebido) => {   
        const novoModo = modoRecebido;   
        if (novoModo === 'AUTOMATICO') {   
            modoManualOverridden = false;   
            redistribuirVagas();   
        } else if (["SO_PH", "MANHA_SHOPPING", "SHOPPING_COMPLETO", "BAIXA_FROTA"].includes(novoModo)) {   
            modoOperacao = novoModo;   
            modoManualOverridden = true;   
            redistribuirVagas();   
        }   
        io.emit('atualizarSistema', {   
            fila: filaGeral,   
            modo: modoOperacao,   
            pa2Fechado: pa2Fechado,   
            frota: frotaCadastrada,   
            usuariosAdm: usuariosAdmCadastrados,   
            historico: historicoAudio,   
            recusas: historicoRecusas,   
            corridas: historicoCorridas   
        });   
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
  
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
        io.emit('corridaAtribuida', chamadoFinal);   
    });   
  
    socket.on('atualizarGPS', async (dados) => {   
        const idTaxiStr = String(dados.idTaxi);   
        const login = `Carro.${idTaxiStr}`;   
        const veiculo = frotaCadastrada[login];   
  
        if (veiculo && veiculo.banidoAte && Date.now() < veiculo.banidoAte) return;   
  
        if (veiculo && veiculo.bloqueioRecusa) {   
            if (dados.simulacao === true) {   
                veiculo.bloqueioRecusa = false;   
                await salvarCarroNoBanco(veiculo);   
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
                io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
            }   
            return;   
        }   
  
        const distPH = calcularDistanciaMetros(dados.latitude, dados.longitude, PONTOS_FISICOS.PH.latitude, PONTOS_FISICOS.PH.longitude);   
        const distPA2 = calcularDistanciaMetros(dados.latitude, dados.longitude, PONTOS_FISICOS.PA2.latitude, PONTOS_FISICOS.PA2.longitude);   
        const distPA4 = calcularDistanciaMetros(dados.latitude, dados.longitude, PONTOS_FISICOS.PA4.latitude, PONTOS_FISICOS.PA4.longitude);   
  
        let estaNoPonto = (distPH <= PONTOS_FISICOS.PH.raioMetros) || (!pa2Fechado && distPA2 <= PONTOS_FISICOS.PA2.raioMetros) || (distPA4 <= PONTOS_FISICOS.PA4.raioMetros);   
  
        const simulacaoForcada = dados.simulacao === true || (dados.latitude === PONTOS_FISICOS.PH.latitude && dados.longitude === PONTOS_FISICOS.PH.longitude);   
        const naArea = simulacaoForcada || verificarDentroDaCerca([dados.latitude, dados.longitude], fronteiraPonto2216);   
  
        if ((estaNoPonto || simulacaoForcada) && naArea && indexFila === -1 && !bloqueadoPorRecusa) {   
            const novoCarroFila = {   
                idTaxi: idTaxiStr,   
                nome: dados.nome,   
                distanciaMetros: simulacaoForcada ? 0 : Math.min(Math.round(distPH), pa2Fechado ? 99999 : Math.round(distPA2), Math.round(distPA4)),   
                pontoFisicoReal: (distPH <= PONTOS_FISICOS.PH.raioMetros) ? 'PH' : 'OUTRO',   
                dataEntrada: new Date()   
            };   
  
            filaGeral.push(novoCarroFila);   
            redistribuirVagas();   
            io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
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
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
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
  
        if (frotaCadastrada[loginRecusa]) {   
            frotaCadastrada[loginRecusa].bloqueioRecusa = true;   
            await salvarCarroNoBanco(frotaCadastrada[loginRecusa]);   
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
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
        dispararPonteiroFila(dadosRecusa.idChamada);   
    });   
  
    socket.on('cadastrarAdm', async (dados) => {   
        const key = (dados.usuario || '').trim().toLowerCase();   
        if (!key || !dados.senha || !dados.nome) { return; }   
        const novoAdm = { usuario: key, senha: dados.senha.trim(), nome: dados.nome.trim(), cargo: dados.cargo || 'FISCAL' };   
        usuariosAdmCadastrados[key] = novoAdm;   
        await salvarAdmNoBanco(novoAdm);   
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
    });   
  
    socket.on('excluirAdmin', async (dados) => {   
        const key = (dados.usuario || '').trim().toLowerCase();   
        if (usuariosAdmCadastrados[key]) {   
            delete usuariosAdmCadastrados[key];   
            await excluirAdmDoBanco(key);   
            io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
        }   
    });   
  
    socket.on('limparHistoricoRecusas', () => {   
        historicoRecusas = [];   
        try { if (fs.existsSync(ARQUIVO_RECUSAS)) fs.unlinkSync(ARQUIVO_RECUSAS); } catch (e) {}   
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
    });   
  
    socket.on('limparHistoricoPTT', () => {   
        try {   
            if (fs.existsSync(PASTA_AUDIOS)) {   
                fs.readdirSync(PASTA_AUDIOS).forEach(file => fs.unlinkSync(path.join(PASTA_AUDIOS, file)));   
            }   
            if (fs.existsSync(ARQUIVO_HISTORICO_PTT)) fs.unlinkSync(ARQUIVO_HISTORICO_PTT);   
        } catch (e) {}   
        historicoAudio = [];   
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
        io.emit('receberAudioPTT', { historico: [] });   
    });   
  
    socket.on('limparHistoricoCorridas', () => {   
        historicoCorridas = [];   
        try { if (fs.existsSync(ARQUIVO_CORRIDAS)) fs.unlinkSync(ARQUIVO_CORRIDAS); } catch (e) {}   
        io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
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
        const mensagemFinal = `🚖 *TÁXI CONFIRMADO!*\n\n` +   
        `👤 *Passageiro(a):* ${dadosAtribuicao.nomeCliente}\n` +   
        `👨‍✈️ *Motorista:* ${dadosAtribuicao.nome}\n` +   
        `🚐 *Veículo:* ${dadosAtribuicao.modelo}\n` +   
        `📋 *Placa:* ${dadosAtribuicao.placa}\n\n` +   
        `⏱️ *Previsão de chegada:* aprox. ${tempoEstimado}\n\n` +   
        `⚠️ Aguarde no local *(se for condomínio, aguardar na portaria)*, o seu táxi está a caminho!`;   
  
        chamada.sockWhatsApp.sendMessage(chamada.jidCliente, { text: mensagemFinal }).catch(e => console.error("Erro ao enviar WhatsApp:", e));   
    }   
  
    liberarClienteWhatsApp(chamada.jidCliente);   
  
    io.emit('atualizarSistema', { fila: filaGeral, modo: modoOperacao, pa2Fechado: pa2Fechado, frota: frotaCadastrada, usuariosAdm: usuariosAdmCadastrados, historico: historicoAudio, recusas: historicoRecusas, corridas: historicoCorridas });   
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
  
async function iniciarServidor() {   
    frotaCadastrada = await carregarFrotaDoBanco();   
    usuariosAdmCadastrados = await carregarAdmsDoBanco();   
  
    const PORTA = process.env.PORT || 3000;   
    server.listen(PORTA, () => console.log(`🚖 Servidor Ponto 2216 rodando na nuvem na porta ${PORTA} com Base de Dados do Render conectada!`));   
}   
  
iniciarServidor();