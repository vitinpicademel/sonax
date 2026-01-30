import { NextRequest, NextResponse } from 'next/server';

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

      // Função para consultar API Imoview
      const consultarAPIImoview = async (endpoint: string): Promise<any> => {
        const url = new URL(`https://api.imoview.com.br${endpoint}`);
        url.searchParams.append('chave', imoviewKey);
        url.searchParams.append('codigo', codigoAtendimento.toString());

        console.log(`Consultando API Imoview: ${url.toString()}`);
        
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Erro na API Imoview (${endpoint}):`, response.status, errorText);
          return null;
        }

        const data = await response.json();
        console.log(`Dados recebidos da API Imoview (${endpoint}):`, JSON.stringify(data, null, 2));
        return data;
      };

      // Tentar primeiro endpoint Atendimento/Retornar
      let imoviewData = await consultarAPIImoview('/Atendimento/Retornar');
      
      if (imoviewData) {
        telefone = extrairTelefone(imoviewData);
      }

      // Se não encontrou telefone ou dados vazios, tentar endpoint Interessado/Retornar
      if (!telefone || !imoviewData) {
        console.log('Tentando endpoint alternativo Interessado/Retornar...');
        const interessadoData = await consultarAPIImoview('/Interessado/Retornar');
        
        if (interessadoData) {
          telefone = extrairTelefone(interessadoData);
          if (telefone) {
            imoviewData = interessadoData;
          }
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

    // Limpar o número de telefone (remover tudo que não for número)
    const telefoneLimpo = telefone.replace(/\D/g, '');
    
    if (telefoneLimpo.length < 10) {
      console.error('Número de telefone inválido:', telefone);
      return NextResponse.json(
        { error: 'Número de telefone inválido' },
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
