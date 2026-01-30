# Integração Imoview ↔ Sonax

Esta aplicação Next.js funciona como ponte entre o CRM Imoview e a discadora Sonax, automatizando o processo de ligação para leads.

## Como Funciona

1. **Webhook Imoview**: Quando um lead entra no Imoview, ele envia um POST request para `/api/webhook-imoview` com o `codigo` do atendimento
2. **Consulta API Imoview**: Se o telefone não vier no webhook, a função consulta a API Imoview para buscar os dados completos do atendimento
3. **Processamento**: A função extrai o número de telefone dos dados do cliente e limpa o formato
4. **Integração Sonax**: Faz uma requisição para a API Sonax disparando a chamada automática

## Configuração

### Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env.local` e configure:

```bash
cp .env.example .env.local
```

Configure as seguintes variáveis:

- `SONAX_QUEUE_ID`: ID da fila na Sonax
- `SONAX_TOKEN`: Token de autenticação da API Sonax
- `IMOVIEW_KEY`: Chave de API do Imoview para consulta de atendimentos

### Configuração na Vercel

1. Faça deploy do projeto na Vercel
2. Configure as variáveis de ambiente no dashboard da Vercel:
   - Vá para Settings → Environment Variables
   - Adicione:
     - `SONAX_QUEUE_ID` (seu ID de fila)
     - `SONAX_TOKEN` (seu token da API)
     - `IMOVIEW_KEY` (sua chave de API Imoview)

## Endpoint do Webhook

```
POST https://seu-domínio.vercel.app/api/webhook-imoview
```

### Corpo da Requisição (JSON)

```json
{
  "codigo": 21290
}
```

A função também mantém compatibilidade com webhooks que enviam o telefone diretamente:

```json
{
  "leads_celular": "(11) 98765-4321",
  "codigo": 21290
}
```

## Fluxo de Processamento

1. **Recebimento**: Extrai o `codigo` do atendimento do webhook
2. **Verificação**: Tenta encontrar telefone direto no webhook (compatibilidade)
3. **Consulta**: Se não encontrar telefone, consulta API Imoview:
   - Endpoint: `https://api.imoview.com.br/atendimento/retornar`
   - Parâmetros: `chave` (IMOVIEW_KEY) e `codigo` (do webhook)
4. **Extração**: Busca telefone em múltiplos campos:
   - `cliente.celular`, `cliente.telefone`, `cliente.fone`, `cliente.phone`
   - `celular`, `telefone`, `fone`, `phone`
5. **Limpeza**: Remove caracteres não numéricos do telefone
6. **Disparo**: Envia para API Sonax

## Respostas

### Sucesso (200)
```json
{
  "success": true,
  "message": "Chamada disparada com sucesso",
  "codigoAtendimento": 21290,
  "telefone": "11987654321",
  "telefoneOriginal": "(11) 98765-4321",
  "sonaxResponse": { ... }
}
```

### Erro (sempre retorna 200 para o Imoview)
```json
{
  "success": false,
  "message": "Telefone não encontrado nos dados do atendimento",
  "codigoAtendimento": 21290
}
```

## Logs

A aplicação loga no console:
- Recebimento de webhooks e códigos de atendimento
- Consultas à API Imoview
- Dados recebidos da API Imoview (formatado)
- Extração de telefones encontrados
- Sucesso/erro na chamada da Sonax
- Erros de configuração

Na Vercel, visualize os logs em:
Settings → Functions → Logs

## Segurança

- Todas as credenciais ficam em variáveis de ambiente
- A API retorna sempre 200 para evitar reenvios infinitos
- Validação de formato de telefone antes de enviar para Sonax
- Logs detalhados para debugging sem expor dados sensíveis
