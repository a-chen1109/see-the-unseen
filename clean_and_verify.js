/* 清理临时文件 → 重新推送 → 校验线上资源 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = 'C:/Users/ywxc1/Documents/Obsidian Vault/自主管理/项目/output/pbl-lesson-20260921-2317/deploy-github';
const BASE = 'https://a-chen1109.github.io/see-the-unseen/';

function credential() {
  const r = spawnSync('git', ['credential', 'fill'],
    { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const o = r.stdout || '';
  return { user: /username=(.*)/.exec(o)[1].trim(), token: /password=(.*)/.exec(o)[1].trim() };
}
function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: DIR, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function get(url) {
  return new Promise(res => {
    https.get(url, r => {
      let d = ''; r.setEncoding('utf8');
      r.on('data', c => d += c);
      r.on('end', () => res({ code: r.statusCode, body: d }));
    }).on('error', e => res({ code: 0, body: '', err: e.message }));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  const { token } = credential();
  // 清理：部署脚本不进公开仓库
  const junk = ['deploy.js', 'verify.js'];
  junk.forEach(f => { const p = path.join(DIR, f); if (fs.existsSync(p)) fs.rmSync(p, { force: true }); });
  const gh = path.join(DIR, '.github');
  if (fs.existsSync(gh)) fs.rmSync(gh, { recursive: true, force: true });
  console.log('仓库文件:', fs.readdirSync(DIR).join(', '));

  run('git', ['add', '-A']);
  const c = run('git', ['commit', '-m', 'docs: 更新说明，移除临时脚本']);
  console.log('commit:', c.code, c.out.split('\n')[0] || '(无变更)');
  const push = run('git', ['-c', 'http.sslVerify=false', 'push', 'https://a-chen1109:' + token + '@github.com/a-chen1109/see-the-unseen.git', 'main']);
  console.log('push:', push.code === 0 ? 'OK' : push.err.slice(0, 200));

  await sleep(8000);
  const checks = [
    ['index.html 页面', BASE],
    ['挑错图·错误版', BASE + 'assets/03_AI%E6%8C%91%E9%94%99%E5%85%89%E8%B7%AF%E5%9B%BE_%E9%94%99%E8%AF%AF%E7%89%88.svg'],
    ['挑错图·正确版', BASE + 'assets/04_AI%E6%8C%91%E9%94%99%E5%85%89%E8%B7%AF%E5%9B%BE_%E6%AD%A3%E7%A1%AE%E7%89%88.svg'],
    ['README', BASE + 'README.md']
  ];
  for (const [name, url] of checks) {
    const r = await get(url);
    console.log('  ' + name + ': HTTP ' + r.code + (r.code === 200 ? ' (' + Math.round(r.body.length / 1024) + ' KB)' : ''));
  }
  const home = await get(BASE);
  ['看见看不见', '轴对称', 'foldSvg', 'magic-box'].forEach(k => {
    console.log('  首页含「' + k + '」:', home.body.includes(k));
  });
  console.log('  首页大小:', Math.round(home.body.length / 1024) + ' KB');
})().catch(e => console.log('ERROR:', e.message));
