const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

let auth;

// Se estiver na nuvem (Render), lê da variável de ambiente. Se estiver local, lê do arquivo.
if (process.env.GOOGLE_CREDENTIALS_JSON) {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
} else {
  const KEYFILEPATH = path.join(__dirname, 'credenciais-drive.json');
  auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: SCOPES,
  });
}

const driveService = google.drive({ version: 'v3', auth });

// ID corrigido exato da pasta "Audios_TaxiConecta_PTT"
const PASTA_PRINCIPAL_ID = '1Qsf1LQFKG9MNdpCjZCnNNpO59N1klgCV'; 

// Função auxiliar para criar ou buscar pasta de Ano/Mês/Dia automaticamente no Drive
async function obterOuCriarPasta(nomePasta, pastaPaiId) {
  try {
    const query = `name='${nomePasta}' and '${pastaPaiId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await driveService.files.list({ q: query, fields: 'files(id, name)' });
    
    if (res.data.files.length > 0) {
      return res.data.files[0].id;
    }

    const fileMetadata = {
      name: nomePasta,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [pastaPaiId],
    };
    const folder = await driveService.files.create({ resource: fileMetadata, fields: 'id' });
    return folder.data.id;
  } catch (e) {
    console.error('Erro ao gerenciar pasta no Drive:', e);
    return pastaPaiId;
  }
}

async function enviarAudioParaDrive(caminhoArquivoLocal, nomeArquivo) {
  try {
    // Organiza as pastas automaticamente por Ano -> Mês -> Dia (ex: 2026 / 10 / 29)
    const agora = new Date();
    const ano = String(agora.getFullYear());
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const dia = String(agora.getDate()).padStart(2, '0');

    const idPastaAno = await obterOuCriarPasta(ano, PASTA_PRINCIPAL_ID);
    const idPastaMes = await obterOuCriarPasta(mes, idPastaAno);
    const idPastaDia = await obterOuCriarPasta(dia, idPastaMes);

    const fileMetadata = {
      name: nomeArquivo,
      parents: [idPastaDia],
    };

    const media = {
      mimeType: 'audio/webm',
      body: fs.createReadStream(caminhoArquivoLocal),
    };

    const response = await driveService.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink',
    });

    await driveService.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    console.log('✔ Áudio enviado e organizado no Google Drive com sucesso!');
    
    // Remove o arquivo temporário local após o envio com sucesso
    try { fs.unlinkSync(caminhoArquivoLocal); } catch (e) {}

    return {
      fileId: response.data.id,
      audioUrl: response.data.webContentLink || response.data.webViewLink
    };
  } catch (error) {
    console.error('❌ Erro ao enviar áudio para o Google Drive:', error);
    return null;
  }
}

// Função para apagar áudios do Drive com mais de 30 dias (reciclagem de espaço)
async function limparAudiosAntigosDrive() {
  try {
    const trintaDiasAtras = new Date();
    trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
    const dataIso = trintaDiasAtras.toISOString();

    const query = `'${PASTA_PRINCIPAL_ID}' in parents and createdTime < '${dataIso}' and trashed=false`;
    const res = await driveService.files.list({ q: query, fields: 'files(id, name)' });

    for (const file of res.data.files) {
      await driveService.files.delete({ fileId: file.id });
      console.log(`🗑️ Áudio antigo reciclado do Drive: ${file.name}`);
    }
  } catch (e) {
    console.error('Erro na limpeza automática do Drive:', e);
  }
}

// Executa a faxina de áudios antigos no Drive uma vez por dia
setInterval(limparAudiosAntigosDrive, 24 * 60 * 60 * 1000);

module.exports = { enviarAudioParaDrive };