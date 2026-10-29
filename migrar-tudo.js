const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrarTudo() {
  try {
    console.log('🚀 Iniciando migração completa para o PostgreSQL (Render)...');

    // 0. Garantir que todas as tabelas essenciais existem
    await db.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
          id SERIAL PRIMARY KEY,
          nome VARCHAR(150) NOT NULL,
          telefone VARCHAR(20) UNIQUE NOT NULL,
          email VARCHAR(150),
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

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

      CREATE TABLE IF NOT EXISTS recusas (
          id SERIAL PRIMARY KEY,
          corrida_id INT REFERENCES corridas(id),
          motorista_id INT REFERENCES motoristas(id),
          motivo TEXT,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS administradores (
          id SERIAL PRIMARY KEY,
          usuario VARCHAR(100) UNIQUE NOT NULL,
          senha_hash VARCHAR(255) NOT NULL,
          cargo VARCHAR(50) DEFAULT 'ADM',
          nome VARCHAR(150),
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS historico_ptt (
          id SERIAL PRIMARY KEY,
          motorista_id INT REFERENCES motoristas(id),
          drive_file_id VARCHAR(255) NOT NULL,
          audio_url TEXT NOT NULL,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✔ Estrutura de tabelas verificada/criada com sucesso.');

    // 1. Migrar Frota / Motoristas
    const caminhoFrota = path.join(__dirname, 'frota_cadastrada.json');
    if (fs.existsSync(caminhoFrota)) {
      const bruto = fs.readFileSync(caminhoFrota, 'utf8');
      if (bruto.trim() !== '') {
        const json = JSON.parse(bruto);
        const lista = Array.isArray(json) ? json : Object.values(json);
        for (const m of lista) {
          const nome = m.nome || m.motorista || 'Motorista Ponto 2216';
          const telefone = m.telefone || m.tel || m.celular || '00000000000';
          const prefixo = m.prefixo || m.taxi || '2216';
          const senha = m.senha || '123456';
          const ponto = m.ponto || 'PH';

          await db.query(`
            INSERT INTO motoristas (nome, telefone, prefixo_taxi, senha_hash, ponto_atual, disponivel)
            VALUES ($1, $2, $3, $4, $5, false)
            ON CONFLICT (telefone) DO NOTHING;
          `, [nome, telefone, prefixo, senha, ponto]);
        }
        console.log('✔ Motoristas (frota_cadastrada.json) migrados.');
      }
    }

    // 2. Migrar Histórico de Corridas
    const caminhoCorridas = path.join(__dirname, 'historico_corridas.json');
    if (fs.existsSync(caminhoCorridas)) {
      const bruto = fs.readFileSync(caminhoCorridas, 'utf8');
      if (bruto.trim() !== '') {
        const json = JSON.parse(bruto);
        const lista = Array.isArray(json) ? json : Object.values(json);
        for (const c of lista) {
          await db.query(`
            INSERT INTO corridas (origem_endereco, destino_endereco, valor, status, audio_url)
            VALUES ($1, $2, $3, $4, $5)
          `, [c.origem || 'Origem não informada', c.destino || 'Destino não informado', c.valor || 0.00, c.status || 'CONCLUIDA', c.audioUrl || null]);
        }
        console.log('✔ Histórico de corridas migrado.');
      }
    }

    // 3. Migrar Histórico de Recusas
    const caminhoRecusas = path.join(__dirname, 'historico_recusas.json');
    if (fs.existsSync(caminhoRecusas)) {
      const bruto = fs.readFileSync(caminhoRecusas, 'utf8');
      if (bruto.trim() !== '') {
        const json = JSON.parse(bruto);
        const lista = Array.isArray(json) ? json : Object.values(json);
        for (const r of lista) {
          const motivo = r.motivo || r.razao || 'Recusa não especificada';
          await db.query(`
            INSERT INTO recusas (motivo) VALUES ($1)
          `, [motivo]);
        }
        console.log('✔ Histórico de recusas migrado.');
      }
    }

    // 4. Migrar Usuários Administradores / Fiscais (usuarios_adm.json)
    const caminhoAdm = path.join(__dirname, 'usuarios_adm.json');
    if (fs.existsSync(caminhoAdm)) {
      const bruto = fs.readFileSync(caminhoAdm, 'utf8');
      if (bruto.trim() !== '') {
        const json = JSON.parse(bruto);
        const listaAdms = Object.values(json);
        for (const a of listaAdms) {
          const usuario = a.usuario;
          const senha = a.senha;
          const cargo = a.cargo || 'ADM';
          const nome = a.nome || 'Administrador';

          if (usuario && senha) {
            await db.query(`
              INSERT INTO administradores (usuario, senha_hash, cargo, nome)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (usuario) DO UPDATE 
              SET senha_hash = EXCLUDED.senha_hash, cargo = EXCLUDED.cargo, nome = EXCLUDED.nome;
            `, [usuario, senha, cargo, nome]);
          }
        }
        console.log('✔ Administradores e Fiscais (usuarios_adm.json) migrados.');
      }
    }

    console.log('🎉 Migração completa finalizada com sucesso!');
    process.exit(0);
  } catch (erro) {
    console.error('❌ Erro durante a migração completa:', erro);
    process.exit(1);
  }
}

migrarTudo();