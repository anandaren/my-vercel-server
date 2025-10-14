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

            // 方案B：将绑定信息回写到 GitHub 仓库中的 codes.json
            try {
                const { updated, error } = await writeBackBindingToGitHub({ code, deviceId, boundAt: deviceBindings[bindingKey].boundAt });
                if (!updated) {
                    console.warn('[verify] GitHub 回写未完成:', error || 'unknown error');
                }
            } catch (e) {
                console.warn('[verify] GitHub 回写异常:', String(e && e.message || e));
            }
            
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

// === 方案B：回写 GitHub ===
async function writeBackBindingToGitHub({ code, deviceId, boundAt }) {
    // 必需环境变量
    const token = process.env.GITHUB_TOKEN;
    // 与 Vercel 中配置的变量名对齐
    const owner = process.env.GITHUB_OWNER || process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO || process.env.GITHUB_REPO_NAME;
    const filePath = process.env.CODES_FILE_PATH || process.env.GITHUB_FILE_PATH || 'api/codes.json';
    const branch = process.env.GITHUB_BRANCH || 'main';

    if (!token || !owner || !repo) {
        return { updated: false, error: `缺少必要环境变量: token=${!!token}, owner=${owner||''}, repo=${repo||''}` };
    }

    try {
        // 1) 获取当前文件（拿到 sha）
        const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`;
        console.log('[verify] github.get start', { path: filePath, branch });
        const getResp = await fetch(getUrl, {
            headers: {
                // GitHub 接受 "token" 或 "Bearer"；统一用 token 以提升兼容性
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'temu-license-server'
            }
        });
        console.log('[verify] github.get resp', getResp.status, getResp.statusText);
        if (!getResp.ok) {
            const t = await getResp.text();
            return { updated: false, error: `获取文件失败: ${getResp.status} ${getResp.statusText}; path=${filePath}; branch=${branch}; body=${t}` };
        }
        const getJson = await getResp.json();
        const sha = getJson.sha;
        const decoded = Buffer.from(getJson.content || '', 'base64').toString('utf8');
        let parsed;
        try { parsed = JSON.parse(decoded); } catch (e) { return { updated: false, error: 'codes.json 解析失败: ' + String(e && e.message || e) }; }
        if (!Array.isArray(parsed.codes)) parsed.codes = [];

        // 2) 更新 codes 中对应记录的绑定信息
        const idx = parsed.codes.findIndex(c => c.code === code);
        if (idx >= 0) {
            parsed.codes[idx].boundDeviceId = deviceId;
            parsed.codes[idx].boundAt = boundAt;
        } else {
            // 找不到就不写，避免脏数据
            return { updated: false, error: '在 codes.json 中未找到该激活码' };
        }

        const newContent = Buffer.from(JSON.stringify(parsed, null, 2), 'utf8').toString('base64');

        // 3) 提交更新
        const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`;
        const commitMessage = `chore: bind device for ${code} at ${boundAt}`;
        console.log('[verify] github.put start', { path: filePath, branch, code });
        const putResp = await fetch(putUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'temu-license-server',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: commitMessage,
                content: newContent,
                sha,
                branch
            })
        });
        console.log('[verify] github.put resp', putResp.status, putResp.statusText);
        if (!putResp.ok) {
            const t = await putResp.text();
            return { updated: false, error: `写回失败: ${putResp.status} ${putResp.statusText}; path=${filePath}; branch=${branch}; body=${t}` };
        }
        let putJson = {};
        try { putJson = await putResp.json(); } catch {}
        console.log('[verify] github.put ok', { path: filePath, commitSha: putJson && putJson.commit && putJson.commit.sha });
        return { updated: true };
    } catch (e) {
        return { updated: false, error: String(e && e.message || e) };
    }
}
