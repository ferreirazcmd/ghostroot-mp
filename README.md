# GhostRoot com Pix (Mercado Pago) + aviso no Gmail

Este pacote já vem preparado para:

- gerar cobrança Pix no Mercado Pago;
- mostrar QR Code e código Pix na página;
- consultar o status do pagamento;
- enviar um e-mail para o Gmail configurado quando o pagamento for aprovado.

## 1) Instalar

```bash
npm install
```

## 2) Configurar o arquivo `.env`

1. copie `.env.example` para `.env`;
2. preencha:

- `MERCADO_PAGO_ACCESS_TOKEN`: seu Access Token do Mercado Pago;
- `GMAIL_USER`: seu Gmail;
- `GMAIL_APP_PASSWORD`: a senha de app do Gmail;
- `NOTIFY_TO_EMAIL`: para qual e-mail o aviso vai chegar.

Exemplo:

```env
PORT=3000
SITE_BASE_URL=http://localhost:3000
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-...
PRODUCT_PRICE=14.99
DEFAULT_PRODUCT_NAME=GhostRoot
GMAIL_USER=seuemail@gmail.com
GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
NOTIFY_TO_EMAIL=seuemail@gmail.com
```

## 3) Rodar

```bash
npm start
```

Abra `http://localhost:3000`.

## 4) Onde pegar cada coisa

### Mercado Pago

No painel de desenvolvedor, pegue o **Access Token** da conta que vai receber os pagamentos.

### Gmail

Ative a **verificação em 2 etapas** e depois gere uma **App Password** para usar no Nodemailer/SMTP.

## 5) Importante sobre webhook

O projeto já chama `notification_url` automaticamente em:

```text
{SITE_BASE_URL}/api/webhook/mercadopago
```

Se você rodar só em `localhost`, o webhook externo do Mercado Pago não consegue bater na sua máquina. Mesmo assim, a página já faz checagem de status do pagamento a cada poucos segundos e, quando detectar `approved`, o backend também manda o e-mail.

Para produção, coloque `SITE_BASE_URL` em uma URL pública, por exemplo:

```text
https://seudominio.com
```

## 6) Estrutura

- `public/index.html`: sua landing page atualizada;
- `server.js`: backend Express;
- `data/processed-payments.json`: evita enviar e-mail duplicado;
- `.env.example`: modelo de configuração.

## 7) O que foi alterado no site

- botão principal agora gera Pix;
- adicionada uma seção de checkout com nome, e-mail e CPF opcional;
- QR Code e Pix copia-e-cola aparecem na tela;
- status do pagamento atualiza automaticamente.

