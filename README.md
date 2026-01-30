# Integração Imoview ↔ Sonax

Esta aplicação Next.js funciona como ponte entre o CRM Imoview e a discadora Sonax, automatizando o processo de ligação para leads.

## Como Funciona

1. **Webhook Imoview**: Quando um lead entra no Imoview, ele envia um POST request para `/api/webhook-imoview`
2. **Processamento**: A função extrai o número de telefone, limpa e formata
3. **Integração Sonax**: Faz uma requisição para a API Sonax disparando a chamada automática

## Configuração

### Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env.local` e configure:

```bash
cp .env.example .env.local
```

Configure as seguintes variáveis:

- `SONAX_QUEUE_ID`: ID da fila na Sonax
- `SONAX_TOKEN`: Token de autenticação da API Sonax

### Configuração na Vercel

1. Faça deploy do projeto na Vercel
2. Configure as variáveis de ambiente no dashboard da Vercel:
   - Vá para Settings → Environment Variables
   - Adicione:
     - `SONAX_QUEUE_ID` (seu ID de fila)
     - `SONAX_TOKEN` (seu token da API)

## Endpoint do Webhook

```
POST https://seu-domínio.vercel.app/api/webhook-imoview
```

### Corpo da Requisição (JSON)

```json
{
  "leads_celular": "(11) 98765-4321",
  "nome": "João Silva",
  "email": "joao@email.com"
}
```

A função aceita os seguintes campos para telefone:
- `leads_celular`
- `telefone` 
- `celular`

## Respostas

### Sucesso (200)
```json
{
  "success": true,
  "message": "Chamada disparada com sucesso",
  "telefone": "11987654321",
  "sonaxResponse": { ... }
}
```

### Erro (sempre retorna 200 para o Imoview)
```json
{
  "success": false,
  "message": "Erro ao processar chamada na Sonax",
  "sonaxError": "..."
}
```

## Logs

A aplicação loga no console:
- Recebimento de webhooks
- Processamento de telefones  
- Sucesso/erro na chamada da Sonax
- Erros de configuração

Na Vercel, visualize os logs em:
Settings → Functions → Logs

## Segurança

- Todas as credenciais ficam em variáveis de ambiente
- A API retorna sempre 200 para evitar reenvios infinitos
- Validação de formato de telefone antes de enviar para Sonax
