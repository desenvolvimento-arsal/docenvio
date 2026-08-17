# DocEnvio — Gestão e Envio de Documentos por WhatsApp

Sistema institucional simples para **cadastrar clientes, anexar documentos e enviá-los por WhatsApp**.
Integra com a **[Evolution API](https://docs.evolutionfoundation.com.br/evolution-api)** quando configurada, e cai automaticamente em **modo simulação (mock)** quando não há instância — então funciona sem nenhuma configuração.

## Funcionalidades

- **Clientes** — cadastro com CNPJ (validado, dígitos verificadores), nome e telefone WhatsApp (normalizado para E.164).
- **Tipos de Documento** — ex.: Contrato Social, Comprovante de Pagamento, Nota Fiscal.
- **Tipos de Pagamento** — ex.: DARF, Boleto, GPS, PIX, DAS.
- **Documentos / Anexos** — upload vinculado ao cliente (PDF, imagem, Word, Excel, TXT · até 10 MB).
- **Envio por WhatsApp** — seleção de cliente + documentos, prévia da mensagem estilo WhatsApp, disparo e histórico de envios com status (enviado / falha).
- **Dashboard** — indicadores e últimos envios.

## Requisitos

- Node.js 20.12+ ou 22 (usa `process.loadEnvFile`).

## Como rodar

```bash
npm install
npm start
```

Acesse **http://localhost:3000**. Para outra porta: `PORT=8080 npm start`.

> Sem `.env`, o sistema roda em **modo simulação**: o envio é fingido (latência + ~85% de sucesso), grava o histórico e gera um link `wa.me` como fallback. Ideal para testar todo o fluxo sem WhatsApp real.

## Ligando a Evolution API (envio real)

Copie `.env.example` para `.env` e preencha:

```env
EVOLUTION_API_URL=https://sua-evolution.com
EVOLUTION_API_KEY=sua-api-key
EVOLUTION_INSTANCE=nome-da-instancia
```

Com os três valores definidos, o provedor passa automaticamente para `evolution` e os documentos são enviados de verdade via:

- `POST /message/sendText/{instance}` — mensagem de texto
- `POST /message/sendMedia/{instance}` — documento (base64)
- `GET  /instance/connectionState/{instance}` — status da conexão (mostrado na topbar)

O contrato do provedor está isolado em [`server/whatsapp.js`](server/whatsapp.js) — trocar de mock para Evolution (ou outra API) é só ajustar esse arquivo.

## Estrutura

```
server/
  index.js       API REST (Express) — CRUD, upload, envio, dashboard
  store.js       Persistência em arquivo JSON (data/db.json)
  validators.js  CNPJ, telefone E.164/BR, descrições
  whatsapp.js    Provedor de envio: evolution (real) | mock (simulação)
  env.js         Carrega .env antes dos demais módulos
public/
  index.html     Shell (sidebar + topbar)
  css/styles.css Design system institucional (tokens em :root)
  js/            api.js, ui.js (componentes), app.js (telas), icons.js
uploads/         Arquivos anexados
data/db.json     Base de dados (criada automaticamente)
```

## Notas técnicas

- **Persistência**: arquivo JSON, sem banco/dependências nativas — simples de rodar em qualquer máquina. Fácil de trocar por SQLite/Postgres depois (a camada `store` isola o acesso a dados).
- **Validações**: CNPJ com dígitos verificadores e unicidade; telefone normalizado para `+55DDDNÚMERO`; upload com whitelist de MIME e limite de 10 MB.
- **API mockada**: mantém o mesmo contrato de entrada/saída da Evolution API, para a troca ser transparente.
