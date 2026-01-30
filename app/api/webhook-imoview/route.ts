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

      // Construir URL da API Imoview
      const imoviewUrl = new URL('https://api.imoview.com.br/atendimento/retornar');
      imoviewUrl.searchParams.append('chave', imoviewKey);
      imoviewUrl.searchParams.append('codigo', codigoAtendimento.toString());

      console.log(`Consultando API Imoview: ${imoviewUrl.toString()}`);
      
      const imoviewResponse = await fetch(imoviewUrl.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!imoviewResponse.ok) {
        const errorText = await imoviewResponse.text();
        console.error('Erro na API Imoview:', imoviewResponse.status, errorText);
        
        return NextResponse.json({
          success: false,
          message: 'Erro ao consultar dados do atendimento na Imoview',
          imoviewError: errorText
        }, { status: 200 });
      }

      const imoviewData = await imoviewResponse.json();
      console.log('Dados recebidos da API Imoview:', JSON.stringify(imoviewData, null, 2));

      // Extrair telefone dos dados do cliente (verifica múltiplos campos possíveis)
      if (imoviewData.cliente) {
        telefone = imoviewData.cliente.celular || 
                  imoviewData.cliente.telefone || 
                  imoviewData.cliente.fone ||
                  imoviewData.cliente.phone;
      } else {
        // Tentar encontrar telefone em outros campos possíveis
        telefone = imoviewData.celular || 
                  imoviewData.telefone || 
                  imoviewData.fone ||
                  imoviewData.phone;
      }

      if (!telefone) {
        console.error('Telefone não encontrado nos dados do atendimento:', imoviewData);
        return NextResponse.json({
          success: false,
          message: 'Telefone não encontrado nos dados do atendimento',
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
