const db = require('./db');

async function popularAdms() {
    try {
        console.log("A inserir administradores na coluna correta (senha_hash)...");
        
        await db.query(`
            INSERT INTO administradores (usuario, senha_hash, nome, cargo)
            VALUES 
                ('adm', '123', 'Administrador Geral', 'ADM'),
                ('fiscal', '123', 'Fiscal de Ponto', 'FISCAL'),
                ('fran.sps', 'fran2519', 'Franklin', 'ADM')
            ON CONFLICT (usuario) DO UPDATE SET
                senha_hash = EXCLUDED.senha_hash,
                nome = EXCLUDED.nome,
                cargo = EXCLUDED.cargo;
        `);

        console.log("✅ Administradores cadastrados com sucesso na BD em nuvem!");
        process.exit(0);
    } catch (e) {
        console.error("❌ Erro ao popular administradores:", e);
        process.exit(1);
    }
}

popularAdms();