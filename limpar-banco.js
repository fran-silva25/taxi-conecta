const db = require('./db');

async function limparTudo() {
  try {
    console.log('🧹 Removendo todas as tabelas antigas do banco de dados...');

    // O comando CASCADE apaga as tabelas e remove todas as dependências (chaves estrangeiras)
    await db.query(`
      DROP TABLE IF EXISTS historico_ptt CASCADE;
      DROP TABLE IF EXISTS recusas CASCADE;
      DROP TABLE IF EXISTS corridas CASCADE;
      DROP TABLE IF EXISTS administradores CASCADE;
      DROP TABLE IF EXISTS motoristas CASCADE;
      DROP TABLE IF EXISTS usuarios CASCADE;
    `);

    console.log('✔ Banco de dados limpo com sucesso! Todas as tabelas foram removidas.');
    process.exit(0);
  } catch (erro) {
    console.error('❌ Erro ao limpar o banco de dados:', erro);
    process.exit(1);
  }
}

limparTudo();