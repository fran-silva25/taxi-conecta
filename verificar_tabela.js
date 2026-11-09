const pool = require('./db'); // Aproveita a conexão já existente no projeto

async function verificarEstrutura() {
  try {
    const query = `
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'administradores';
    `;
    const res = await pool.query(query);
    console.log("Colunas da tabela 'administradores':");
    console.table(res.rows);
  } catch (err) {
    console.error("Erro ao consultar o banco:", err);
  } finally {
    process.exit(0);
  }
}

verificarEstrutura();