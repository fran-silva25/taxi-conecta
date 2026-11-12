const { Pool } = require('pg');

const pool = new Pool({
  // Usando a URL de conexão externa completa do seu banco no Render
  connectionString: 'postgresql://taxiconectadb_user:qVNbQc8tgZXwZ4yhjM4HHMGAO7dB0ckI@dpg-dbh8l5m1egvs73er64hg-a.ohio-postgres.render.com/taxiconectadb',
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};