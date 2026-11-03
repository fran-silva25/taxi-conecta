// reset_banco.js
const db = require('./db');

async function resetarTabelaMotoristas() {
    try {
        console.log("⚠️ INICIANDO RESET COMPLETO DA TABELA DE MOTORISTAS...");

        // 1. Apaga a tabela antiga com defeito ou estrutura incorreta
        await db.query(`DROP TABLE IF EXISTS motoristas CASCADE;`);
        console.log("🗑️ Tabela 'motoristas' antiga apagada com sucesso.");

        // 2. Cria a tabela nova do zero com todas as colunas corretas (incluindo 'senha')
        await db.query(`
            CREATE TABLE motoristas (
                numero VARCHAR(50) PRIMARY KEY,
                placa VARCHAR(20),
                login VARCHAR(100),
                nome VARCHAR(150),
                modelo VARCHAR(100),
                cargo VARCHAR(50),
                telefones JSONB,
                senha VARCHAR(255),
                eh_moderador BOOLEAN DEFAULT FALSE,
                status_radio VARCHAR(50) DEFAULT 'ONLINE',
                mutado_ate BIGINT,
                banido_ate BIGINT,
                bloqueio_recusa BOOLEAN DEFAULT FALSE
            );
        `);
        console.log("✅ Tabela 'motoristas' recriada do zero com a estrutura perfeita e coluna 'senha'!");
        process.exit(0);
    } catch (erro) {
        console.error("❌ Erro ao recriar o banco de dados:", erro);
        process.exit(1);
    }
}

resetarTabelaMotoristas();