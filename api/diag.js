const fs = require('fs');
const path = require('path');

module.exports = async function handler(_req, res) {
  try {
    const cwd = process.cwd();
    const here = __dirname;
    const listHere = fs.readdirSync(here);
    const target = path.join(here, 'codes.json');
    const exists = fs.existsSync(target);
    res.status(200).json({ ok: true, __dirname: here, listHere, target, exists });
  } catch (e) {
    res.status(500).json({ ok: false, debug: String(e && e.message || e) });
  }
}


