require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const PAYMENT_LOG = path.join(DATA_DIR, 'processed-payments.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PAYMENT_LOG)) {
  fs.writeFileSync(PAYMENT_LOG, JSON.stringify({ processed: [] }, null, 2));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function loadProcessedPayments() {
  try {
    return JSON.parse(fs.readFileSync(PAYMENT_LOG, 'utf8')).processed || [];
  } catch {
    return [];
  }
}

function saveProcessedPayments(processed) {
  fs.writeFileSync(PAYMENT_LOG, JSON.stringify({ processed }, null, 2));
}

function normalizeCpf(value = '') {
  return value.replace(/\D/g, '');
}

function buildPayer({ name, email, cpf }) {
  const payer = { email };

  if (name) {
    const [firstName, ...rest] = name.trim().split(/\s+/);
    payer.first_name = firstName;
    if (rest.length) payer.last_name = rest.join(' ');
  }

  const normalizedCpf = normalizeCpf(cpf);
  if (normalizedCpf.length === 11) {
    payer.identification = {
      type: 'CPF',
      number: normalizedCpf,
    };
  }

  return payer;
}

function makeReference(product, email) {
  const slug = String(product || 'ghostroot')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 30);

  const emailPart = String(email || 'cliente')
    .split('@')[0]
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 16);

  return `${slug || 'produto'}-${emailPart || 'cliente'}-${Date.now()}`;
}

function getBaseUrl(req) {
  return process.env.SITE_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function parseAmount(value, fallback = 14.99) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const raw = String(value).trim();

  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;

  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

async function mercadoPagoRequest(endpoint, options = {}) {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;

  if (!token) {
    throw new Error('Defina MERCADO_PAGO_ACCESS_TOKEN no arquivo .env.');
  }

  const response = await fetch(`https://api.mercadopago.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage =
      data?.message ||
      data?.cause?.[0]?.description ||
      'Erro na API do Mercado Pago.';
    throw new Error(errorMessage);
  }

  return data;
}

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error('Defina GMAIL_USER e GMAIL_APP_PASSWORD no arquivo .env.');
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

async function sendApprovedEmail(payment) {
  const processed = loadProcessedPayments();
  const paymentId = String(payment.id);

  if (processed.includes(paymentId)) {
    return { skipped: true };
  }

  const transporter = getTransporter();
  const to = process.env.NOTIFY_TO_EMAIL || process.env.GMAIL_USER;
  const amount = Number(payment.transaction_amount || 0).toFixed(2);
  const customerName =
    [payment.payer?.first_name, payment.payer?.last_name].filter(Boolean).join(' ') ||
    'Cliente sem nome';
  const customerEmail = payment.payer?.email || 'Não informado';
  const externalReference = payment.external_reference || 'Sem referência';
  const productName = payment.description || process.env.DEFAULT_PRODUCT_NAME || 'GhostRoot';
  const approvedAt = payment.date_approved || new Date().toISOString();

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
      <h2>Pagamento Pix aprovado</h2>
      <p>O Mercado Pago marcou um pagamento como aprovado.</p>
      <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse">
        <tr><td><strong>Produto</strong></td><td>${productName}</td></tr>
        <tr><td><strong>Valor</strong></td><td>R$ ${amount}</td></tr>
        <tr><td><strong>Cliente</strong></td><td>${customerName}</td></tr>
        <tr><td><strong>E-mail do cliente</strong></td><td>${customerEmail}</td></tr>
        <tr><td><strong>ID do pagamento</strong></td><td>${paymentId}</td></tr>
        <tr><td><strong>Referência</strong></td><td>${externalReference}</td></tr>
        <tr><td><strong>Status</strong></td><td>${payment.status}</td></tr>
        <tr><td><strong>Aprovado em</strong></td><td>${approvedAt}</td></tr>
      </table>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: `Pagamento aprovado: ${productName} • R$ ${amount}`,
    replyTo: customerEmail,
    html,
    text: [
      'Pagamento Pix aprovado.',
      `Produto: ${productName}`,
      `Valor: R$ ${amount}`,
      `Cliente: ${customerName}`,
      `E-mail do cliente: ${customerEmail}`,
      `ID do pagamento: ${paymentId}`,
      `Referência: ${externalReference}`,
      `Status: ${payment.status}`,
      `Aprovado em: ${approvedAt}`,
    ].join('\n'),
  });

  processed.push(paymentId);
  saveProcessedPayments(processed);
  return { skipped: false };
}

async function fetchPaymentDetails(paymentId) {
  return mercadoPagoRequest(`/v1/payments/${paymentId}`, { method: 'GET' });
}

async function tryFinalizeApprovedPayment(paymentId) {
  const payment = await fetchPaymentDetails(paymentId);

  if (payment.status === 'approved') {
    await sendApprovedEmail(payment);
  }

  return payment;
}

app.post('/api/create-pix', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const cpf = String(req.body.cpf || '').trim();
    const product = String(
      req.body.product || process.env.DEFAULT_PRODUCT_NAME || 'GhostRoot'
    ).trim();

    const amount = parseAmount(process.env.PRODUCT_PRICE, 14.99);

    if (!name || !email) {
      return res.status(400).json({ error: 'Informe nome e e-mail.' });
    }

    const externalReference = makeReference(product, email);

    const payment = await mercadoPagoRequest('/v1/payments', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        transaction_amount: amount,
        description: product,
        payment_method_id: 'pix',
        notification_url: `${getBaseUrl(req)}/api/webhook/mercadopago`,
        external_reference: externalReference,
        payer: buildPayer({ name, email, cpf }),
      }),
    });

    const tx = payment.point_of_interaction?.transaction_data || {};

    return res.json({
      payment_id: payment.id,
      status: payment.status,
      external_reference: externalReference,
      qr_code: tx.qr_code,
      qr_code_base64: tx.qr_code_base64,
      ticket_url: tx.ticket_url,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Erro ao gerar Pix.' });
  }
});

app.get('/api/payment-status/:paymentId', async (req, res) => {
  try {
    const payment = await tryFinalizeApprovedPayment(req.params.paymentId);
    return res.json({
      id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail,
      external_reference: payment.external_reference,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Erro ao consultar pagamento.',
    });
  }
});

app.post('/api/webhook/mercadopago', async (req, res) => {
  try {
    const type = req.body?.type || req.query?.type;
    const dataId = req.body?.data?.id || req.query?.['data.id'];

    if (type === 'payment' && dataId) {
      await tryFinalizeApprovedPayment(dataId);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('Erro no webhook Mercado Pago:', error.message);
    return res.sendStatus(200);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});