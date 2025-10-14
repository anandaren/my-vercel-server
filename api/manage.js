const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  try {
    // CORS 设置
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('content-type', 'application/json; charset=utf-8');
    
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    const codesFile = path.join(__dirname, 'codes.json');
    
    // 读取现有激活码
    function readCodes() {
      try {
        if (!fs.existsSync(codesFile)) {
          return { codes: [] };
        }
        const raw = fs.readFileSync(codesFile, 'utf8');
        const parsed = JSON.parse(raw);
        return { codes: Array.isArray(parsed.codes) ? parsed.codes : [] };
      } catch (e) {
        return { codes: [] };
      }
    }
    
    // 写入激活码
    function writeCodes(data) {
      fs.writeFileSync(codesFile, JSON.stringify(data, null, 2), 'utf8');
    }
    
    // 生成随机激活码
    function generateCode(prefix = 'VIP') {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = prefix + '-';
      for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }
    
    const { action } = req.query || {};
    
    if (action === 'list') {
      // 获取激活码列表
      const { codes } = readCodes();
      return res.end(JSON.stringify({ 
        ok: true, 
        codes: codes,
        total: codes.length,
        active: codes.filter(c => c.active && (!c.expiresAt || Date.parse(c.expiresAt) > Date.now())).length,
        expired: codes.filter(c => c.expiresAt && Date.parse(c.expiresAt) <= Date.now()).length
      }));
      
    } else if (action === 'generate') {
      // 生成新激活码
      const { prefix = 'VIP', count = 1, expiryDays = 30, note = '' } = req.method === 'POST' ? 
        (await readBody(req)) : (req.query || {});
      
      const { codes } = readCodes();
      const newCodes = [];
      
      for (let i = 0; i < parseInt(count); i++) {
        let code;
        let attempts = 0;
        do {
          code = generateCode(prefix);
          attempts++;
        } while (codes.some(c => c.code === code) && attempts < 100);
        
        if (attempts >= 100) {
          return res.end(JSON.stringify({ 
            ok: false, 
            message: '无法生成唯一激活码，请尝试不同前缀' 
          }));
        }
        
        const expiryDate = parseInt(expiryDays) > 0 ? 
          new Date(Date.now() + parseInt(expiryDays) * 24 * 60 * 60 * 1000).toISOString() : 
          null;
        
        newCodes.push({
          code: code,
          note: note || `${prefix}激活码-${new Date().toLocaleDateString()}`,
          expiresAt: expiryDate,
          active: true,
          createdAt: new Date().toISOString()
        });
      }
      
      // 添加到现有激活码
      codes.push(...newCodes);
      writeCodes({ codes });
      
      return res.end(JSON.stringify({ 
        ok: true, 
        message: `成功生成 ${count} 个激活码`,
        codes: newCodes.map(c => c.code)
      }));
      
    } else if (action === 'toggle') {
      // 启用/禁用激活码
      const { code, active } = req.method === 'POST' ? 
        (await readBody(req)) : (req.query || {});
      
      if (!code) {
        return res.end(JSON.stringify({ ok: false, message: '缺少激活码' }));
      }
      
      const { codes } = readCodes();
      const index = codes.findIndex(c => c.code === code);
      
      if (index === -1) {
        return res.end(JSON.stringify({ ok: false, message: '激活码不存在' }));
      }
      
      codes[index].active = active === 'true' || active === true;
      writeCodes({ codes });
      
      return res.end(JSON.stringify({ 
        ok: true, 
        message: `激活码 ${code} ${codes[index].active ? '已启用' : '已禁用'}` 
      }));
      
    } else if (action === 'delete') {
      // 删除激活码
      const { code } = req.method === 'POST' ? 
        (await readBody(req)) : (req.query || {});
      
      if (!code) {
        return res.end(JSON.stringify({ ok: false, message: '缺少激活码' }));
      }
      
      const { codes } = readCodes();
      const filteredCodes = codes.filter(c => c.code !== code);
      
      if (filteredCodes.length === codes.length) {
        return res.end(JSON.stringify({ ok: false, message: '激活码不存在' }));
      }
      
      writeCodes({ codes: filteredCodes });
      
      return res.end(JSON.stringify({ 
        ok: true, 
        message: `激活码 ${code} 已删除` 
      }));
      
    } else {
      // 默认返回状态信息
      const { codes } = readCodes();
      const now = Date.now();
      
      return res.end(JSON.stringify({ 
        ok: true, 
        total: codes.length,
        active: codes.filter(c => c.active && (!c.expiresAt || Date.parse(c.expiresAt) > now)).length,
        expired: codes.filter(c => c.expiresAt && Date.parse(c.expiresAt) <= now).length,
        codes: codes.map(c => ({
          code: c.code,
          note: c.note,
          expiresAt: c.expiresAt,
          active: c.active,
          createdAt: c.createdAt
        }))
      }));
    }
    
  } catch (err) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.statusCode = 500;
    return res.end(JSON.stringify({ 
      ok: false, 
      message: '服务器错误', 
      debug: String(err && err.message || err) 
    }));
  }
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { 
    return JSON.parse(Buffer.concat(chunks).toString('utf8')); 
  } catch { 
    return {}; 
  }
}

