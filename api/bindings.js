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

            // 同步到 GitHub：将 codes.json 中的 boundDeviceId/boundAt 置空
            const wr = await writeBackAllToGitHubClear();
            if (!wr.updated) {
                console.warn('[bindings] clear writeback failed:', wr.error);
            }
            return res.end(JSON.stringify({ ok: true, message: '所有设备绑定已清空', writeback: !!wr.updated }));
            
        } else if (action === 'unbind') {
            // 解绑特定激活码
            const { code } = req.query || {};
            
            if (!code) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ ok: false, message: '缺少激活码' }));
            }
            
            const bindingKey = `binding_${code}`;
            if (deviceBindings[bindingKey]) delete deviceBindings[bindingKey];

            // 同步到 GitHub：将该激活码的绑定清空
            const wr = await writeBackUnbindToGitHub(code);
            if (!wr.updated) {
                console.warn('[bindings] unbind writeback failed:', wr.error);
            }
            return res.end(JSON.stringify({ ok: !!wr.updated, message: wr.updated ? `激活码 ${code} 已解绑` : (wr.error || '写回失败') }));
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


// ===== GitHub 写回工具，与 verify.js 保持一致变量名 =====
async function fetchCodesFile() {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER || process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO || process.env.GITHUB_REPO_NAME;
    const filePath = process.env.CODES_FILE_PATH || process.env.GITHUB_FILE_PATH || 'api/codes.json';
    const branch = process.env.GITHUB_BRANCH || 'main';
    if (!token || !owner || !repo) return { ok:false, error:'missing env' };
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`;
    const resp = await fetch(url, { headers: { 'Authorization': `token ${token}`, 'Accept':'application/vnd.github+json', 'User-Agent':'temu-license-server' } });
    if (!resp.ok) return { ok:false, error:`get ${resp.status}` };
    const j = await resp.json();
    const sha = j.sha;
    const decoded = Buffer.from(j.content||'', 'base64').toString('utf8');
    let parsed = {};
    try { parsed = JSON.parse(decoded); } catch (e) { return { ok:false, error:'json parse fail' }; }
    if (!Array.isArray(parsed.codes)) parsed.codes = [];
    return { ok:true, sha, data:parsed, filePath, branch, token, owner, repo };
}

async function putCodesFile(context, data) {
    const { token, owner, repo, filePath, branch, sha } = context;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`;
    const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64');
    const resp = await fetch(url, { method:'PUT', headers:{ 'Authorization':`token ${token}`, 'Accept':'application/vnd.github+json', 'User-Agent':'temu-license-server', 'Content-Type':'application/json' }, body: JSON.stringify({ message:'chore: unbind update', content, sha, branch }) });
    if (!resp.ok) return { ok:false, error:`put ${resp.status}` };
    return { ok:true };
}

async function writeBackUnbindToGitHub(code) {
    try {
        const ctx = await fetchCodesFile();
        if (!ctx.ok) return { updated:false, error:ctx.error };
        const idx = ctx.data.codes.findIndex(c => c.code === code);
        if (idx < 0) return { updated:false, error:'code not found' };
        ctx.data.codes[idx].boundDeviceId = null;
        ctx.data.codes[idx].boundAt = null;
        const put = await putCodesFile(ctx, ctx.data);
        if (!put.ok) return { updated:false, error:put.error };
        return { updated:true };
    } catch (e) { return { updated:false, error:String(e && e.message || e) }; }
}

async function writeBackAllToGitHubClear() {
    try {
        const ctx = await fetchCodesFile();
        if (!ctx.ok) return { updated:false, error:ctx.error };
        ctx.data.codes = ctx.data.codes.map(c => ({ ...c, boundDeviceId: null, boundAt: null }));
        const put = await putCodesFile(ctx, ctx.data);
        if (!put.ok) return { updated:false, error:put.error };
        return { updated:true };
    } catch (e) { return { updated:false, error:String(e && e.message || e) }; }
}

