const fs = require('fs');
const path = require('path');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
    }
    
    try {
        // 禁止缓存，确保监控与管理页拿到最新写回
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        const { codes, total, tried } = readCodesWithDebug();
        return res.status(200).json({ ok: true, total, codes, tried });
    } catch (err) {
        console.error('status error:', err);
        return res.status(500).json({ ok: false, message: '服务器错误', debug: String(err && err.message || err) });
    }
}

module.exports.config = { runtime: 'nodejs18.x' };

function readCodesWithDebug() {
    const candidates = [
        path.join(__dirname, 'codes.json'),
        path.join(__dirname, '..', 'codes.json'),
        path.join(process.cwd(), 'codes.json')
    ];
    const tried = [];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                const raw = fs.readFileSync(p, 'utf8');
                const parsed = JSON.parse(raw);
                const codes = Array.isArray(parsed.codes) ? parsed.codes : [];
                return { codes, total: codes.length, tried: [...tried, { path: p, ok: true }] };
            } else {
                tried.push({ path: p, ok: false, reason: 'not exists' });
            }
        } catch (e) {
            tried.push({ path: p, ok: false, reason: String(e && e.message || e) });
        }
    }
    const err = new Error('codes.json 未找到或读取失败: ' + JSON.stringify(tried));
    throw err;
}
