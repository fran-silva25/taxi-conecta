// bot_whatsapp.js

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const PASTA_SESSAO = path.join(__dirname, 'sessao_whatsapp');
const estadosClientes = {};
let qrCodeAtual = null;

// Coordenadas que formam o contorno exato do mapa de abrangência (Ponto 2216)
const fronteiraPonto2216 = [
    [-23.559848795392348, -46.576293531403884],
    [-23.557763862084443, -46.577387872677996],
    [-23.55344122514095, -46.57623089192507],  
    [-23.551221533049773, -46.576454428237305],
    [-23.549196480642586, -46.56805693508407], 
    [-23.54637669115159, -46.553147908553285], 
    [-23.547872724839383, -46.54686378153299], 
    [-23.549324701399577, -46.54631879055952], 
    [-23.55069911453961, -46.54334078423458],  
    [-23.557120057235608, -46.5446958269074],  
    [-23.563023133912136, -46.54269347402873], 
    [-23.565290079986305, -46.54532596583635], 
    [-23.568405385513316, -46.542744946747064],
    [-23.570293273622287, -46.540336254639676],
    [-23.571007603419158, -46.54042385511661], 
    [-23.57564973934584, -46.541737224477856], 
    [-23.580159187847595, -46.539666779284346],
    [-23.57972117717351, -46.539131514234086], 
    [-23.578109285307725, -46.54532529553],    
    [-23.574219638585372, -46.556795261278275],
    [-23.573536310379364, -46.565588901885896],
    [-23.572485029276983, -46.57161063370136], 
    [-23.569085829390207, -46.573407595182005],
    [-23.56311073387646, -46.57598833766969],  
    [-23.554839771997806, -46.57627508705842]  
];

function verificarDentroDaCerca(pontoLatLon, poligonoCerca) {
    let lat = pontoLatLon[0], lon = pontoLatLon[1];
    let dentro = false;
    
    for (let i = 0, j = poligonoCerca.length - 1; i < poligonoCerca.length; j = i++) {
        let latI = poligonoCerca[i][0], lonI = poligonoCerca[i][1];
        let latJ = poligonoCerca[j][0], lonJ = poligonoCerca[j][1];
        
        let intercepta = ((lonI > lon) != (lonJ > lon)) &&
            (lat < (latJ - latI) * (lon - lonI) / (lonJ - lonI) + latI);
            
        if (intercepta) dentro = !dentro;
    }
    return dentro;
}

// Geocodificação Direta (Endereço Digitado)
async function buscarCoordenadasPorEndereco(enderecoTexto) {
    try {
        const query = encodeURIComponent(`${enderecoTexto}, São Paulo, SP, Brasil`);
        const resposta = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`, {
            headers: { 'User-Agent': 'BotPonto2216/1.0 (contato@ponto2216.com.br)' }
        });
        const dados = await resposta.json();
        if (dados && dados.length > 0) return { lat: parseFloat(dados[0].lat), lon: parseFloat(dados[0].lon) };
        return null;
    } catch (e) {
        console.error('Erro na API de mapas:', e);
        return null;
    }
}

// Geocodificação Reversa Aprimorada (Pino GPS do WhatsApp -> Rua, Número e Bairro)
async function buscarEnderecoPorCoordenadas(lat, lon) {
    try {
        const resposta = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
            headers: { 'User-Agent': 'BotPonto2216/1.0 (contato@ponto2216.com.br)' }
        });
        const dados = await resposta.json();
        if (dados && dados.address) {
            const rua = dados.address.road || dados.address.pedestrian || dados.address.street || "Endereço via Pino GPS";
            const numero = dados.address.house_number ? `, ${dados.address.house_number}` : '';
            const bairro = (dados.address.suburb || dados.address.neighbourhood || dados.address.city_district) 
                ? ` - ${dados.address.suburb || dados.address.neighbourhood || dados.address.city_district}` 
                : '';
            return `${rua}${numero}${bairro}`;
        }
        return "Endereço via Pino GPS";
    } catch (e) {
        console.error('Erro na geocodificação reversa:', e);
        return "Endereço via Pino GPS";
    }
}

function liberarClienteWhatsApp(jidCliente) {
    if (jidCliente && estadosClientes[jidCliente]) {
        delete estadosClientes[jidCliente];
        console.log(`🟢 WhatsApp de ${jidCliente} foi LIBERADO para novas solicitações.`);
    }
}

function obterQrCodeAtual() {
    return qrCodeAtual;
}

function iniciarBotWhatsApp(funcaoSolicitarCorrida) {
    let sock = null;

    async function conectarWhatsApp() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);

            sock = makeWASocket({
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                auth: state,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 25000,
                shouldSyncHistoryMessage: () => false,
                markOnlineOnConnect: true
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    qrCodeAtual = qr;
                    console.log("📱 NOVO QR CODE GERADO PARA O WHATSAPP!");
                    console.log("👉 Acesse no seu navegador: https://taxi-conecta-api.onrender.com/qr");
                }

                if (connection === 'close') {
                    qrCodeAtual = null;
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log(`🔴 Conexão fechada. Código: ${statusCode}`);

                    if (statusCode === 401 || statusCode === 403 || statusCode === DisconnectReason.loggedOut) {
                        console.log("🧹 Apagando credenciais antigas da pasta sessao_whatsapp...");
                        try {
                            fs.rmSync(PASTA_SESSAO, { recursive: true, force: true });
                        } catch (e) {}
                    }

                    setTimeout(() => conectarWhatsApp(), 5000);
                } else if (connection === 'open') {
                    qrCodeAtual = null;
                    console.log("🟢 WhatsApp do Ponto 2216 CONECTADO COM SUCESSO!");
                }
            });

            sock.ev.on('messages.upsert', async (m) => {
                try {
                    const msg = m.messages[0];
                    if (!msg || msg.key.fromMe || !msg.message) return;

                    if (msg.message.reactionMessage || msg.message.protocolMessage || msg.message.senderKeyDistributionMessage) return;

                    const jid = msg.key.remoteJid;
                    const textoRecebido = (
                        msg.message.conversation ||
                        msg.message.extendedTextMessage?.text ||
                        ''
                    ).trim();
                    const localizacaoRecebida = msg.message.locationMessage || msg.message.liveLocationMessage;

                    if (!textoRecebido && !localizacaoRecebida) return;

                    const textoMinusculo = textoRecebido.toLowerCase();
                    const clienteObj = estadosClientes[jid] || { estado: 'INICIAL' };
                    const estadoAtual = clienteObj.estado;

                    const ehComandoReset = ['menu', 'inicio', 'início', 'voltar', 'oi', 'olá', 'ola', 'taxi', 'táxi', 'ajuda', 'novo'].includes(textoMinusculo);

                    const enviarMsgSegura = async (texto) => {
                        try {
                            await sock.sendMessage(jid, { text: texto });
                        } catch (sendErr) {
                            console.error(`⚠️ Falha ao enviar mensagem para ${jid}:`, sendErr.message);
                        }
                    };

                    const horaAtual = new Date().getHours();
                    if (horaAtual < 5) {
                        await enviarMsgSegura("🌙 Nosso horário de atendimento automático é das 05h00 às 23h59. No momento o Ponto 2216 está fechado.");
                        return;
                    }

                    if (estadoAtual === 'AGUARDANDO_ACEITE_MOTORISTA' && !ehComandoReset) {
                        await enviarMsgSegura(`🚕 *AGUARDANDO CONFIRMAÇÃO*\n\nEstamos aguardando o motorista confirmar a sua viagem. Aguarde só mais um instante...\n\n_(Para cancelar e voltar ao início, digite MENU)_`);
                        return;
                    }

                    // 1. INÍCIO
                    if (estadoAtual === 'INICIAL' || ehComandoReset) {
                        estadosClientes[jid] = { estado: 'AGUARDANDO_NOME' };
                        
                        const msgBoasVindas = 
                            `🚖 *TÁXIS PONTO 2216*\n\n` +
                            `Olá! Seja bem-vindo(a).\n\n` +
                            `Por favor, digite o **seu Nome e Bloco/Apartamento** (ex: *Carlos, Apto 42*):`;

                        await enviarMsgSegura(msgBoasVindas);
                        return;
                    }

                    // 2. RECEBE O NOME/APTO
                    if (estadoAtual === 'AGUARDANDO_NOME') {
                        if (textoRecebido.length < 2) {
                            await enviarMsgSegura(`⚠️ Por favor, digite um nome válido junto com o Bloco/Apto para que o motorista possa te localizar.`);
                            return;
                        }

                        let nomeIdentificado = textoRecebido;
                        estadosClientes[jid] = { 
                            estado: 'AGUARDANDO_OPCAO',
                            nomeCliente: nomeIdentificado 
                        };

                        const menuTexto = 
                            `Perfeito, *${nomeIdentificado}*!\n\n` +
                            `Agora, escolha o local de embarque:\n\n` +
                            `1️⃣ - *Estou no G3 do Carrefour*\n` +
                            `2️⃣ - *Estou em outro endereço* (Rua ou GPS)\n` +
                            `3️⃣ - *Falar com a Central*`;

                        await enviarMsgSegura(menuTexto);
                        return;
                    }

                    if (estadoAtual === 'AGUARDANDO_OPCAO') {
                        let nomeClienteSalvo = clienteObj.nomeCliente || 'Passageiro WhatsApp';

                        if (textoMinusculo === '1' || textoMinusculo.includes('carrefour') || textoMinusculo.includes('g3')) {
                            if (funcaoSolicitarCorrida) {
                                const sucesso = funcaoSolicitarCorrida({
                                    nomeCliente: nomeClienteSalvo,
                                    jidCliente: jid,
                                    sockWhatsApp: sock,
                                    origem: "G3 do Carrefour",
                                    lat: -23.5622,
                                    lon: -46.5614
                                });

                                if (sucesso) {
                                    estadosClientes[jid] = { estado: 'AGUARDANDO_ACEITE_MOTORISTA', nomeCliente: nomeClienteSalvo };
                                    await enviarMsgSegura(`📍 *G3 do Carrefour confirmado, ${nomeClienteSalvo}!*\n\nEstamos aguardando o primeiro táxi da fila confirmar a sua viagem. Aguarde um instante...`);
                                } else {
                                    await enviarMsgSegura(`⚠️ *SEM TÁXIS NA FILA NO MOMENTO*\n\nNão há táxis disponíveis agora. Tente em instantes.`);
                                }
                            }
                            return;
                        }

                        if (textoMinusculo === '2' || textoMinusculo.includes('outro')) {
                            estadosClientes[jid] = { estado: 'AGUARDANDO_LOCALIZACAO', nomeCliente: nomeClienteSalvo };
                            await enviarMsgSegura(`📍 Envie sua **Localização (Pino de GPS)** usando o clipe 📎 do WhatsApp\n\n**OU**\n\n✍️ Digite o endereço completo (ex: *Rua Itapura, 200*).`);
                            return;
                        }

                        if (textoMinusculo === '3' || textoMinusculo.includes('central')) {
                            liberarClienteWhatsApp(jid);
                            await enviarMsgSegura(`📞 *CENTRAL DE ATENDIMENTO - PONTO 2216*\n\nEntre em contato com nossos Fiscais:\n☎️ (11) 2673-8296\n☎️ (11) 2671-1049`);
                            return;
                        }

                        await enviarMsgSegura('❌ Opção inválida. Digite *1* para G3, *2* para outro endereço ou *3* para falar com a Central.');
                        return;
                    }

                    if (estadoAtual === 'FORA_DA_AREA') {
                        if (textoMinusculo === '3' || textoMinusculo.includes('central')) {
                            liberarClienteWhatsApp(jid);
                            await enviarMsgSegura(`📞 *CENTRAL DE ATENDIMENTO - PONTO 2216*\n\n☎️ (11) 2673-8296\n☎️ (11) 2671-1049`);
                        } else {
                            await enviarMsgSegura(`⚠️ Sua localização está fora da área. Digite *3* para falar com a Central ou *MENU* para recomeçar.`);
                        }
                        return;
                    }

                    // 3. LÓGICA DE LOCALIZAÇÃO (Com GPS ou Endereço Digitado)
                    if (estadoAtual === 'AGUARDANDO_LOCALIZACAO') {
                        let nomeClienteSalvo = clienteObj.nomeCliente || 'Passageiro WhatsApp';

                        const validarEEnviar = async (lat, lon, origemTexto) => {
                            const dentroDaArea = verificarDentroDaCerca([lat, lon], fronteiraPonto2216);
                            if (dentroDaArea) {
                                const sucesso = funcaoSolicitarCorrida({
                                    nomeCliente: nomeClienteSalvo,
                                    jidCliente: jid,
                                    sockWhatsApp: sock,
                                    origem: origemTexto,
                                    lat: lat,
                                    lon: lon
                                });
                                if (sucesso) {
                                    estadosClientes[jid] = { estado: 'AGUARDANDO_ACEITE_MOTORISTA', nomeCliente: nomeClienteSalvo };
                                    await enviarMsgSegura(`✅ *Localização aprovada!* ${nomeClienteSalvo}\n\nEstamos aguardando o táxi confirmar a corrida. Aguarde...`);
                                } else {
                                    await enviarMsgSegura(`⚠️ Nenhum táxi disponível na fila no momento.`);
                                }
                            } else {
                                estadosClientes[jid] = { estado: 'FORA_DA_AREA', nomeCliente: nomeClienteSalvo };
                                await enviarMsgSegura(`❌ Desculpe, essa localização está **fora** da nossa área de atendimento.\n\nDigite *3* se precisar falar com a Central ou *MENU* para reiniciar.`);
                            }
                        };

                        // TRATAMENTO DO PINO DE GPS DO WHATSAPP
                        if (localizacaoRecebida && localizacaoRecebida.degreesLatitude && localizacaoRecebida.degreesLongitude) {
                            const lat = localizacaoRecebida.degreesLatitude;
                            const lon = localizacaoRecebida.degreesLongitude;

                            await enviarMsgSegura(`📍 Identificando o endereço da sua localização...`);
                            
                            const enderecoTraduzido = await buscarEnderecoPorCoordenadas(lat, lon);
                            await validarEEnviar(lat, lon, enderecoTraduzido);
                            return;
                        }

                        // TRATAMENTO DO ENDEREÇO DIGITADO EM TEXTO
                        if (textoRecebido.length > 5) {
                            await enviarMsgSegura(`🔍 Buscando o endereço: *${textoRecebido}*...`);
                            const coords = await buscarCoordenadasPorEndereco(textoRecebido);
                            if (coords) {
                                await validarEEnviar(coords.lat, coords.lon, textoRecebido);
                            } else {
                                await enviarMsgSegura(`❌ Não encontramos esse endereço exato.\nPor favor, tente digitar a rua e o número novamente ou envie o Pino de GPS.\n(Ou digite 3 para a Central)`);
                            }
                            return;
                        }

                        await enviarMsgSegura(`📍 Envie sua Localização pelo clipe 📎 OU digite o endereço completo (Rua e Número).`);
                        return;
                    }

                } catch (err) {
                    console.error('Erro ao processar mensagem do WhatsApp:', err);
                }
            });
        } catch (erroGeral) {
            console.error('Erro ao conectar ao WhatsApp:', erroGeral);
            setTimeout(() => { conectarWhatsApp(); }, 5000);
        }
    }

    conectarWhatsApp();
}

module.exports = { 
    iniciarBotWhatsApp, 
    liberarClienteWhatsApp,
    verificarDentroDaCerca,
    fronteiraPonto2216,
    obterQrCodeAtual
};