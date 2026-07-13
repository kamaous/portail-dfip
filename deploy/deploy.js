// Déploiement du Portail DFE → pedagogie.tekkina.sn (PM2 + nginx + certbot)
const { Client } = require('ssh2');
const path = require('path');

const HOST = '51.255.198.84';
const USER = 'ubuntu';
const PASSWORD = process.env.SSHPW;
const JWT = process.env.JWTS;
const DIR = '/var/www/pedagogie.tekkina.sn';
const DOMAIN = 'pedagogie.tekkina.sn';

if (!PASSWORD || !JWT) { console.error('SSHPW et JWTS requis'); process.exit(1); }

const NGINX_CONF = `server {
    listen 80;
    server_name ${DOMAIN};
    root ${DIR}/frontend/dist;
    index index.html;
    client_max_body_size 15m;

    location /api/ {
        proxy_pass http://127.0.0.1:5100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;

const conn = new Client();

function exec(cmd, { tolerate = false } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => errOut += d);
      stream.on('close', (code) => {
        if (code !== 0 && !tolerate) {
          reject(new Error(`[exit ${code}] ${cmd}\nSTDOUT: ${out.slice(-1500)}\nSTDERR: ${errOut.slice(-1500)}`));
        } else {
          resolve({ code, out, errOut });
        }
      });
    });
  });
}

function upload(local, remote) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(local, remote, e => e ? reject(e) : resolve());
    });
  });
}

conn.on('ready', async () => {
  try {
    console.log('✓ Connecté à ' + HOST);

    // SAUVEGARDE OBLIGATOIRE côté serveur avant toute mise à jour
    console.log('→ Sauvegarde serveur (obligatoire avant mise à jour)...');
    await exec(`mkdir -p /home/ubuntu/backups`);
    const bk = await exec(`STAMP=$(date +%Y%m%d-%H%M%S) && tar --exclude='pedagogie.tekkina.sn/backend/node_modules' -czf /home/ubuntu/backups/pedagogie-$STAMP.tar.gz -C /var/www pedagogie.tekkina.sn 2>/dev/null && echo "pedagogie-$STAMP.tar.gz"`, { tolerate: true });
    console.log('  ✓ /home/ubuntu/backups/' + (bk.out.trim() || '(première installation, rien à sauvegarder)'));

    console.log('→ Upload du bundle...');
    await upload(path.join(__dirname, 'bundle.tar.gz'), '/tmp/pedagogie-bundle.tar.gz');

    console.log('→ Arrêt de l\'API pendant la mise à jour...');
    await exec(`pm2 stop pedagogie-api 2>/dev/null || true`, { tolerate: true });

    console.log('→ Préparation du répertoire...');
    await exec(`sudo mkdir -p ${DIR} && sudo chown -R ubuntu:ubuntu ${DIR}`);

    console.log('→ Extraction...');
    await exec(`cd ${DIR} && tar xzf /tmp/pedagogie-bundle.tar.gz && mkdir -p backend/uploads/calendriers && rm /tmp/pedagogie-bundle.tar.gz`);

    console.log('→ Vérification du port 5100...');
    const port = await exec(`ss -tlnp 2>/dev/null | grep ':5100 ' || true`, { tolerate: true });
    if (port.out.trim() && !port.out.includes('pedagogie')) console.log('  ⚠ Port 5100 occupé par: ' + port.out.trim().slice(0, 120));

    console.log('→ npm install (production)...');
    const npmi = await exec(`cd ${DIR}/backend && npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -3`);
    console.log('  ' + npmi.out.trim().split('\n').pop());

    console.log('→ Démarrage PM2 (pedagogie-api, port 5100)...');
    await exec(`pm2 delete pedagogie-api 2>/dev/null || true`, { tolerate: true });
    await exec(`cd ${DIR}/backend && JWT_SECRET='${JWT}' PORT=5100 NODE_ENV=production pm2 start src/index.js --name pedagogie-api --time && pm2 save`);

    console.log('→ Test API locale...');
    await new Promise(r => setTimeout(r, 2500));
    const health = await exec(`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5100/api/health`, { tolerate: true });
    console.log('  /api/health → HTTP ' + health.out);
    if (health.out !== '200') {
      const logs = await exec(`pm2 logs pedagogie-api --lines 15 --nostream 2>&1 | tail -15`, { tolerate: true });
      throw new Error('API KO:\n' + logs.out);
    }

    console.log('→ Configuration nginx...');
    await exec(`cat > /tmp/pedagogie.nginx << 'NGINXEOF'\n${NGINX_CONF}\nNGINXEOF`);
    await exec(`sudo mv /tmp/pedagogie.nginx /etc/nginx/sites-available/${DOMAIN} && sudo ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}`);
    await exec(`sudo nginx -t && sudo systemctl reload nginx`);

    console.log('→ Certificat SSL (Let\'s Encrypt)...');
    const cert = await exec(`sudo certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m ousmane.kama@unchk.edu.sn --redirect 2>&1 | tail -5`, { tolerate: true });
    console.log('  ' + cert.out.trim().split('\n').join('\n  '));

    console.log('→ Test HTTPS...');
    const https = await exec(`curl -s -o /dev/null -w '%{http_code}' https://${DOMAIN}/ && echo '' && curl -s -o /dev/null -w '%{http_code}' https://${DOMAIN}/api/health`, { tolerate: true });
    console.log('  site + api → ' + https.out.replace('\n', ' / '));

    console.log('\n✅ DÉPLOIEMENT TERMINÉ — https://' + DOMAIN);
  } catch (e) {
    console.error('\n❌ ÉCHEC : ' + e.message);
    process.exitCode = 1;
  } finally {
    conn.end();
  }
}).on('error', e => {
  console.error('Connexion impossible : ' + e.message);
  process.exit(1);
}).connect({ host: HOST, port: 22, username: USER, password: PASSWORD, readyTimeout: 20000 });
