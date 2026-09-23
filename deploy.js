/* 自动部署到 GitHub Pages：创建仓库 → 推送 → 开启 Pages → 等待上线 */
/* 本机环境存在代理/自签 CA，Node 侧放宽 TLS 校验（仅限本部署脚本） */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = 'C:/Users/ywxc1/Documents/Obsidian Vault/自主管理/项目/output/pbl-lesson-20260921-2317/deploy-github';
const REPO = 'see-the-unseen';

function credential() {
  const r = spawnSync('git', ['credential', 'fill'],
    { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const o = r.stdout || '';
  const u = /username=(.*)/.exec(o), p = /password=(.*)/.exec(o);
  if (!u || !p) throw new Error('未取到凭据：' + o + (r.stderr || ''));
  return { user: u[1].trim(), token: p[1].trim() };
}

function api(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path: p, method,
      headers: Object.assign({
        Authorization: 'Bearer ' + token,
        'User-Agent': 'deploy-script',
        Accept: 'application/vnd.github+json'
      }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let j = null;
        try { j = d ? JSON.parse(d) : null; } catch (e) { }
        resolve({ status: res.statusCode, body: j, raw: d.slice(0, 400) });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { cwd: DIR, encoding: 'utf8', input: input || null });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function main() {
  const { user, token } = credential();
  const me = await api('GET', '/user', null, token);
  console.log('登录身份:', me.status, me.body && me.body.login);
  if (!me.body || !me.body.login) { console.log('凭据无效:', me.raw); return; }
  const owner = me.body.login;

  // 1. 创建仓库（已存在则复用）
  let created = false;
  const cr = await api('POST', '/user/repos', {
    name: REPO,
    description: '看见看不见 —— 平面镜成像 × 镜面对称 八年级跨学科 PBL 互动课件',
    private: false, auto_init: false, has_issues: false, has_wiki: false, has_projects: false
  }, token);
  if (cr.status === 201) { created = true; console.log('仓库已创建:', REPO); }
  else if (cr.status === 422) { console.log('仓库已存在，复用:', REPO); }
  else { console.log('创建仓库失败', cr.status, cr.raw); return; }

  // 2. 推送（静态站直接用分支部署，不依赖 Actions，避免 workflow 权限问题）
  const ghDir = path.join(DIR, '.github');
  if (fs.existsSync(ghDir)) fs.rmSync(ghDir, { recursive: true, force: true });
  fs.writeFileSync(path.join(DIR, '.nojekyll'), '');

  const steps = [
    ['init', ['git', ['init', '-b', 'main']]],
    ['config-name', ['git', ['config', 'user.name', owner]]],
    ['config-email', ['git', ['config', 'user.email', owner + '@users.noreply.github.com']]],
    ['add', ['git', ['add', '-A']]],
    ['commit', ['git', ['commit', '-m', 'deploy: 看见看不见 互动课件']]]
  ];
  for (const [n, [c, a]] of steps) {
    const r = run(c, a);
    if (r.code !== 0 && n !== 'commit') console.log('  [' + n + '] warn:', r.err.slice(0, 160));
  }
  const remoteUrl = 'https://github.com/' + owner + '/' + REPO + '.git';
  run('git', ['remote', 'remove', 'origin']);
  run('git', ['remote', 'add', 'origin', remoteUrl]);
  const pushUrl = 'https://' + owner + ':' + token + '@github.com/' + owner + '/' + REPO + '.git';
  const push = run('git', ['-c', 'http.sslVerify=false', 'push', '-u', pushUrl, 'main']);
  if (push.code !== 0) { console.log('推送失败:', push.err.slice(0, 400), push.out.slice(0, 300)); return; }
  console.log('推送成功');
  // 凭据不留在 remote 配置里
  run('git', ['remote', 'set-url', 'origin', remoteUrl]);

  // 3. 开启 Pages（source: main 分支根目录）
  const url = 'https://' + owner + '.github.io/' + REPO + '/';
  let pg = await api('POST', '/repos/' + owner + '/' + REPO + '/pages',
    { source: { branch: 'main', path: '/' } }, token);
  if (pg.status === 201) console.log('Pages 已开启');
  else if (pg.status === 409 || pg.status === 400) {
    pg = await api('PUT', '/repos/' + owner + '/' + REPO + '/pages',
      { source: { branch: 'main', path: '/' } }, token);
    console.log('Pages 已更新', pg.status);
  } else console.log('开启 Pages 返回', pg.status, pg.raw);

  // 4. 等待上线
  for (let i = 0; i < 30; i++) {
    const st = await api('GET', '/repos/' + owner + '/' + REPO + '/pages', null, token);
    const b = st.body || {};
    const httpsRes = await new Promise(res => {
      https.get(url, r => { res(r.statusCode); r.resume(); }).on('error', () => res(0));
    });
    console.log('  第' + (i + 1) + '次检查: build=' + (b.status || '-') + ' HTTP=' + httpsRes);
    if (httpsRes === 200) { console.log('\n上线成功 → ' + url); break; }
    await sleep(8000);
  }
  console.log('\n仓库: https://github.com/' + owner + '/' + REPO);
  console.log('页面: ' + url);
})().catch(e => console.log('ERROR:', e.message));
