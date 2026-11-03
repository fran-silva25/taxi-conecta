const db = require('./db');

async function limparCarro36() {
    try {
        await db.query("DELETE FROM motoristas WHERE numero = '36' OR login = 'Carro.36'");
        console.log("✅ Registo do Carro 36 limpo com sucesso da base de dados!");
        process.exit(0);
    } catch (e) {
        console.error("❌ Erro:", e);
        process.exit(1);
    }
}

limparCarro36();