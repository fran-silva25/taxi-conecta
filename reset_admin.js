const pool = require('./db');

async function resetarAdmin() {
  try {
    const query = `
      INSERT INTO administradores (usuario, senha, senha_hash, nome, cargo) 
      VALUES ('fran.sps', '192527', '192527', 'Franklin', 'ADM')
      ON CONFLICT (usuario) DO UPDATE SET 
        senha = '192527', 
        senha_hash = '192527', 
        cargo = 'ADM';
    `;
    await pool.query(query);
    console.log("✅ Administrador fran.sps atualizado com sucesso com a senha 192527!");
  } catch (err) {
    console.error("Erro ao atualizar administrador:", err);
  } finally {
    process.exit(0);
  }
}

resetarAdmin();