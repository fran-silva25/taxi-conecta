const db = require('./db');

async function criarTabelas() {
  try {
    console.log('Conectando ao banco de dados e criando as tabelas...');

    // 1. Tabela de Usuários / Passageiros
    await db.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
          id SERIAL PRIMARY KEY,
          nome VARCHAR(150) NOT NULL,
          telefone VARCHAR(20) UNIQUE NOT NULL,
          email VARCHAR(150),
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Tabela de Motoristas (com senha e status)
    await db.query(`
      CREATE TABLE IF NOT EXISTS motoristas (
          id SERIAL PRIMARY KEY,
          nome VARCHAR(150) NOT NULL,
          telefone VARCHAR(20) UNIQUE NOT NULL,
          prefixo_taxi VARCHAR(20),
          senha_hash VARCHAR(255) NOT NULL,
      ponto_atual VARCHAR(10) DEFAULT 'PH',
          disponivel BOOLEAN DEFAULT FALSE,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Tabela de Corridas Efetivadas
    await db.query(`
      CREATE TABLE IF NOT EXISTS corridas (
          id SERIAL PRIMARY KEY,
          usuario_id INT REFERENCES usuarios(id),
          motorista_id INT REFERENCES motoristas(id),
          origem_endereco TEXT NOT NULL,
          destino_endereco TEXT NOT NULL,
          valor DECIMAL(10, 2),
          status VARCHAR(50) DEFAULT 'SOLICITADA',
          audio_url TEXT,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Tabela de Recusas
    await db.query(`
      CREATE TABLE IF NOT EXISTS recusas (
          id SERIAL PRIMARY KEY,
          corrida_id INT REFERENCES corridas(id),
          motorista_id INT REFERENCES motoristas(id),
          motivo TEXT,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Sucesso! Todas as tabelas foram criadas no banco de dados do Render!');
    process.exit(0);
  } catch (erro) {
    console.error('Erro ao criar as tabelas:', erro);
    process.exit(1);
  }
}

criarTabelas();