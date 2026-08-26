'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const { SESSION_COOKIE, getUserFromToken } = require('../services/auth');
const {
  startLink,
  completeLink,
  getCreatorStatus,
  unlinkCreator,
  createCreatorCheckout
} = require('../services/creator-integrations');
const chainModules = require('../compat/chain-modules');

function configuredServiceKey() {
  return process.env.NEKOLIVE_SERVICE_API_KEY || process.env.NEKOPAY_SERVICE_API_KEY || '';
}

function requireService(req, res, next) {
  const expected = configuredServiceKey();
  if (!expected) return res.status(503).json({ error: 'NekoLive service integration is not configured' });
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const supplied = bearer || String(req.headers['x-nekolive-service-key'] || '');
  if (!supplied || supplied !== expected) return res.status(401).json({ error: 'Invalid NekoLive service key' });
  next();
}

function safeReturnUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function linkPage(state) {
  const encodedState = JSON.stringify(String(state || ''));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link NekoLive · NekoPay</title>
<style>
body{margin:0;background:#080b12;color:#eef2ff;font-family:Inter,system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}.card{width:min(560px,calc(100% - 32px));background:#111827;border:1px solid #273449;border-radius:18px;padding:28px;box-shadow:0 24px 80px #0008}h1{margin:0 0 8px}p{color:#aeb9cc;line-height:1.55}.row{display:grid;gap:12px;margin-top:18px}input,select,button{font:inherit;border-radius:10px;padding:12px 14px;border:1px solid #344258;background:#0b1220;color:#fff}button{background:#7ddc5b;color:#071006;font-weight:800;border:0;cursor:pointer}.muted{font-size:13px;color:#8794aa}.error{color:#ff9da4;white-space:pre-wrap}.ok{color:#9fe789}</style></head>
<body><main class="card"><h1>Link NekoLive to NekoPay</h1><p>Choose the NekoPay merchant account that should receive your creator tips, NyaTreats and subscription payments.</p><div id="root">Loading…</div></main>
<script>
const state=${encodedState}; const root=document.getElementById('root');
async function json(url,opt={}){const r=await fetch(url,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||d.message||('HTTP '+r.status));return d}
async function load(){try{const me=await json('/api/auth/me');if(!me.user)return login();const stores=me.stores||[];if(!stores.length){root.innerHTML='<p class="error">Your NekoPay account has no merchant account yet. Create a merchant/store first, then reopen this link.</p>';return}root.innerHTML='<div class="row"><label>Signed in as <b>'+esc(me.user.email||me.user.name)+'</b></label><select id="store">'+stores.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+' ('+esc(s.slug)+')</option>').join('')+'</select><button id="link">Link creator payments</button><div id="msg" class="muted"></div></div>';document.getElementById('link').onclick=link} catch(e){root.innerHTML='<p class="error">'+esc(e.message)+'</p>'}}
function login(){root.innerHTML='<form id="login" class="row"><input id="email" type="email" placeholder="NekoPay email" required><input id="password" type="password" placeholder="Password" required><button>Sign in to NekoPay</button><div id="msg" class="error"></div></form>';document.getElementById('login').onsubmit=async e=>{e.preventDefault();try{await json('/api/auth/login',{method:'POST',body:JSON.stringify({email:email.value,password:password.value})});load()}catch(err){msg.textContent=err.message}}}
async function link(){const button=document.getElementById('link');button.disabled=true;try{const d=await json('/api/creator/integrations/nekolive/link/complete',{method:'POST',body:JSON.stringify({state,storeId:document.getElementById('store').value})});document.getElementById('msg').className='ok';document.getElementById('msg').textContent='Linked successfully.';if(d.returnUrl)setTimeout(()=>location.href=d.returnUrl,500)}catch(e){document.getElementById('msg').className='error';document.getElementById('msg').textContent=e.message;button.disabled=false}}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))} load();
</script></body></html>`;
}

function createCreatorRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(cookieParser());
  router.use(async (req, _res, next) => {
    if (!req.user) req.user = await getUserFromToken(req.cookies?.[SESSION_COOKIE]);
    next();
  });

  router.post('/api/creator/integrations/nekolive/link/start', requireService, async (req, res) => {
    try { res.status(201).json(startLink(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.post('/api/creator/integrations/nekolive/link/complete', async (req, res) => {
    try {
      const result = await completeLink(req.body.state, req.user, req.body.storeId);
      res.json({ ...result, returnUrl: safeReturnUrl(result.returnUrl) });
    } catch (error) { res.status(req.user ? 400 : 401).json({ error: error.message }); }
  });

  router.post('/api/creator/integrations/nekolive/status', requireService, async (req, res) => {
    try { res.json(await getCreatorStatus(req.body.creatorId)); } catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.post('/api/creator/integrations/nekolive/unlink', requireService, async (req, res) => {
    try { res.json(await unlinkCreator(req.body.creatorId)); } catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.post('/api/creator/checkout-sessions', requireService, async (req, res) => {
    try { res.status(201).json(await createCreatorCheckout(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.post('/api/verification/transaction', requireService, async (req, res) => {
    try {
      const network = String(req.body.network || req.body.chain || '').toUpperCase();
      const Module = chainModules[`${network}Module`];
      if (!Module) return res.status(400).json({ error: `Unsupported verification network: ${network}` });
      const module = new Module({
        ...(req.body.explorerUrl ? { url: req.body.explorerUrl } : {}),
        ...(Array.isArray(req.body.altExplorerUrls) ? { altExplorerUrls: req.body.altExplorerUrls } : {}),
        ...(req.body.tokenContract ? { tokenContract: req.body.tokenContract } : {})
      });
      const result = await module.existsTransaction(
        req.body.address || req.body.account,
        Number(req.body.amount),
        req.body.timestamp,
        req.body.memo || null,
        Number(req.body.minimumConfirmations || 0)
      );
      res.json(result);
    } catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.get('/creator/nekolive/link', (req, res) => {
    res.type('html').send(linkPage(req.query.state));
  });

  return router;
}

module.exports = { createCreatorRouter, requireService };
