import { NextRequest, NextResponse } from 'next/server';

// Função de higienização de telefone
function cleanPhoneNumber(phone: string): string {
  if (!phone) return '';
  
  console.log(`Telefone original: ${phone}`);
  
  // Remover todos os caracteres que não sejam números
  let cleaned = phone.replace(/\D/g, '');
  
  console.log(`Após remover caracteres não numéricos: ${cleaned}`);
  
  // Lógica de DDD Brasil: remover código do país (55) se presente
  if (cleaned.length >= 12 && cleaned.startsWith('55')) {
    cleaned = cleaned.substring(2);
    console.log(`Após remover código do país (55): ${cleaned}`);
  }
  
  console.log(`Telefone final limpo: ${cleaned}`);
  return cleaned;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Extrair código do atendimento
    const codigoAtendimento = body.codigo;
    
    if (!codigoAtendimento) {
      console.error('Código do atendimento não encontrado no webhook:', body);
      return NextResponse.json(
        { error: 'Código do atendimento não encontrado' },
        { status: 400 }
      );
    }

    // Tentar extrair telefone direto do webhook primeiro (compatibilidade)
    let telefone = body.leads_celular || body.telefone || body.celular;
    
    // Se não tiver telefone, buscar na API Imoview
    if (!telefone) {
      console.log(`Telefone não encontrado no webhook. Buscando dados do atendimento ${codigoAtendimento} na API Imoview...`);
      
      const imoviewKey = process.env.IMOVIEW_KEY;
      if (!imoviewKey) {
        console.error('Variável de ambiente IMOVIEW_KEY não configurada');
        return NextResponse.json(
          { error: 'Configuração da API Imoview ausente' },
          { status: 500 }
        );
      }

      // Função para extrair telefone de múltiplos campos possíveis
      const extrairTelefone = (data: any): string | null => {
        // Verificar em objeto cliente
        if (data.cliente) {
          const telCliente = data.cliente.celular || 
                           data.cliente.telefone || 
                           data.cliente.fone ||
                           data.cliente.phone ||
                           data.cliente.telefone1 ||
                           data.cliente.telefone2 ||
                           (Array.isArray(data.cliente.telefones) && data.cliente.telefones[0]) ||
                           data.cliente.contato;
          if (telCliente) return telCliente;
        }

        // Verificar em campos diretos
        return data.celular || 
               data.telefone || 
               data.fone ||
               data.phone ||
               data.telefone1 ||
               data.telefone2 ||
               (Array.isArray(data.telefones) && data.telefones[0]) ||
               data.contato ||
               data.telefone_principal ||
               data.telefone_secundario;
      };

      // Função para consultar API Imoview com logs detalhados
      const consultarAPIImoview = async (endpoint: string, parametrosAdicionais: Record<string, string> = {}): Promise<any> => {
        // URLs hardcoded com case sensitivity correto
        const baseUrl = 'https://api.imoview.com.br';
        const fullUrl = `${baseUrl}${endpoint}`;
        
        // Construir URL com parâmetros
        const url = new URL(fullUrl);
        url.searchParams.append('chave', imoviewKey);
        url.searchParams.append('codigo', codigoAtendimento.toString());
        
        // Adicionar parâmetros adicionais
        Object.entries(parametrosAdicionais).forEach(([key, value]) => {
          url.searchParams.append(key, value);
        });

        console.log(`Tentando endpoint: ${url.toString()}`);
        
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const status = response.status;
        console.log(`Resposta ${status}:`);

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`Erro: ${errorText}`);
          console.error(`Erro na API Imoview (${endpoint}):`, status, errorText);
          return null;
        }

        const data = await response.json();
        console.log(`Resposta ${status}:`, JSON.stringify(data, null, 2));
        return data;
      };

      // TENTATIVA 1 (Padrão Ouro): Lead/Listar
      let imoviewData = await consultarAPIImoview('/Lead/Listar', { registrosPorPagina: '1' });
      
      if (imoviewData) {
        // Se for uma lista/array, pegar o primeiro item
        if (Array.isArray(imoviewData) && imoviewData.length > 0) {
          imoviewData = imoviewData[0];
          console.log('DEBUG JSON IMOVIEW (primeiro item da lista Lead):', JSON.stringify(imoviewData, null, 2));
        }
        
        telefone = extrairTelefone(imoviewData);
      }

      // TENTATIVA 2: Lead/Obter
      if (!telefone) {
        console.log('Tentando Lead/Obter...');
        const leadData = await consultarAPIImoview('/Lead/Obter');
        
        if (leadData) {
          console.log('DEBUG JSON IMOVIEW (Lead/Obter):', JSON.stringify(leadData, null, 2));
          telefone = extrairTelefone(leadData);
          if (telefone) {
            imoviewData = leadData;
          }
        }
      }

      // TENTATIVA 3 (Fallback para Atendimento): Atendimento/Listar
      if (!telefone) {
        console.log('Tentando Atendimento/Listar...');
        const atendimentoData = await consultarAPIImoview('/Atendimento/Listar', { registrosPorPagina: '1' });
        
        if (atendimentoData) {
          console.log('DEBUG JSON IMOVIEW (Atendimento/Listar):', JSON.stringify(atendimentoData, null, 2));
          
          // Se for uma lista/array, pegar o primeiro item
          if (Array.isArray(atendimentoData) && atendimentoData.length > 0) {
            imoviewData = atendimentoData[0];
            console.log('DEBUG JSON IMOVIEW (primeiro item da lista Atendimento):', JSON.stringify(imoviewData, null, 2));
          } else {
            imoviewData = atendimentoData;
          }
          
          telefone = extrairTelefone(imoviewData);
        }
      }

      if (!telefone) {
        console.error('Telefone não encontrado em nenhum endpoint da API Imoview');
        return NextResponse.json({
          success: false,
          message: 'Telefone não encontrado nos dados do atendimento/interessado',
          codigoAtendimento
        }, { status: 200 });
      }

      console.log(`Telefone encontrado na API Imoview: ${telefone}`);
    } else {
      console.log(`Telefone encontrado diretamente no webhook: ${telefone}`);
    }

    // Aplicar higienização do telefone
    const telefoneLimpo = cleanPhoneNumber(telefone);
    
    if (telefoneLimpo.length < 10) {
      console.error('Número de telefone inválido após limpeza:', telefoneLimpo);
      return NextResponse.json(
        { error: 'Número de telefone inválido após limpeza' },
        { status: 400 }
      );
    }

    // Verificar variáveis de ambiente
    const sonaxQueueId = process.env.SONAX_QUEUE_ID;
    const sonaxToken = process.env.SONAX_TOKEN;
    
    if (!sonaxQueueId || !sonaxToken) {
      console.error('Variáveis de ambiente da Sonax não configuradas');
      return NextResponse.json(
        { error: 'Configuração da API Sonax ausente' },
        { status: 500 }
      );
    }

    // Construir URL da API Sonax
    const sonaxUrl = new URL('https://api.sonax.net.br/sonax-queue2call.php');
    sonaxUrl.searchParams.append('telefone', telefoneLimpo);
    sonaxUrl.searchParams.append('fila', sonaxQueueId);
    sonaxUrl.searchParams.append('token', sonaxToken);

    // Fazer requisição para a API Sonax
    console.log(`Disparando chamada para ${telefoneLimpo} via Sonax`);
    
    const sonaxResponse = await fetch(sonaxUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!sonaxResponse.ok) {
      const errorText = await sonaxResponse.text();
      console.error('Erro na API Sonax:', sonaxResponse.status, errorText);
      
      // Retorna 200 para o Imoview mesmo com erro na Sonax
      return NextResponse.json({
        success: false,
        message: 'Erro ao processar chamada na Sonax',
        sonaxError: errorText
      }, { status: 200 });
    }

    const sonaxResult = await sonaxResponse.json();
    console.log('Chamada disparada com sucesso:', sonaxResult);

    return NextResponse.json({
      success: true,
      message: 'Chamada disparada com sucesso',
      codigoAtendimento,
      telefone: telefoneLimpo,
      telefoneOriginal: telefone,
      telefoneAntesLimpeza: telefone,
      telefoneDepoisLimpeza: telefoneLimpo,
      sonaxResponse: sonaxResult
    });

  } catch (error) {
    console.error('Erro no webhook Imoview:', error);
    
    // Sempre retorna 200 para o Imoview para evitar reenvios
    return NextResponse.json({
      success: false,
      message: 'Erro interno ao processar webhook',
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    }, { status: 200 });
  }
}

// Suporte para método OPTIONS (CORS)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
