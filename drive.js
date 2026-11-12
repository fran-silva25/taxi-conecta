const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

let auth;

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

// ID da pasta principal compartilhada no seu Google Drive
const PASTA_PRINCIPAL_ID = '1Qsf1LQFKG9MNdpCjZCnNNpO59N1klgCV'; 

async function enviarAudioParaDrive(caminhoArquivoLocal, nomeArquivo) {
    try {
        // Envia o arquivo direto para a pasta compartilhada (evita erro de cota de subpastas)
        const fileMetadata = {
            name: nomeArquivo,
            parents: [PASTA_PRINCIPAL_ID]
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

        // Torna o áudio legível para o player do aplicativo
        await driveService.permissions.create({
            fileId: response.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        console.log('✔ Áudio enviado com sucesso direto para a pasta do Drive!');

        // Remove o arquivo temporário local
        try { fs.unlinkSync(caminhoArquivoLocal); } catch (e) {}

        const linkBaixar = response.data.webContentLink || `https://drive.google.com/uc?export=download&id=${response.data.id}`;

        return {
            fileId: response.data.id,
            audioUrl: linkBaixar
        };
    } catch (error) {
        console.error('❌ Erro ao enviar áudio para o Google Drive:', error);
        return null;
    }
}

module.exports = { enviarAudioParaDrive };