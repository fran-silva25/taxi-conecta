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

        console.log("Tabelas encontradas na base de dados:");
        console.table(tabelas.rows);

        // Consulta os motoristas e senhas gravadas
        const motoristas = await db.query('SELECT numero, nome, login, senha FROM motoristas ORDER BY numero ASC');
        console.log("Motoristas e senhas cadastradas no banco:");
        console.table(motoristas.rows);

    } catch (e) {
        console.error("Erro ao conectar ou consultar o banco:", e);
    } finally {
        process.exit(0);
    }
}

verificarBanco();