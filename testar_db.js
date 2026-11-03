const db = require('./db');

async function verificarBanco() {
    try {
        console.log("A testar a ligação à base de dados do Render...");
        
        // Verifica as tabelas existentes no banco
        const tabelas = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        
        console.log("📊 Tabelas encontradas na base de dados:");
        console.table(tabelas.rows);

        // Se houver alguma tabela de frota ou utilizadores, podemos listar os dados
        // Exemplo: const frotaDb = await db.query('SELECT * FROM frota');
        // console.log("🚗 Registos na frota:", frotaDb.rows);

    } catch (e) {
        console.error("❌ Erro ao conectar ou consultar a base de dados:", e);
    }
}

verificarBanco();