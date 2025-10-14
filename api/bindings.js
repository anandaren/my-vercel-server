const fs = require('fs');
const path = require('path');

// 内存中的设备绑定存储（与verify-fixed.js共享）
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
        res.setHeader('content-type', 'application/json; charset=utf-8');
        
        const { action = 'list' } = req.query || {};
        
        if (action === 'list') {
            // 获取所有设备绑定信息
            const bindings = Object.values(deviceBindings);
            
            return res.end(JSON.stringify({
                ok: true,
                total: bindings.length,
                bindings: bindings
            }));
            
        } else if (action === 'clear') {
            // 清空所有绑定（用于测试）
            deviceBindings = {};
            
            return res.end(JSON.stringify({
                ok: true,
                message: '所有设备绑定已清空'
            }));
            
        } else if (action === 'unbind') {
            // 解绑特定激活码
            const { code } = req.query || {};
            
            if (!code) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ ok: false, message: '缺少激活码' }));
            }
            
            const bindingKey = `binding_${code}`;
            if (deviceBindings[bindingKey]) {
                delete deviceBindings[bindingKey];
                return res.end(JSON.stringify({
                    ok: true,
                    message: `激活码 ${code} 已解绑`
                }));
            } else {
                return res.end(JSON.stringify({
                    ok: false,
                    message: '激活码未绑定设备'
                }));
            }
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

