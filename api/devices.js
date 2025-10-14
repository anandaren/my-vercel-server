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
        res.setHeader('content-type', 'application/json; charset=utf-8');
        
        const { action = 'list' } = req.query || {};
        
        if (action === 'list') {
            // 获取所有设备绑定信息
            const { codes } = readCodes();
            const boundCodes = codes.filter(c => c.boundDeviceId);
            
            const deviceInfo = boundCodes.map(code => ({
                code: code.code,
                note: code.note,
                boundDeviceId: code.boundDeviceId,
                boundAt: code.boundAt,
                expiresAt: code.expiresAt,
                active: code.active
            }));
            
            return res.end(JSON.stringify({
                ok: true,
                total: boundCodes.length,
                devices: deviceInfo
            }));
            
        } else if (action === 'unbind') {
            // 解绑设备
            const { code } = req.query || {};
            
            if (!code) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ ok: false, message: '缺少激活码' }));
            }
            
            const { codes } = readCodes();
            const record = codes.find(c => c.code === code);
            
            if (!record) {
                return res.end(JSON.stringify({ ok: false, message: '激活码不存在' }));
            }
            
            if (!record.boundDeviceId) {
                return res.end(JSON.stringify({ ok: false, message: '激活码未绑定设备' }));
            }
            
            // 解绑设备
            const oldDeviceId = record.boundDeviceId;
            delete record.boundDeviceId;
            delete record.boundAt;
            
            // 保存更新
            try {
                const codesData = { codes };
                fs.writeFileSync(path.join(__dirname, 'codes.json'), JSON.stringify(codesData, null, 2), 'utf8');
            } catch (writeErr) {
                console.error('保存解绑信息失败:', writeErr);
            }
            
            return res.end(JSON.stringify({
                ok: true,
                message: '设备解绑成功',
                unboundDeviceId: oldDeviceId
            }));
            
        } else if (action === 'rebind') {
            // 重新绑定设备
            const { code, newDeviceId } = req.query || {};
            
            if (!code || !newDeviceId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ ok: false, message: '缺少激活码或新设备ID' }));
            }
            
            const { codes } = readCodes();
            const record = codes.find(c => c.code === code);
            
            if (!record) {
                return res.end(JSON.stringify({ ok: false, message: '激活码不存在' }));
            }
            
            // 重新绑定设备
            const oldDeviceId = record.boundDeviceId;
            record.boundDeviceId = newDeviceId;
            record.boundAt = new Date().toISOString();
            
            // 保存更新
            try {
                const codesData = { codes };
                fs.writeFileSync(path.join(__dirname, 'codes.json'), JSON.stringify(codesData, null, 2), 'utf8');
            } catch (writeErr) {
                console.error('保存重新绑定信息失败:', writeErr);
            }
            
            return res.end(JSON.stringify({
                ok: true,
                message: '设备重新绑定成功',
                oldDeviceId: oldDeviceId,
                newDeviceId: newDeviceId
            }));
            
        } else {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, message: '无效的操作' }));
        }
        
    } catch (err) {
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.statusCode = 500;
        return res.end(JSON.stringify({ 
            ok: false, 
            message: '服务器错误', 
            debug: String(err && err.message || err) 
        }));
    }
};

function readCodes() {
    const filePath = path.join(__dirname, 'codes.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { codes: Array.isArray(parsed.codes) ? parsed.codes : [] };
}

