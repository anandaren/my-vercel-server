const fs = require('fs');
const path = require('path');

// 内存中的设备绑定存储（在实际应用中应该使用数据库）
let deviceBindings = {};

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
        const { code = '', deviceId = '' } = req.method === 'POST' ? (await readBody(req)) : (req.query || {});
        res.setHeader('content-type', 'application/json; charset=utf-8');

        if (!code || typeof code !== 'string') {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, message: '缺少激活码' }));
        }

        if (!deviceId || typeof deviceId !== 'string') {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, message: '缺少设备ID' }));
        }

        const { codes } = readCodes();
        const now = Date.now();
        const record = codes.find(c => c.code === code);

        if (!record) {
            return res.end(JSON.stringify({ ok: false, message: '激活码不存在' }));
        }
        if (record.active === false) {
            return res.end(JSON.stringify({ ok: false, message: '激活码已停用' }));
        }
        if (record.expiresAt && Date.parse(record.expiresAt) < now) {
            return res.end(JSON.stringify({ ok: false, message: '激活码已过期' }));
        }

        // 检查设备绑定（使用内存存储）
        const bindingKey = `binding_${code}`;
        const existingBinding = deviceBindings[bindingKey];
        
        if (existingBinding) {
            if (existingBinding.deviceId === deviceId) {
                // 同一设备，允许激活
                return res.end(JSON.stringify({
                    ok: true,
                    message: '激活成功',
                    meta: { 
                        expiresAt: record.expiresAt || null, 
                        note: record.note || '',
                        boundDeviceId: existingBinding.deviceId,
                        isNewDevice: false
                    }
                }));
            } else {
                // 不同设备，拒绝激活
                return res.end(JSON.stringify({ 
                    ok: false, 
                    message: '激活码已被其他设备使用，请联系管理员' 
                }));
            }
        } else {
            // 首次激活，绑定设备
            deviceBindings[bindingKey] = {
                deviceId: deviceId,
                boundAt: new Date().toISOString(),
                code: code
            };
            
            console.log('设备绑定已创建:', { code, deviceId, boundAt: deviceBindings[bindingKey].boundAt });
            
            return res.end(JSON.stringify({
                ok: true,
                message: '激活成功',
                meta: { 
                    expiresAt: record.expiresAt || null, 
                    note: record.note || '',
                    boundDeviceId: deviceId,
                    isNewDevice: true
                }
            }));
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

async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
